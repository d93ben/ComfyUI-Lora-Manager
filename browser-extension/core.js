export const DEFAULT_SERVER = 'http://127.0.0.1:8188';

function positiveId(value) {
  if (!/^[1-9]\d*$/.test(value || '') || !Number.isSafeInteger(Number(value))) {
    throw new Error('Model and version IDs must be positive whole numbers.');
  }
  return String(Number(value));
}

export function parseModelUrl(value) {
  let url;
  try { url = new URL(value.trim()); } catch {
    throw new Error('Paste a full Civitai model link.');
  }
  if (url.protocol !== 'https:' || !['civitai.com', 'www.civitai.com'].includes(url.hostname)
      || url.username || url.password || url.port) {
    throw new Error('Use an https://civitai.com/models/… link.');
  }
  const match = url.pathname.match(/^\/models\/([1-9]\d*)(?:\/[^/]*)?\/?$/);
  if (!match) throw new Error('Open a model page, then copy its link.');
  const modelId = positiveId(match[1]);
  const versions = url.searchParams.getAll('modelVersionId');
  if (versions.length > 1) throw new Error('The link contains more than one version ID.');
  const versionId = versions.length ? positiveId(versions[0]) : null;
  const canonical = new URL(`https://civitai.com/models/${modelId}`);
  if (versionId) canonical.searchParams.set('modelVersionId', versionId);
  return { modelId, versionId, url: canonical.href };
}

export function normalizeServer(value) {
  let url;
  try { url = new URL(value.trim()); } catch {
    throw new Error('Use a local address such as http://127.0.0.1:8188.');
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The server must be http://127.0.0.1 or http://localhost, with an optional port.');
  }
  return url.origin;
}

export async function api(server, path, params = {}, { fetchImpl = fetch, timeout = 10000 } = {}) {
  if (!path.startsWith('/api/lm/') || path.includes('..') || /[?#\\]/.test(path)) {
    throw new Error('Invalid LoRA Manager endpoint.');
  }
  const url = new URL(path, normalizeServer(server));
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  }
  let response;
  try {
    response = await fetchImpl(url.href, {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
      ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {})
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('LoRA Manager took too long to respond.');
    throw new Error('Cannot reach LoRA Manager. Start ComfyUI and check the local address.');
  }
  let body;
  try { body = await response.json(); } catch {
    throw new Error(`LoRA Manager returned an unreadable response (${response.status}).`);
  }
  if (!response.ok || body.success === false) {
    const message = typeof body.error === 'string' ? body.error.slice(0, 250) : `Request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
}

export function downloadParams(model, downloadId) {
  const valid = parseModelUrl(model.url);
  return {
    model_id: valid.modelId,
    model_version_id: valid.versionId,
    download_id: downloadId,
    use_default_paths: true
  };
}

export function describeLibrary(result, model) {
  if (model.versionId) {
    if (result.exists) return { installed: true, text: 'This version is already in your library.' };
    return { installed: false, text: result.hasBeenDownloaded
      ? 'Downloaded before, but this version is no longer in your library.'
      : 'This version is not in your library.' };
  }
  const count = Array.isArray(result.versions) ? result.versions.length : 0;
  return { installed: false, text: count
    ? `${count} local version${count === 1 ? '' : 's'} found. This link selects the latest version, which may differ.`
    : 'No local versions found. This link selects the latest version.' };
}

export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'skipped', 'interrupted']);

export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 3);
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

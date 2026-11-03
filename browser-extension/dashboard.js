import { DEFAULT_SERVER, TERMINAL_STATUSES, api, describeLibrary, downloadParams, formatBytes, normalizeServer, parseModelUrl } from './core.js';

const $ = (id) => document.getElementById(id);
let server = DEFAULT_SERVER;
let model = null;
let checked = false;
let installed = false;
let checking = 0;
let transfers = [];
let polling = false;
let initialized = false;
let queuedModel = null;
const openRequests = new Set();
let saveChain = Promise.resolve();

function persistTransfers() {
  // Serialize snapshots so a slower storage write cannot replace newer progress.
  const snapshot = structuredClone(transfers);
  saveChain = saveChain.catch(() => {}).then(() => chrome.storage.local.set({ transfers: snapshot }));
  return saveChain;
}

function notify(message = '') { $('notice').textContent = message; }
function active(item) { return !TERMINAL_STATUSES.has(item.status); }
function sameTarget(item) {
  return model && item.server === server && item.model.modelId === model.modelId
    && item.model.versionId === model.versionId && active(item);
}
function updateDownloadButton() {
  $('download-button').disabled = !checked || installed || transfers.some(sameTarget);
}

async function connect() {
  $('server').value = server;
  $('library-link').href = `${server}/loras`;
  $('connection-status').textContent = 'Checking connection…';
  const target = server;
  try {
    const result = await api(target, '/api/lm/health-check');
    if (result.status !== 'ok') throw new Error('LoRA Manager is not ready.');
    if (server === target) $('connection-status').textContent = `Connected · ${target}`;
  } catch (error) {
    if (server === target) $('connection-status').textContent = error.message;
  }
}

function invalidateSelection() {
  checking++;
  checked = false;
  model = null;
  $('model-details').hidden = true;
  updateDownloadButton();
}

async function checkModel() {
  const revision = ++checking;
  checked = false;
  installed = false;
  updateDownloadButton();
  notify();
  try {
    model = parseModelUrl($('model-url').value);
    $('model-url').value = model.url;
    $('model-details').hidden = false;
    $('model-label').textContent = `Model ${model.modelId}`;
    $('version-label').textContent = model.versionId ? `Selected version ${model.versionId}` : 'Latest version · no version specified in link';
    $('library-status').textContent = 'Checking your library…';
    const result = await api(server, '/api/lm/check-model-exists', { modelId: model.modelId, modelVersionId: model.versionId });
    if (revision !== checking) return;
    const description = describeLibrary(result, model);
    $('library-status').textContent = description.text;
    installed = description.installed;
    checked = true;
    updateDownloadButton();
  } catch (error) {
    if (revision !== checking) return;
    $('library-status').textContent = 'Library check unavailable.';
    notify(error.message);
  }
}

function renderTransfers() {
  const container = $('downloads');
  container.replaceChildren();
  if (!transfers.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Your downloads will appear here.';
    container.append(empty);
  }
  for (const item of transfers) {
    const row = document.createElement('article');
    row.className = 'download';
    const title = document.createElement('h3');
    title.textContent = `Model ${item.model.modelId} · ${item.model.versionId ? `version ${item.model.versionId}` : 'latest version'}`;
    const status = document.createElement('p');
    const percent = Math.max(0, Math.min(100, Number(item.progress) || 0));
    status.textContent = `${item.status} · ${percent.toFixed(0)}% · ${formatBytes(item.bytes_downloaded)}${item.total_bytes ? ` / ${formatBytes(item.total_bytes)}` : ''}${item.bytes_per_second ? ` · ${formatBytes(item.bytes_per_second)}/s` : ''}`;
    const bar = document.createElement('progress');
    bar.max = 100;
    bar.value = percent;
    bar.setAttribute('aria-label', `Model ${item.model.modelId} download progress`);
    row.append(title, status, bar);
    if (item.message) {
      const message = document.createElement('p');
      message.textContent = item.message;
      row.append(message);
    }
    if (active(item)) {
      const actions = document.createElement('div');
      actions.className = 'download-actions';
      const verb = item.status === 'paused' ? 'resume' : 'pause';
      const button = document.createElement('button');
      button.className = 'secondary';
      button.textContent = verb === 'resume' ? 'Resume' : 'Pause';
      button.disabled = Boolean(item.controlling);
      button.addEventListener('click', () => controlTransfer(item, verb));
      actions.append(button);
      row.append(actions);
    }
    container.append(row);
  }
  updateDownloadButton();
}

async function controlTransfer(item, verb) {
  item.controlling = true;
  renderTransfers();
  try {
    await api(item.server, `/api/lm/${verb}-download`, { download_id: item.id });
    item.status = verb === 'pause' ? 'paused' : 'downloading';
    item.message = '';
  } catch (error) { item.message = error.message; }
  finally { item.controlling = false; }
  await persistTransfers();
  renderTransfers();
}

async function startDownload() {
  if (!checked || installed || !model || transfers.some(sameTarget)) return;
  const item = { id: crypto.randomUUID(), model: { ...model }, server, status: 'starting', progress: 0, createdAt: Date.now() };
  // Keep all live transfers and up to 29 older entries.
  transfers = [item, ...transfers.filter(active), ...transfers.filter((entry) => !active(entry)).slice(0, 29)];
  openRequests.add(item.id);
  renderTransfers();
  notify('Download requested. Keep this tab open; you can browse in other tabs.');
  try {
    await persistTransfers();
    const result = await api(item.server, '/api/lm/download-model-get', downloadParams(item.model, item.id), { timeout: 0 });
    item.status = result.cancelled ? 'cancelled' : result.status || 'completed';
    if (item.status === 'completed') item.progress = 100;
    item.message = result.message || '';
    if (item.status === 'completed' && model?.url === item.model.url && server === item.server) await checkModel();
  } catch (error) {
    // A transport error does not prove that the server stopped the transfer.
    item.status = error.status ? 'failed' : 'checking';
    item.message = error.message;
  } finally {
    openRequests.delete(item.id);
    await persistTransfers();
    renderTransfers();
  }
}

async function pollTransfers() {
  if (polling) return;
  polling = true;
  let unavailable = false;
  try {
    await Promise.all(transfers.filter(active).map(async (item) => {
      try {
        const result = await api(item.server, `/api/lm/download-progress/${encodeURIComponent(item.id)}`);
        // Do not overwrite a terminal result or an in-flight pause/resume response.
        if (!active(item) || item.controlling) return;
        for (const key of ['progress', 'bytes_downloaded', 'total_bytes', 'bytes_per_second']) {
          if (typeof result[key] === 'number') item[key] = result[key];
        }
        if (typeof result.status === 'string') item.status = result.status;
        item.message = typeof result.message === 'string' ? result.message : '';
      } catch (error) {
        unavailable = true;
        if (error.status === 404 && !openRequests.has(item.id)) {
          item.status = 'interrupted';
          item.message = 'Tracking is no longer available. Check the library before downloading again.';
        }
      }
    }));
    $('downloads-status').textContent = unavailable ? 'Some progress is temporarily unavailable.' : '';
    await persistTransfers();
    renderTransfers();
  } finally { polling = false; }
}

$('server-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const next = normalizeServer($('server').value);
    await chrome.storage.local.set({ server: next });
    server = next;
    invalidateSelection();
    notify();
    await connect();
    if ($('model-url').value.trim()) await checkModel();
  } catch (error) { notify(error.message); }
});
$('model-form').addEventListener('submit', (event) => { event.preventDefault(); void checkModel(); });
$('model-url').addEventListener('input', invalidateSelection);
$('download-button').addEventListener('click', () => void startDownload());
$('refresh-button').addEventListener('click', () => { void connect(); void pollTransfers(); });
window.addEventListener('beforeunload', (event) => {
  if (openRequests.size) { event.preventDefault(); event.returnValue = ''; }
});

async function selectModel(url) {
  $('model-url').value = parseModelUrl(url).url;
  await checkModel();
}

// Register before startup network requests so a second toolbar click cannot get lost.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message.type !== 'select-model') return;
  if (!initialized) queuedModel = message.url;
  else void selectModel(message.url).catch((error) => notify(error.message));
  reply({ received: true });
});

async function initialize() {
  const saved = await chrome.storage.local.get(['server', 'transfers', 'pendingModel']);
  try { server = normalizeServer(saved.server || DEFAULT_SERVER); } catch { server = DEFAULT_SERVER; }
  transfers = Array.isArray(saved.transfers) ? saved.transfers.filter((item) => {
    try { normalizeServer(item.server); parseModelUrl(item.model.url); return /^[a-zA-Z0-9-]+$/.test(item.id); } catch { return false; }
  }).map((item) => ({ ...item, controlling: false })) : [];
  renderTransfers();
  initialized = true;
  const pending = queuedModel || saved.pendingModel;
  if (pending) {
    await chrome.storage.local.remove('pendingModel');
    try { await selectModel(pending); } catch (error) { notify(error.message); }
  }
  await connect();
  await pollTransfers();
  setInterval(() => { if (transfers.some(active)) void pollTransfers(); }, 2500);
}

void initialize().catch((error) => notify(error.message));

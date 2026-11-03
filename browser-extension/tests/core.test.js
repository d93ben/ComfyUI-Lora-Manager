import test from 'node:test';
import assert from 'node:assert/strict';
import { api, describeLibrary, downloadParams, normalizeServer, parseModelUrl } from '../core.js';
import { readFile } from 'node:fs/promises';

test('model links preserve the exact version and discard unrelated query data', () => {
  assert.deepEqual(parseModelUrl('https://www.civitai.com/models/123/example?modelVersionId=456&token=private#section'),
    { modelId: '123', versionId: '456', url: 'https://civitai.com/models/123?modelVersionId=456' });
  assert.equal(parseModelUrl('https://civitai.com/models/123').versionId, null);
});

test('untrusted hosts, credentials, malformed IDs and ambiguous versions are rejected', () => {
  for (const value of ['https://civitai.com.evil.test/models/1', 'http://civitai.com/models/1',
    'https://user:secret@civitai.com/models/1', 'https://civitai.com:123/models/1',
    'https://civitai.com/images/123', 'https://civitai.com/models/0',
    'https://civitai.com/models/1?modelVersionId=', 'https://civitai.com/models/1?modelVersionId=-2',
    'https://civitai.com/models/9007199254740992', 'https://civitai.com/models/1?modelVersionId=2&modelVersionId=3']) {
    assert.throws(() => parseModelUrl(value), undefined, value);
  }
});

test('server configuration is confined to explicit loopback hosts', () => {
  assert.equal(normalizeServer('http://localhost:8188/'), 'http://localhost:8188');
  for (const value of ['https://example.com', 'http://192.168.1.10:8188', 'http://localhost.evil.test',
    'http://user:secret@localhost:8188', 'http://localhost:8188/loras', 'http://localhost:8188?key=secret']) {
    assert.throws(() => normalizeServer(value));
  }
});

test('download request carries the selected version and uses configured model folders', () => {
  const model = parseModelUrl('https://civitai.com/models/123?modelVersionId=456');
  assert.deepEqual(downloadParams(model, 'a-task'), {
    model_id: '123', model_version_id: '456', download_id: 'a-task', use_default_paths: true
  });
  assert.equal(downloadParams(parseModelUrl('https://civitai.com/models/123'), 'task').model_version_id, null);
});

test('library status does not confuse an older installed version with the latest version', () => {
  const exact = parseModelUrl('https://civitai.com/models/123?modelVersionId=456');
  assert.equal(describeLibrary({ exists: true }, exact).installed, true);
  assert.match(describeLibrary({ exists: false, hasBeenDownloaded: true }, exact).text, /no longer/);
  assert.equal(describeLibrary({ versions: [{ id: 1 }] }, { versionId: null }).installed, false);
});

test('API uses GET without credentials and rejects redirects; long downloads have no client timeout', async () => {
  let observed;
  const result = await api('http://127.0.0.1:8188', '/api/lm/download-model-get', { model_id: '123', model_version_id: null }, {
    timeout: 0, fetchImpl: async (url, options) => {
      observed = { url, options }; return new Response(JSON.stringify({ success: true }));
    }
  });
  assert.equal(result.success, true);
  assert.equal(observed.url, 'http://127.0.0.1:8188/api/lm/download-model-get?model_id=123');
  assert.equal(observed.options.method, 'GET');
  assert.equal(observed.options.credentials, 'omit');
  assert.equal(observed.options.redirect, 'error');
  assert.equal(observed.options.signal, undefined);
});

test('API surfaces failures and never follows an endpoint outside LoRA Manager', async () => {
  await assert.rejects(api('http://localhost:8188', '/api/lm/health-check', {}, {
    fetchImpl: async () => new Response(JSON.stringify({ success: false, error: 'Not authorized' }), { status: 401 })
  }), (error) => error.status === 401 && error.message === 'Not authorized');
  await assert.rejects(api('http://localhost:8188', '//evil.test'), /Invalid/);
  await assert.rejects(api('http://localhost:8188', '/api/lm/../settings'), /Invalid/);
  await assert.rejects(api('http://localhost:8188', '/api/lm/health-check', {}, {
    fetchImpl: async () => new Response('<html>Failure</html>', { status: 500 })
  }), /unreadable/);
});

test('manifest has no Civitai host access, content scripts, remote code, or key permissions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  assert.deepEqual(manifest.permissions, ['activeTab', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*', 'http://localhost/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  for (const file of ['background.js', 'dashboard.js', 'core.js']) {
    assert.doesNotMatch(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), /civitai_api_key|eval\(|innerHTML/);
  }
});

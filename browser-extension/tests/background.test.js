import test from 'node:test';
import assert from 'node:assert/strict';

test('toolbar opens a dashboard with a sanitized model URL', async () => {
  let listener;
  const saved = [];
  const created = [];
  globalThis.chrome = {
    action: { onClicked: { addListener: (callback) => { listener = callback; } } },
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    tabs: { query: async () => [], create: async (options) => created.push(options) },
    storage: { local: { set: async (data) => saved.push(data) } }
  };
  await import('../background.js?new');
  await listener({ url: 'https://civitai.com/models/123?modelVersionId=456&token=secret' });
  assert.deepEqual(saved, [{ pendingModel: 'https://civitai.com/models/123?modelVersionId=456' }]);
  assert.deepEqual(created, [{ url: 'chrome-extension://test/dashboard.html' }]);
});

test('toolbar reuses a dashboard without navigating or interrupting its transfers', async () => {
  let listener;
  const updated = [];
  const messages = [];
  globalThis.chrome = {
    action: { onClicked: { addListener: (callback) => { listener = callback; } } },
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      sendMessage: async (message) => messages.push(message)
    },
    tabs: { query: async () => [{ id: 7, windowId: 2 }], update: async (id, options) => updated.push({ id, ...options }) },
    windows: { update: async () => {} }
  };
  await import('../background.js?reuse');
  await listener({ url: 'https://civitai.com/models/123' });
  assert.deepEqual(updated, [{ id: 7, active: true }]);
  assert.deepEqual(messages, [{ type: 'select-model', url: 'https://civitai.com/models/123' }]);
});

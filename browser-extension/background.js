import { parseModelUrl } from './core.js';

// A full tab owns long requests; MV3 service workers may stop after 30 seconds.
chrome.action.onClicked.addListener(async (sourceTab) => {
  let model = null;
  try { model = parseModelUrl(sourceTab.url || ''); } catch { /* Allow manual paste. */ }
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const dashboards = await chrome.tabs.query({ url: dashboardUrl });
  const existing = dashboards[0];
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    if (model) {
      try { await chrome.runtime.sendMessage({ type: 'select-model', url: model.url }); }
      catch { await chrome.storage.local.set({ pendingModel: model.url }); }
    }
    return;
  }
  if (model) await chrome.storage.local.set({ pendingModel: model.url });
  await chrome.tabs.create({ url: dashboardUrl });
});

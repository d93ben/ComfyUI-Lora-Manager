import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ nodes: [], dirty: vi.fn() }));
vi.mock('../../../scripts/app.js', () => ({ app: { graph: {}, canvas: { setDirty: state.dirty } } }));
vi.mock('../../../web/comfyui/utils.js', () => ({ getAllGraphNodes: () => state.nodes.map(node => ({ node })) }));
import { addLibraryLora, openLoraLibrary } from '../../../web/comfyui/lora_library_sidebar.js';

const model = { model_name: 'Arcane style', file_name: 'style', folder: 'anima', file_path: 'I:/loras/anima/style.safetensors', sha256: 'abc', base_model: 'Anima', usage_tips: '{"strength":0.7,"clip_strength":0.6}' };
let node;
let widget;
beforeEach(() => {
  node = { id: 63, title: 'Still LoRAs - Anima', graph: { beforeChange: vi.fn(), afterChange: vi.fn() } };
  widget = { value: '<lora:anima/other:0.4>', callback: vi.fn() };
  state.nodes = [node];
  vi.stubGlobal('fetch', vi.fn(async url => ({ ok: true, json: async () => url.includes('base-models') ? { base_models: [{ name: 'Anima', count: 1 }] } : url.endsWith('/settings') ? { settings: { blur_mature_content: true } } : { items: [model], total: 1, total_pages: 1 } })));
});
afterEach(() => {
  document.querySelector('[aria-label="Close LoRA browser"]')?.click();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function mockLibrary(list) {
  const fetchSettings = fetch.getMockImplementation();
  fetch.mockImplementation((url, options) => {
    if (url.includes('/loader-pool?')) return { ok: true, json: async () => ({ items: [] }) };
    if (!url.includes('/loras/list?')) return fetchSettings(url, options);
    return list(new URL(url, 'http://localhost').searchParams, options);
  });
}

function pageResponse(page, total) {
  const start = (page - 1) * 24;
  const items = Array.from({ length: Math.min(24, total - start) }, (_, offset) => {
    const name = `style-${start + offset + 1}`;
    return { ...model, model_name: name, file_name: name, file_path: `/loras/${name}.safetensors` };
  });
  return { ok: true, json: async () => ({ total, items, total_pages: Math.ceil(total / 24) }) };
}

function scrollToLastRow(grid) {
  Object.defineProperties(grid, {
    clientHeight: { configurable: true, value: 650 },
    scrollHeight: { configurable: true, get: () => Math.ceil(grid.childElementCount / 2) * 336 },
  });
  grid.scrollTop = grid.scrollHeight - grid.clientHeight;
  grid.dispatchEvent(new Event('scroll'));
}

describe('LoRA sidebar selection', () => {
  it('adds a folder-qualified LoRA and preserves existing strengths', () => {
    expect(addLibraryLora(node, widget, model)).toBe(true);
    expect(widget.value).toBe('<lora:anima/other:0.4> <lora:anima/style:0.7:0.6>');
    expect(widget.callback).toHaveBeenCalledWith(widget.value);
    expect(node.graph.afterChange).toHaveBeenCalledOnce();
  });
  it('does not duplicate or reset an already-selected LoRA', () => {
    widget.value = '<lora:anima/style:0.2:0.3>';
    expect(addLibraryLora(node, widget, model)).toBe(false);
    expect(widget.value).toBe('<lora:anima/style:0.2:0.3>');
    expect(widget.callback).not.toHaveBeenCalled();
  });
  it('rejects a stale target after switching workflows', () => {
    state.nodes = [{ ...node }];
    expect(() => addLibraryLora(node, widget, model)).toThrow('workflow changed');
    expect(widget.callback).not.toHaveBeenCalled();
  });
  it('opens Recommended from the connected model, and All drops its family and stage filters', async () => {
    const source = { widgets: [{ name: 'unet_name', value: 'wan22_i2v_14b_high.gguf' }] };
    node.inputs = [{ name: 'model', type: 'MODEL', link: 4 }];
    node.getInputNode = () => source;
    fetch.mockResolvedValue({ ok: true, json: async () => ({ items: [], base_models: [], settings: {}, total: 0, total_pages: 0 }) });
    openLoraLibrary(node, widget);
    const tab = name => document.querySelector(`#lm-library-tab-${name}`);
    const lastQuery = () => new URL(fetch.mock.calls.filter(([url]) => url.includes('/loras/list?')).at(-1)[0], 'http://localhost').searchParams;
    await vi.waitFor(() => expect(tab('Recommended').getAttribute('aria-selected')).toBe('true'));
    expect(lastQuery().get('base_model')).toBe('Wan Video 2.2 I2V-A14B');
    expect(lastQuery().get('auto_tag_include')).toBe('HIGH');
    tab('All').click();
    expect(lastQuery().has('base_model')).toBe(false);
    expect(lastQuery().has('auto_tag_include')).toBe(false);
    source.widgets[0].value = 'krea2/swapped.safetensors';
    await vi.waitFor(() => expect(document.querySelector('.lm-library-reason').textContent).toContain('Krea 2'), { timeout: 2000 });
    expect(tab('All').getAttribute('aria-selected')).toBe('true');
    tab('Recommended').click();
    expect(lastQuery().get('base_model')).toBe('Krea 2');
    expect(lastQuery().has('auto_tag_include')).toBe(false);
  });
  it('opens a right sidebar with a direct add action and separate exact-model Info link', async () => {
    openLoraLibrary(node, widget);
    await vi.waitFor(() => expect(document.querySelectorAll('.lm-library-card')).toHaveLength(1));
    expect(document.querySelector('#lm-library-tab-All').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('aside').textContent).toContain('Add to: Still LoRAs - Anima');
    const info = new URL(document.querySelector('.lm-library-info').href);
    expect(info.searchParams.get('model')).toBe(model.file_path);
    expect(info.searchParams.get('hash')).toBe('abc');
    expect(widget.callback).not.toHaveBeenCalled();
    document.querySelector('.lm-library-add').click();
    expect(widget.value).toContain('<lora:anima/style:0.7:0.6>');
    expect(document.querySelector('.lm-library-add').disabled).toBe(true);
  });
  it.each(['Recommended', 'All'])('scrolls to the last card in %s without replacing earlier rows', async view => {
    node.inputs = [{ name: 'model', type: 'MODEL', link: 4 }];
    node.getInputNode = () => ({ widgets: [{ name: 'unet_name', value: 'anima/test.safetensors' }] });
    const requests = [];
    mockLibrary(query => {
      const page = Number(query.get('page'));
      requests.push([query.get('base_model'), page]);
      return pageResponse(page, 75);
    });
    openLoraLibrary(node, widget);
    const grid = document.querySelector('#lm-library-results');
    await vi.waitFor(() => expect(grid.children).toHaveLength(24));
    if (view === 'All') {
      requests.length = 0;
      document.querySelector('#lm-library-tab-All').click();
      await vi.waitFor(() => expect(grid.children).toHaveLength(24));
    }
    const first = grid.firstElementChild;
    for (const count of [48, 72, 75]) {
      scrollToLastRow(grid);
      grid.dispatchEvent(new Event('scroll')); // multiple notifications while the same page loads
      const position = grid.scrollTop;
      await vi.waitFor(() => expect(grid.children).toHaveLength(count));
      expect(grid.firstElementChild).toBe(first);
      expect(grid.scrollTop).toBe(position);
    }
    scrollToLastRow(grid);
    expect(requests).toEqual([1, 2, 3, 4].map(page => [view === 'All' ? null : 'Anima', page]));
    expect(grid.lastElementChild.querySelector('strong').textContent).toBe('style-75');
  });
  it('keeps the current cards and retries the failed continuation', async () => {
    let fail = true;
    mockLibrary(query => {
      const page = Number(query.get('page'));
      if (page === 2 && fail) { fail = false; return { ok: false, status: 503 }; }
      return pageResponse(page, 26);
    });
    openLoraLibrary(node, widget);
    const grid = document.querySelector('#lm-library-results');
    await vi.waitFor(() => expect(grid.children).toHaveLength(24));
    scrollToLastRow(grid);
    const retry = document.querySelector('.lm-library-retry');
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    expect(grid.children).toHaveLength(24);
    retry.click();
    await vi.waitFor(() => expect(grid.children).toHaveLength(26));
    expect(retry.hidden).toBe(true);
  });
  it('discards an old continuation when the filter changes', async () => {
    let release;
    mockLibrary(query => {
      if (query.get('page') === '2') return new Promise(resolve => { release = resolve; });
      return pageResponse(1, query.get('favorites_only') === 'true' ? 1 : 26);
    });
    openLoraLibrary(node, widget);
    const grid = document.querySelector('#lm-library-results');
    await vi.waitFor(() => expect(grid.children).toHaveLength(24));
    scrollToLastRow(grid);
    document.querySelector('.lm-library-favorite input').click();
    await vi.waitFor(() => expect(grid.children).toHaveLength(1));
    release(pageResponse(2, 26));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(grid.children).toHaveLength(1);
    expect(grid.scrollTop).toBe(0);
  });
});

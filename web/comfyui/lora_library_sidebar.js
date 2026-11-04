import { app } from "../../scripts/app.js";
import { lmUrl } from "./base_path.js";
import { getAllGraphNodes } from "./utils.js";
import { connectedLoader, recommendationFor } from "./lora_model_context.js";

let closeSidebar = null;

function relativeName(model) {
  return [model.folder, model.file_name].filter(Boolean).join("/").replaceAll("\\", "/");
}

function isAdded(widget, model) {
  const name = relativeName(model).toLowerCase();
  return [...String(widget.value || "").matchAll(/<lora:([^:]+):[^>]+>/g)]
    .some(match => match[1].replaceAll("\\", "/").toLowerCase() === name);
}

export function addLibraryLora(node, widget, model) {
  if (!getAllGraphNodes(app.graph).some(entry => entry.node === node)) {
    throw new Error("The workflow changed. Open Browse LoRAs from the list you want to edit.");
  }
  if (isAdded(widget, model)) return false;
  const name = relativeName(model);
  if (!name || /[<>:]/.test(name)) throw new Error("This filename cannot be used as LoRA syntax.");
  let tips = model.usage_tips || {};
  if (typeof tips === "string") {
    try { tips = JSON.parse(tips); } catch { tips = {}; }
  }
  const strength = Number.parseFloat(tips?.strength);
  const clip = Number.parseFloat(tips?.clip_strength ?? tips?.clipStrength);
  const tag = `<lora:${name}:${Number.isFinite(strength) ? strength : 1}${Number.isFinite(clip) ? `:${clip}` : ""}>`;
  node.graph.beforeChange?.();
  widget.value = [String(widget.value || "").trim(), tag].filter(Boolean).join(" ");
  widget.callback?.(widget.value);
  node.graph.afterChange?.();
  app.canvas?.setDirty(true, true);
  return true;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

async function getJson(path, signal) {
  const response = await fetch(lmUrl(path), { signal });
  if (!response.ok) throw new Error(`LoRA Manager is unavailable (${response.status}).`);
  return response.json();
}

export function openLoraLibrary(node, widget) {
  closeSidebar?.();
  if (!document.getElementById("lm-library-sidebar-style")) {
    const style = element("link");
    style.id = "lm-library-sidebar-style";
    style.rel = "stylesheet";
    style.href = new URL("./lora_library_sidebar.css", import.meta.url).href;
    document.head.append(style);
  }
  const panel = element("aside", "lm-library-sidebar lm-popover");
  panel.setAttribute("aria-label", "LoRA browser");
  const header = element("header", "lm-library-heading");
  const heading = element("div");
  heading.append(element("h2", "", "Browse LoRAs"), element("p", "", `Add to: ${node.title || node.type} · #${node.id}`));
  const close = element("button", "", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close LoRA browser");
  header.append(heading, close);

  const controls = element("div", "lm-library-controls");
  const tabs = element("div", "lm-library-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "LoRA library view");
  for (const name of ["Recommended", "All"]) {
    const tab = element("button", "", name);
    tab.type = "button";
    tab.id = `lm-library-tab-${name}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", "lm-library-results");
    tab.onclick = () => { manualView = name; changeView(name); };
    tab.onkeydown = event => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const nextTab = event.key === "Home" ? tabs.firstChild : event.key === "End" ? tabs.lastChild
          : tab === tabs.firstChild ? tabs.lastChild : tabs.firstChild;
        nextTab.focus();
        nextTab.click();
      }
    };
    tabs.append(tab);
  }
  const reason = element("p", "lm-library-reason");
  const search = element("input");
  search.type = "search";
  search.placeholder = "Search names, files or tags…";
  search.setAttribute("aria-label", "Search LoRA library");
  const filters = element("div", "lm-library-filters");
  const family = element("select");
  family.setAttribute("aria-label", "Base model");
  family.append(new Option("All base models", ""));
  const favoriteLabel = element("label", "lm-library-favorite");
  const favorites = element("input");
  favorites.type = "checkbox";
  favoriteLabel.append(favorites, document.createTextNode("Favorites"));
  filters.append(family, favoriteLabel);
  controls.append(tabs, reason, search, filters);
  const status = element("p", "lm-library-status", "Loading library…");
  status.setAttribute("role", "status");
  const retry = element("button", "lm-library-retry", "Retry");
  retry.type = "button";
  retry.hidden = true;
  retry.onclick = () => { retry.hidden = true; loadNextPage(); };
  const feedback = element("div", "lm-library-feedback");
  feedback.append(status, retry);
  const grid = element("div", "lm-library-grid");
  grid.id = "lm-library-results";
  grid.tabIndex = 0;
  grid.setAttribute("role", "tabpanel");
  panel.append(header, controls, feedback, grid);
  document.body.append(panel);

  let nextPage = 0;
  let filtersQuery;
  const shownPaths = new Set();
  let requestController = null;
  let searchTimer = null;
  let modelTimer = null;
  let sourceKey = undefined;
  let recommendation = null;
  let manualView = null;
  let view = "All";
  let pools = null;
  let disposed = false;
  let previewSettings = { blur_mature_content: true, mature_blur_level: "R" };
  const lifetime = new AbortController();
  grid.addEventListener("scroll", loadIfNearEnd, { passive: true });
  window.addEventListener("resize", loadIfNearEnd);
  function dismiss() {
    disposed = true;
    clearTimeout(searchTimer);
    clearInterval(modelTimer);
    requestController?.abort();
    lifetime.abort();
    panel.remove();
    window.removeEventListener("resize", loadIfNearEnd);
    document.removeEventListener("keydown", onKey);
    closeSidebar = null;
  }
  function onKey(event) {
    if (event.key === "Escape") dismiss();
  }
  close.onclick = dismiss;
  closeSidebar = dismiss;
  document.addEventListener("keydown", onKey);

  function renderCard(model) {
    const card = element("article", "lm-library-card");
    const add = element("button", "lm-library-add");
    add.type = "button";
    add.setAttribute("aria-label", `Add ${model.model_name || model.file_name}`);
    const preview = element("div", "lm-library-preview");
    const threshold = { PG13: 2, R: 4, X: 8, XXX: 16 }[previewSettings.mature_blur_level] || 4;
    const concealed = previewSettings.blur_mature_content && model.preview_nsfw_level >= threshold;
    if (model.preview_url && !concealed) {
      const url = new URL(model.preview_url, window.location.origin);
      const isVideo = /\.(mp4|webm|mov)(?:$|[?&])/i.test(decodeURIComponent(url.href));
      const media = element(isVideo ? "video" : "img");
      media.src = url.pathname.startsWith("/api/") || url.pathname.startsWith("/loras_static/")
        ? lmUrl(url.pathname + url.search) : url.href;
      if (isVideo) { media.muted = true; media.preload = "metadata"; }
      else { media.loading = "lazy"; media.alt = ""; }
      preview.append(media);
    } else {
      preview.append(element("span", "", concealed ? "Preview hidden" : "No preview"));
    }
    const title = element("strong", "", model.model_name || model.file_name);
    const base = element("small", "lm-library-base", model.base_model || "Unknown base model");
    const file = element("small", "lm-library-file", relativeName(model));
    file.title = model.file_path;
    const action = element("span", "lm-library-add-label");
    function updateAdded() {
      const added = isAdded(widget, model);
      action.textContent = added ? "✓ In this list" : "+ Add LoRA";
      add.disabled = added;
    }
    updateAdded();
    add.append(preview, title, base, file, action);
    add.onclick = () => {
      try {
        const added = addLibraryLora(node, widget, model);
        status.textContent = added ? `Added ${model.model_name || model.file_name}. Adjust its strength in the workflow.` : "Already in this list.";
        updateAdded();
      } catch (error) { status.textContent = error.message; }
    };
    const info = element("a", "lm-library-info", "Info ↗");
    info.href = lmUrl(`/loras?${new URLSearchParams({ model: model.file_path, hash: model.sha256 || "" })}`);
    info.target = "_blank";
    info.rel = "noopener";
    info.setAttribute("aria-label", `Info for ${model.model_name || model.file_name}`);
    card.append(add, info);
    return card;
  }

  function reset() {
    clearTimeout(searchTimer);
    requestController?.abort();
    requestController = null;
    nextPage = 0;
    shownPaths.clear();
    grid.replaceChildren();
    grid.scrollTop = 0;
    retry.hidden = true;
    if (!pools) return;
    if (view === "Recommended" && !recommendation) {
      status.textContent = "Open All to browse the library.";
      return;
    }
    status.textContent = "Loading library…";
    filtersQuery = new URLSearchParams({ page_size: "24", search: search.value.trim(), search_tags: "true", favorites_only: String(favorites.checked) });
    if (view === "Recommended") {
      filtersQuery.set("base_model", recommendation.family);
      if (recommendation.stage) filtersQuery.set("auto_tag_include", recommendation.stage);
    } else if (family.value) filtersQuery.set("base_model", family.value);
    nextPage = 1;
    loadNextPage();
  }
  function loadIfNearEnd() {
    if (grid.clientHeight && grid.scrollHeight - grid.scrollTop - grid.clientHeight <= 480) loadNextPage();
  }
  async function loadNextPage() {
    if (disposed || !nextPage || requestController || !retry.hidden) return;
    const controller = new AbortController();
    requestController = controller;
    const query = new URLSearchParams(filtersQuery);
    query.set("page", String(nextPage));
    try {
      const data = await getJson(`/api/lm/loras/list?${query}`, controller.signal);
      if (disposed || controller.signal.aborted) return;
      const cards = document.createDocumentFragment();
      const newPaths = new Set();
      for (const model of data.items) {
        if (shownPaths.has(model.file_path) || newPaths.has(model.file_path)) continue;
        cards.append(renderCard(model));
        newPaths.add(model.file_path);
      }
      grid.append(cards);
      for (const path of newPaths) shownPaths.add(path);
      nextPage = data.items.length && nextPage < data.total_pages ? nextPage + 1 : 0;
      if (nextPage) {
        status.textContent = `${shownPaths.size} of ${data.total} LoRAs · Scroll for more`;
      } else if (shownPaths.size) {
        status.textContent = `${shownPaths.size} ${shownPaths.size === 1 ? "LoRA" : "LoRAs"} · Click a card to add it`;
      } else {
        status.textContent = view === "Recommended" ? "No matching LoRAs. Try All for more options." : "No matching LoRAs. Try another search or base model.";
      }
    } catch (error) {
      if (!controller.signal.aborted && !disposed) {
        status.textContent = error.message;
        retry.hidden = false;
      }
    } finally {
      if (requestController === controller) requestController = null;
    }
    if (!controller.signal.aborted) loadIfNearEnd();
  }
  function changeView(nextView) {
    view = nextView;
    for (const tab of tabs.children) {
      const selected = tab.textContent === view;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) grid.setAttribute("aria-labelledby", tab.id);
    }
    family.hidden = view === "Recommended";
    reset();
  }
  function checkModel() {
    const source = connectedLoader(node);
    const key = source && `${source.kind}/${source.name}`;
    if (key === sourceKey) return;
    sourceKey = key;
    recommendation = recommendationFor(source, pools[source?.kind] || []);
    if (recommendation) {
      const stage = recommendation.stage ? ` · ${recommendation.stage.toLowerCase()} noise` : "";
      reason.textContent = `${source.name.split("/").pop()} → ${recommendation.family}${stage}`;
    } else {
      reason.textContent = source ? `No known LoRA family for ${source.name.split("/").pop()}.` : "No single model loader could be traced from this node.";
    }
    changeView(manualView || (recommendation ? "Recommended" : "All"));
  }
  search.oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(reset, 250); };
  family.onchange = favorites.onchange = reset;
  search.focus();
  // A missing catalog should not prevent browsing the library or matching a named family.
  const getPool = kind => getJson(`/api/lm/checkpoints/loader-pool?sub_type=${kind}`, lifetime.signal)
    .then(data => data.items || []).catch(() => []);
  Promise.all([
    getJson("/api/lm/loras/base-models?limit=100", lifetime.signal),
    getJson("/api/lm/settings", lifetime.signal),
    getPool("checkpoint"), getPool("diffusion_model"),
  ]).then(([bases, prefs, checkpoint, diffusionModel]) => {
    if (disposed) return;
    previewSettings = prefs.settings;
    bases.base_models.forEach(base => family.append(new Option(`${base.name} (${base.count})`, base.name)));
    pools = { checkpoint, diffusion_model: diffusionModel };
    checkModel();
    modelTimer = setInterval(checkModel, 1000);
  }).catch(error => { if (!disposed) { status.textContent = error.message; } });
}

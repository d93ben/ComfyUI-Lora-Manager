// Follow the MODEL edge only. A mixed image/video graph can have several unrelated loaders.
export function connectedLoader(target) {
  const visited = new Set();
  let node = target;
  while (node && !visited.has(node)) {
    visited.add(node);
    if (node.type === "GetNode") {
      node = node.findSetter?.(node.graph);
      continue;
    }
    const inputs = node.inputs || [];
    const modelSlots = [];
    inputs.forEach((input, slot) => {
      if (input.link != null && (input.type === "MODEL" || input.name === "model")) modelSlots.push(slot);
    });
    if (!modelSlots.length) {
      const file = node.widgets?.find(w => ["ckpt_name", "unet_name", "model_name"].includes(w.name)
        && typeof w.value === "string" && /\.(safetensors|gguf|ckpt|pt|pth|bin)$/i.test(w.value));
      if (file) {
        // A wired filename overrides the displayed widget. Do not recommend from its stale value.
        if (node.inputs?.some(input => input.name === file.name && input.link != null)) return null;
        return { name: file.value.replaceAll("\\", "/"), kind: file.name === "ckpt_name" ? "checkpoint" : "diffusion_model" };
      }
    }
    if (!modelSlots.length && inputs.length === 1 && /reroute/i.test(node.type)) modelSlots.push(0);
    // Switches and merges with multiple model inputs do not identify one base.
    if (modelSlots.length !== 1) return null;
    node = node.getInputNode?.(modelSlots[0]);
  }
  return null;
}

function familyFromPath(name) {
  const path = name.toLowerCase();
  if (/(?:^|\/)anima(?:\/|[._ -])/.test(path)) return "Anima";
  if (/(?:^|\/)krea[ ._-]*2\//.test(path) || /krea[ ._-]*2(?!\d)/.test(path.split("/").pop())) return "Krea 2";
  if (/wan(?:[ ._-]*video)?[ ._-]*2[ ._-]*2(?!\d)/.test(path)) {
    if (/ti2v/.test(path) && /5b/.test(path)) return "Wan Video 2.2 TI2V-5B";
    if (!/14b/.test(path) || /ti2v|animate|s2v/.test(path)) return "";
    if (/i2v/.test(path)) return "Wan Video 2.2 I2V-A14B";
    if (/t2v/.test(path)) return "Wan Video 2.2 T2V-A14B";
  }
  return "";
}

export function recommendationFor(source, pool) {
  if (!source) return null;
  const name = source.name.replaceAll("\\", "/");
  const matches = pool.filter(item => item.name.replaceAll("\\", "/") === name);
  const labels = new Set(matches.map(item => item.base_model?.trim())
    .filter(label => label && !/^(unknown|other|none|null|unspecified)$/i.test(label)));
  if (labels.size > 1) return null;
  const family = labels.size ? [...labels][0] : familyFromPath(name);
  if (!family) return null;
  let stage = "";
  if (/^wan/i.test(family)) {
    const filename = name.split("/").pop();
    const high = /[Hh][Ii][Gg][Hh](?![a-z])/.test(filename);
    const low = /(?<![fF])[Ll][Oo][Ww](?![a-z])/.test(filename);
    if (high !== low) stage = high ? "HIGH" : "LOW";
  }
  return { family, stage };
}

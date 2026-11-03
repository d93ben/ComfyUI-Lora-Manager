# Our LoRA Bridge

An original Chrome Manifest V3 extension for this fork of [ComfyUI LoRA Manager](https://github.com/d93ben/ComfyUI-Lora-Manager). It uses LoRA Manager's existing local API. It is not a copy of the separately distributed LM Civitai Extension and does not require that extension.

## Install

1. Start ComfyUI with LoRA Manager installed. This version targets LoRA Manager 1.2.8.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Choose **Load unpacked** and select this `browser-extension` folder (the folder containing `manifest.json`). If using the release ZIP, extract it first and select the extracted folder.
4. Pin **Our LoRA Bridge** from Chrome's Extensions menu.
5. Click its toolbar button on a Civitai model page. The dashboard opens with that model link. You can also paste a link manually.

Default connection: `http://127.0.0.1:8188`. The dashboard accepts a different local port under Connection settings. Only `127.0.0.1` and `localhost` are allowed; LAN/remote servers are not supported in this version.

## Use

- **Check library** checks the selected version against local LoRAs, checkpoints and embeddings. A link without `modelVersionId` targets the latest version; finding an older local version does not mean the latest is installed.
- **Download to library** asks LoRA Manager to download the selected version, using its configured default folder and preferred model file. Downloads only start after you click this button. An installed exact version is protected from another download.
- The dashboard shows progress and **Pause / Resume** for transfers started here. It retains up to 30 finished entries plus active transfers locally. It does not import another extension's queue.
- **Keep the dashboard tab open during downloads.** The server's download request lasts for the entire transfer. A tab owns this request because a Manifest V3 service worker can stop while a long request is pending. Reloading/closing the dashboard or restarting Chrome can interrupt tracking or the transfer. On reopening, it tries to recover progress; it never silently restarts a download.
- **Open library** opens LoRA Manager. Put your Civitai key in LoRA Manager's Settings if a download requires authentication. The extension never reads the settings endpoint or handles the key.

The initial version does not add badges to Civitai pages, import image recipes, select individual model files, or sync settings between computers. Local metadata must already be available to LoRA Manager for installed-model detection.

## Permissions and privacy

- `activeTab`: reads the current tab's URL only when you click the extension.
- `storage`: keeps the local server address, the selected model link, and transfer IDs/progress. No account credentials, images, or page contents are stored.
- Host access to `http://127.0.0.1/*` and `http://localhost/*`: connects to LoRA Manager. Chrome host match patterns cover all ports; runtime validation restricts requests to the chosen local origin and `/api/lm/` routes.
- No content scripts, Civitai host permission, analytics, remote scripts, or external message handlers. All displayed text uses safe DOM text insertion. Requests omit cookies and reject redirects.

No ComfyUI origin/CORS protections need to be disabled. If a connection fails, first check that ComfyUI is running, the address is correct, and Chrome has granted the listed local-site access.

## Develop and package

Requires Node.js 20+ for tests, and Python 3 for the ZIP packager. No npm dependencies or build step are needed.

```sh
cd browser-extension
npm test
python scripts/package_extension.py
```

Runtime files can be loaded directly. The package is written to `dist/our-lora-bridge-0.1.0.zip`. After editing, click **Reload** on the extension card in `chrome://extensions`, then reopen the dashboard after current downloads finish.

Tests cover URL/server validation, exact-version selection, installed-version interpretation, request behavior, and permission boundaries. A successful local health/library check does not prove a real Civitai download completed. See the release notes for the checks actually performed.

## License and upstream

GPL-3.0-or-later, under the repository's [LICENSE](../LICENSE). The original LoRA Manager remains credited to its upstream contributors. This extension is maintained in the `d93ben` fork; it is not an official Civitai or upstream companion extension.

"""Create a reproducible, dependency-free ZIP of extension runtime files."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
import hashlib
import json

root = Path(__file__).resolve().parents[1]
version = json.loads((root / "manifest.json").read_text(encoding="utf-8"))["version"]
destination = root / "dist" / f"our-lora-bridge-{version}.zip"
destination.parent.mkdir(exist_ok=True)
runtime_files = ["manifest.json", "background.js", "core.js", "dashboard.html", "dashboard.js", "dashboard.css"]
runtime_files += [f"icons/{size}.png" for size in (16, 32, 48, 128)]
with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
    for relative in runtime_files:
        info = ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        archive.writestr(info, (root / relative).read_bytes())
    info = ZipInfo("LICENSE", date_time=(2026, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    archive.writestr(info, (root.parent / "LICENSE").read_bytes())
print(destination)
print("SHA256:", hashlib.sha256(destination.read_bytes()).hexdigest())

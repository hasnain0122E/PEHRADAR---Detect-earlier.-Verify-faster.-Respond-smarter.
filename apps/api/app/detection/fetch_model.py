"""Download the pinned fire/smoke ONNX model and verify its SHA-256 (build step, needs internet).

Run:  uv run python -m app.detection.fetch_model
Skips the download when MODEL_PATH already holds a file with the expected checksum.
Source, licence and checksum: models/README.md.
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

from app.config import get_settings

# Hugging Face repo fiacecson20/cctv-ai-fire-smoke, pinned to an exact commit.
MODEL_URL = (
    "https://huggingface.co/fiacecson20/cctv-ai-fire-smoke/resolve/"
    "343990e42d99a5d27e9f35fc7c80880dc5f43f45/best.onnx"
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    settings = get_settings()
    target = Path(settings.model_path)
    expected = (settings.model_sha256 or "").lower()
    if target.is_file() and (not expected or _sha256(target) == expected):
        print(f"Model already present: {target}")
        return 0

    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    print(f"Downloading {MODEL_URL} -> {target}")
    with urllib.request.urlopen(MODEL_URL, timeout=120) as response, partial.open("wb") as out:
        while chunk := response.read(1024 * 1024):
            out.write(chunk)
    digest = _sha256(partial)
    if expected and digest != expected:
        partial.unlink()
        print(f"Checksum mismatch: got {digest}, expected {expected}", file=sys.stderr)
        return 1
    partial.replace(target)
    print(f"Model ready: {target} ({target.stat().st_size} bytes, sha256 {digest})")
    return 0


if __name__ == "__main__":
    sys.exit(main())

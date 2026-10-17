# Models

Model files are **not committed** (`*.onnx` is git-ignored). They are downloaded and SHA-256-checked by
`uv run python -m app.detection.fetch_model`, which runs in the Render build and in CI.

## `fire_smoke_yolov8n_320.onnx` (M2 detector)

| Field | Value |
|---|---|
| Source | Hugging Face [`fiacecson20/cctv-ai-fire-smoke`](https://huggingface.co/fiacecson20/cctv-ai-fire-smoke), file `best.onnx` |
| Pinned revision | `343990e42d99a5d27e9f35fc7c80880dc5f43f45` |
| SHA-256 | `f2699b753e78be8d392bfa63e64bf102ea3ceb8b6086a59dfd8192b61a0c6fad` |
| Size | 12,139,911 bytes |
| Architecture | Ultralytics YOLOv8n, fine-tuned (12 epochs, "round-1 baseline" per its card) |
| Classes | `0: fire`, `1: smoke` (from the ONNX metadata) |
| Input | `images` `[1, 3, 320, 320]` float32, RGB, 0–1, letterboxed |
| Output | `output0` `[1, 6, 2100]`: cx, cy, w, h (input pixels) + 2 class scores. No NMS inside. |
| Reported validation (publisher's own split, not ours) | mAP@0.5 0.743 overall; fire P 0.781 / R 0.893 / mAP 0.912; smoke P 0.706 / R 0.517 / mAP 0.573 |
| Training data | Stated as a CC-BY 4.0 fire/smoke dataset. Not independently verifiable: the linked upstream GitHub repo was not publicly reachable on 2026-10-17. |

### Licence

- The model card declares **MIT** for the weights.
- The ONNX metadata written by Ultralytics declares **AGPL-3.0**, and the card itself warns that the
  Ultralytics base model is AGPL-3.0, so hosted use may require AGPL compliance.
- PehRadar therefore treats the model as **AGPL-3.0**. The PehRadar repository is public, which is the
  usual way to meet AGPL's source-availability requirement for a hosted service. This is not legal
  advice. Revisit before any closed-source or commercial use.

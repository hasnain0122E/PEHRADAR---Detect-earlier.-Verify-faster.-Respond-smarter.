"""Run the fire/smoke pipeline on local clips and print one line per clip (manual smoke test).

Run:  uv run python -m app.detection.validate_clips path/to/*.mp4 [--threshold 0.4] [--scores]
Uses the same settings, model and decision rule as POST /api/v1/detect/fire.
A handful of clips is a smoke test, not an accuracy measurement.
"""

import argparse
import tempfile
from pathlib import Path

from app.config import get_settings
from app.detection.evidence import EvidenceStore
from app.detection.fire_model import FireSmokeModel
from app.detection.fire_pipeline import analyze_video
from app.routers.detect import decision_rule


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("clips", nargs="+", type=Path)
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--evidence-dir", type=Path, default=Path(tempfile.gettempdir()))
    args = parser.parse_args()

    settings = get_settings()
    if args.threshold is not None:
        settings = settings.model_copy(update={"detect_conf_threshold": args.threshold})
    rule = decision_rule(settings)
    model = FireSmokeModel(
        settings.model_path, settings.model_name, settings.model_sha256, settings.model_threads
    )
    evidence = EvidenceStore(args.evidence_dir / "pehradar-validation-evidence", max_files=100)
    print(f"model={model.name} rule: {rule.describe()}")
    for clip in args.clips:
        r = analyze_video(
            clip, model, rule, settings.video_sample_fps, settings.video_max_seconds, evidence
        )
        peaks = " ".join(
            f"{v.label}:peak={v.peak_confidence:.2f}@{v.peak_offset_s}s pos={v.positive_frames}"
            f"{'*' if v.confirmed else ''}"
            for v in r.verdicts.values()
        )
        status = "DETECTED " + r.event_type if r.event_type else "not_detected"
        evidence_path = evidence.path_for(r.evidence_id) if r.evidence_id else None
        print(
            f"{clip.name:40} {status:22} sampled={r.frames_sampled:3} {peaks} "
            f"time={r.processing_s:.2f}s infer={r.inference_ms_per_frame}ms/frame "
            f"peak_rss={r.peak_rss_mb}MB evidence={evidence_path or '-'}"
        )


if __name__ == "__main__":
    main()

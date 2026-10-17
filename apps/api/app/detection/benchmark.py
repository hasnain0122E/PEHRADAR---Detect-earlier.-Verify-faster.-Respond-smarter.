"""Decode/sampling benchmark for a local video (M1d feasibility).

Run:  uv run python -m app.detection.benchmark path/to/clip.mp4 [--sample-fps 2]
Prints JSON. Run it in a fresh process so peak_rss_mb reflects this clip only.
"""

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from app.detection.video import process_video


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video", type=Path)
    parser.add_argument("--sample-fps", type=float, default=2.0)
    parser.add_argument("--max-seconds", type=float, default=None)
    parser.add_argument("--decode-threads", type=int, default=1, help="0 = OpenCV/FFmpeg auto")
    args = parser.parse_args()

    report = process_video(args.video, args.sample_fps, args.max_seconds, args.decode_threads)
    result = {"input_size_mb": round(args.video.stat().st_size / 1024 / 1024, 2), **asdict(report)}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

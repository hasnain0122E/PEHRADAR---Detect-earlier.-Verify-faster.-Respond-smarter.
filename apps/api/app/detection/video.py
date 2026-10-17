"""Video decode and frame sampling with OpenCV (M1d feasibility). No detection here.

Frames are processed one at a time and never accumulated, so memory stays flat
regardless of clip length. Unsampled frames are only grabbed, never retrieved/converted.
"""

import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.detection import memory

DOWNSCALE_LONG_SIDE = 640  # Techspec §4.1: frames are resized to 640 px before detection
RSS_PROBE_EVERY = 10  # sampled frames between RSS readings


class VideoError(Exception):
    code = "VIDEO_UNREADABLE"


class VideoTooLong(VideoError):
    code = "VIDEO_TOO_LONG"


@dataclass(frozen=True)
class VideoMetadata:
    width: int
    height: int
    fps: float
    frame_count: int | None  # container-reported; can be missing or approximate
    duration_s: float | None


@dataclass(frozen=True)
class VideoReport:
    metadata: VideoMetadata
    sample_fps: float
    decode_threads: int
    frames_decoded: int
    frames_sampled: int
    processed_duration_s: float
    processing_s: float
    cpu_s: float  # CPU time across all decoder threads; wall time on a throttled host >= this
    effective_sampled_fps: float
    rss_before_mb: float | None
    rss_max_during_mb: float | None
    rss_after_mb: float | None
    peak_rss_mb: float | None  # process-lifetime peak


@contextmanager
def open_video(path: str | Path, decode_threads: int = 1) -> Iterator[cv2.VideoCapture]:
    # One decoder thread: same CPU work as multi-threaded decode without the thread overhead,
    # and about half the frame-buffer memory (M1d measurements). Suits a 0.1-CPU host.
    params = [cv2.CAP_PROP_N_THREADS, decode_threads] if decode_threads > 0 else []
    capture = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG, params)
    try:
        if not capture.isOpened():
            raise VideoError("OpenCV could not open the video")
        yield capture
    finally:
        capture.release()


def read_metadata(capture: cv2.VideoCapture) -> VideoMetadata:
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if width <= 0 or height <= 0 or not fps > 0:
        raise VideoError("Video has no readable frame size or frame rate")
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_count = count if count > 0 else None
    duration = round(frame_count / fps, 3) if frame_count else None
    return VideoMetadata(width, height, round(fps, 3), frame_count, duration)


class FrameSampler:
    """Iterates (offset_s, frame) for sampled frames; counts every decoded frame.

    Unsampled frames are only grabbed. Enforces max_seconds on real frames, because container
    metadata can understate the length.
    """

    def __init__(
        self,
        capture: cv2.VideoCapture,
        meta: VideoMetadata,
        sample_fps: float,
        max_seconds: float | None = None,
    ):
        if not sample_fps > 0:
            raise ValueError("sample_fps must be positive")
        if max_seconds is not None and meta.duration_s and meta.duration_s > max_seconds:
            raise VideoTooLong(f"Video is {meta.duration_s:.1f} s; the limit is {max_seconds:g} s")
        self._capture = capture
        self._fps = meta.fps
        self._step = max(1, round(meta.fps / sample_fps))
        self._max_seconds = max_seconds
        self._max_frames = int(max_seconds * meta.fps) + 1 if max_seconds is not None else None
        self.frames_decoded = 0
        self.frames_sampled = 0

    def __iter__(self) -> Iterator[tuple[float, np.ndarray]]:
        while self._capture.grab():
            index = self.frames_decoded
            if self._max_frames is not None and index >= self._max_frames:
                raise VideoTooLong(f"Video exceeds the {self._max_seconds:g} s limit")
            self.frames_decoded += 1
            if index % self._step == 0:
                ok, frame = self._capture.retrieve()
                if not ok:
                    raise VideoError(f"Frame {index} could not be decoded")
                self.frames_sampled += 1
                yield round(index / self._fps, 3), frame
        if self.frames_sampled == 0:
            raise VideoError("No frames could be decoded")


def process_video(
    path: str | Path,
    sample_fps: float,
    max_seconds: float | None = None,
    decode_threads: int = 1,
) -> VideoReport:
    rss_before = memory.rss_mb()
    rss_max = rss_before
    started = time.perf_counter()
    cpu_started = time.process_time()

    with open_video(path, decode_threads) as capture:
        meta = read_metadata(capture)
        sampler = FrameSampler(capture, meta, sample_fps, max_seconds)
        for _offset, frame in sampler:
            _downscale(frame)
            if sampler.frames_sampled % RSS_PROBE_EVERY == 0:
                rss_max = _max(rss_max, memory.rss_mb())

    elapsed = time.perf_counter() - started
    rss_after = memory.rss_mb()
    return VideoReport(
        metadata=meta,
        sample_fps=sample_fps,
        decode_threads=decode_threads,
        frames_decoded=sampler.frames_decoded,
        frames_sampled=sampler.frames_sampled,
        processed_duration_s=round(sampler.frames_decoded / meta.fps, 3),
        processing_s=round(elapsed, 3),
        cpu_s=round(time.process_time() - cpu_started, 3),
        effective_sampled_fps=round(sampler.frames_sampled / elapsed, 2) if elapsed > 0 else 0.0,
        rss_before_mb=rss_before,
        rss_max_during_mb=_max(rss_max, rss_after),
        rss_after_mb=rss_after,
        peak_rss_mb=memory.peak_rss_mb(),
    )


def _downscale(frame) -> None:
    # Stand-in for detector preprocessing so the timing includes the resize cost.
    height, width = frame.shape[:2]
    scale = DOWNSCALE_LONG_SIDE / max(height, width)
    if scale < 1:
        cv2.resize(frame, (round(width * scale), round(height * scale)), cv2.INTER_AREA)


def _max(a: float | None, b: float | None) -> float | None:
    values = [v for v in (a, b) if v is not None]
    return max(values) if values else None

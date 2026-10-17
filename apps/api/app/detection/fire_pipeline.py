"""Video → sampled frames → fire/smoke model → temporal decision → evidence frame.

Frames are processed one at a time. The only frames kept in memory are the current best
candidate per class, so the evidence frame can be written after the decision is made.
"""

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np

from app.detection import memory
from app.detection.evidence import EvidenceStore
from app.detection.fire_model import Detection, FramePrediction
from app.detection.video import FrameSampler, VideoMetadata, open_video, read_metadata
from app.domain.fire_decision import ClassVerdict, DecisionRule, FrameScores, decide, event_type


class Detector(Protocol):
    name: str
    labels: list[str]

    def predict(self, frame_bgr: np.ndarray, conf_threshold: float) -> FramePrediction: ...


@dataclass
class _Candidate:
    score: float
    offset_s: float
    frame: np.ndarray
    detections: list[Detection]


@dataclass
class FireAnalysis:
    metadata: VideoMetadata
    verdicts: dict[str, ClassVerdict]
    event_type: str | None
    frames_sampled: int
    frames_decoded: int
    positive_frames: int  # sampled frames positive for any class
    processing_s: float
    inference_ms_per_frame: float
    evidence_id: str | None
    evidence_offset_s: float | None
    evidence_detections: list[Detection] = field(default_factory=list)
    peak_rss_mb: float | None = None


def analyze_video(
    path: str | Path,
    detector: Detector,
    rule: DecisionRule,
    sample_fps: float,
    max_seconds: float | None,
    evidence: EvidenceStore,
) -> FireAnalysis:
    started = time.perf_counter()
    inference_s = 0.0
    frames: list[FrameScores] = []
    best: dict[str, _Candidate] = {}
    positive_any = 0

    with open_video(path) as capture:
        meta = read_metadata(capture)
        sampler = FrameSampler(capture, meta, sample_fps, max_seconds)
        for offset, frame in sampler:
            t = time.perf_counter()
            prediction = detector.predict(frame, rule.conf_threshold)
            inference_s += time.perf_counter() - t
            frames.append(FrameScores(offset, prediction.max_scores))
            positive_any += any(s >= rule.conf_threshold for s in prediction.max_scores.values())
            for label in detector.labels:
                score = prediction.max_scores.get(label, 0.0)
                current = best.get(label)
                has_box = any(d.label == label for d in prediction.detections)
                if has_box and (current is None or score > current.score):
                    best[label] = _Candidate(score, offset, frame.copy(), prediction.detections)

    verdicts = decide(frames, detector.labels, rule)
    kind = event_type(verdicts)
    evidence_id = evidence_offset = None
    evidence_dets: list[Detection] = []
    confirmed = [best[label] for label, v in verdicts.items() if v.confirmed and label in best]
    if confirmed:
        chosen = max(confirmed, key=lambda c: c.score)
        caption = f"{detector.name} | t={chosen.offset_s:.1f}s | {kind}"
        evidence_id = evidence.save(chosen.frame, chosen.detections, caption)
        evidence_offset, evidence_dets = chosen.offset_s, chosen.detections

    sampled = sampler.frames_sampled
    return FireAnalysis(
        metadata=meta,
        verdicts=verdicts,
        event_type=kind,
        frames_sampled=sampled,
        frames_decoded=sampler.frames_decoded,
        positive_frames=positive_any,
        processing_s=round(time.perf_counter() - started, 3),
        inference_ms_per_frame=round(inference_s / sampled * 1000, 1) if sampled else 0.0,
        evidence_id=evidence_id,
        evidence_offset_s=evidence_offset,
        evidence_detections=evidence_dets,
        peak_rss_mb=memory.peak_rss_mb(),
    )

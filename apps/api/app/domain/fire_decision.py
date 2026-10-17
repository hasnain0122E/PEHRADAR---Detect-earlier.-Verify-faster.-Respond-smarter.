"""Temporal confirmation of fire/smoke across sampled frames. Pure functions, no I/O.

A sampled frame is *positive* for a class when that class's best score is >= conf_threshold.
A class is *confirmed* when either:
  1. at least `min_positive_frames` of any `window_frames` consecutive sampled frames are positive
     (with 2 fps sampling, the defaults 3-of-5 mean "seen in 3 frames within ~2.5 s"), or
  2. a single frame scores >= `single_frame_confidence` (0 disables this rule).
Each class is decided independently; the event type is built from the confirmed classes only.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class DecisionRule:
    conf_threshold: float
    min_positive_frames: int
    window_frames: int
    single_frame_confidence: float  # 0 = disabled

    def describe(self) -> str:
        text = (
            f"score >= {self.conf_threshold:g} in >= {self.min_positive_frames} of any "
            f"{self.window_frames} consecutive sampled frames"
        )
        if self.single_frame_confidence > 0:
            text += f", or any single frame >= {self.single_frame_confidence:g}"
        return text


@dataclass(frozen=True)
class FrameScores:
    offset_s: float
    scores: Mapping[str, float]  # best score per class in this frame


@dataclass(frozen=True)
class ClassVerdict:
    label: str
    confirmed: bool
    reason: str | None  # "window" | "single_frame" | None
    positive_frames: int
    peak_confidence: float
    peak_offset_s: float | None


def decide(
    frames: Sequence[FrameScores], labels: Sequence[str], rule: DecisionRule
) -> dict[str, ClassVerdict]:
    return {label: _decide_class(frames, label, rule) for label in labels}


def event_type(verdicts: Mapping[str, ClassVerdict]) -> str | None:
    """Joined names of the confirmed classes in model order, e.g. "fire", "fire_smoke"."""
    confirmed = [label for label, v in verdicts.items() if v.confirmed]
    return "_".join(confirmed) if confirmed else None


def _decide_class(frames: Sequence[FrameScores], label: str, rule: DecisionRule) -> ClassVerdict:
    scores = [f.scores.get(label, 0.0) for f in frames]
    positive = [s >= rule.conf_threshold for s in scores]
    peak_index = max(range(len(scores)), key=scores.__getitem__) if scores else None
    peak = scores[peak_index] if peak_index is not None else 0.0

    reason = None
    if _window_hit(positive, rule.min_positive_frames, rule.window_frames):
        reason = "window"
    elif rule.single_frame_confidence > 0 and peak >= rule.single_frame_confidence:
        reason = "single_frame"
    return ClassVerdict(
        label=label,
        confirmed=reason is not None,
        reason=reason,
        positive_frames=sum(positive),
        peak_confidence=round(peak, 4),
        peak_offset_s=frames[peak_index].offset_s if peak_index is not None else None,
    )


def _window_hit(positive: Sequence[bool], needed: int, window: int) -> bool:
    if needed <= 0:
        return False
    window = max(window, needed)
    count = 0
    for i, hit in enumerate(positive):
        count += hit
        if i >= window:
            count -= positive[i - window]
        if count >= needed:
            return True
    return False

from app.domain.fire_decision import DecisionRule, FrameScores, decide, event_type

LABELS = ["fire", "smoke"]
RULE = DecisionRule(
    conf_threshold=0.45, min_positive_frames=3, window_frames=5, single_frame_confidence=0
)


def frames(fire: list[float], smoke: list[float] | None = None) -> list[FrameScores]:
    smoke = smoke or [0.0] * len(fire)
    return [
        FrameScores(offset_s=i * 0.5, scores={"fire": f, "smoke": s})
        for i, (f, s) in enumerate(zip(fire, smoke, strict=True))
    ]


def test_no_positive_frames_is_not_detected():
    verdicts = decide(frames([0.1, 0.2, 0.44, 0.3]), LABELS, RULE)

    assert not verdicts["fire"].confirmed
    assert verdicts["fire"].positive_frames == 0
    assert verdicts["fire"].peak_confidence == 0.44
    assert event_type(verdicts) is None


def test_three_positives_within_five_frames_confirms():
    verdicts = decide(frames([0.5, 0.1, 0.6, 0.2, 0.7, 0.1]), LABELS, RULE)

    assert verdicts["fire"].confirmed
    assert verdicts["fire"].reason == "window"
    assert verdicts["fire"].positive_frames == 3
    assert verdicts["fire"].peak_offset_s == 2.0
    assert event_type(verdicts) == "fire"


def test_isolated_flickers_are_not_confirmed():
    # Three positives, but never three within any five consecutive frames.
    scores = [0.9, 0, 0, 0, 0, 0.9, 0, 0, 0, 0, 0.9]

    verdicts = decide(frames(scores), LABELS, RULE)

    assert verdicts["fire"].positive_frames == 3
    assert not verdicts["fire"].confirmed


def test_threshold_is_inclusive():
    verdicts = decide(frames([0.45, 0.45, 0.45]), LABELS, RULE)

    assert verdicts["fire"].confirmed


def test_single_frame_rule_only_when_enabled():
    data = frames([0.0, 0.95, 0.0])
    strict = RULE
    lenient = DecisionRule(0.45, 3, 5, single_frame_confidence=0.9)

    assert not decide(data, LABELS, strict)["fire"].confirmed
    verdict = decide(data, LABELS, lenient)["fire"]
    assert verdict.confirmed and verdict.reason == "single_frame"


def test_classes_are_decided_independently():
    verdicts = decide(frames([0.6, 0.6, 0.6], [0.6, 0.6, 0.6]), LABELS, RULE)

    assert event_type(verdicts) == "fire_smoke"
    smoke_only = decide(frames([0.0, 0.0, 0.0], [0.6, 0.6, 0.6]), LABELS, RULE)
    assert event_type(smoke_only) == "smoke"


def test_empty_video_has_no_verdict():
    verdicts = decide([], LABELS, RULE)

    assert not verdicts["fire"].confirmed
    assert verdicts["fire"].peak_offset_s is None


def test_rule_description_is_human_readable():
    assert RULE.describe() == ("score >= 0.45 in >= 3 of any 5 consecutive sampled frames")

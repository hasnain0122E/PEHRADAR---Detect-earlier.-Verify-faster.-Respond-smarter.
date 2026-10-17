"""M5 automated demo scenario engine.

A scenario (seed/scenarios.json) names a demo-stream camera, a licensed sample clip and a delay.
Starting it stores a `scheduled` ScenarioRun. A background worker calls `tick()` about once a
second; when a run's trigger time passes, the worker claims it, runs the clip through the REAL
fire/smoke detector (the same path as POST /detect/fire), and stores the outcome:

- temporal rule confirmed fire/smoke → an ordinary pending DetectionEvent (real confidence and
  evidence) that the operator must Confirm or Reject;
- not confirmed → nothing is stored except the run result.

The engine never confirms a detection, creates an incident or picks a station.
"""

import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from app.db import utc_now
from app.detection.evidence import EvidenceStore
from app.detection.fire_pipeline import Detector
from app.domain.fire_decision import DecisionRule
from app.models import Camera, ScenarioRun
from app.services import fire_detection

logger = logging.getLogger("uvicorn.error")

API_DIR = Path(__file__).resolve().parents[2]
SCENARIO_FILE = API_DIR / "seed" / "scenarios.json"
ASSET_DIR = API_DIR / "demo_assets"
ACTIVE = ("scheduled", "running")


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    enabled: bool
    camera_code: str
    video_asset: str
    trigger_after_seconds: float
    expected_behavior: str
    description: str


class ScenarioError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def load_scenarios(path: Path = SCENARIO_FILE, asset_dir: Path = ASSET_DIR) -> list[Scenario]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    scenarios = []
    for row in raw["scenarios"]:
        scenario = Scenario(
            id=row["id"],
            name=row["name"],
            enabled=bool(row.get("enabled", True)),
            camera_code=row["camera_code"],
            video_asset=row["video_asset"],
            trigger_after_seconds=float(row["trigger_after_seconds"]),
            expected_behavior=row["expected_behavior"],
            description=row.get("description", ""),
        )
        if not (asset_dir / scenario.video_asset).is_file():
            raise ValueError(f"Scenario {scenario.id}: missing asset {scenario.video_asset}")
        scenarios.append(scenario)
    if len({s.id for s in scenarios}) != len(scenarios):
        raise ValueError("Duplicate scenario id")
    return scenarios


class ScenarioEngine:
    def __init__(
        self,
        scenarios: list[Scenario],
        sessions: sessionmaker[Session],
        detector: Callable[[], Detector],
        rule: DecisionRule,
        evidence: EvidenceStore,
        *,
        sample_fps: float,
        max_seconds: float,
        delay_override_s: float | None = None,
        asset_dir: Path = ASSET_DIR,
        clock: Callable[[], datetime] = utc_now,
    ):
        self.scenarios = {s.id: s for s in scenarios}
        self.sessions = sessions
        self.detector = detector
        self.rule = rule
        self.evidence = evidence
        self.sample_fps = sample_fps
        self.max_seconds = max_seconds
        self.delay_override_s = delay_override_s
        self.asset_dir = asset_dir
        self.clock = clock
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # --- operator actions ---

    def start(self, session: Session, scenario_id: str, operator: str | None) -> ScenarioRun:
        scenario = self.scenarios.get(scenario_id)
        if scenario is None or not scenario.enabled:
            raise ScenarioError(404, "SCENARIO_NOT_FOUND", "Scenario not found or disabled")
        active = session.scalar(
            select(ScenarioRun.id).where(
                ScenarioRun.scenario_id == scenario.id, ScenarioRun.status.in_(ACTIVE)
            )
        )
        if active:
            raise ScenarioError(409, "SCENARIO_ALREADY_RUNNING", "This scenario is already running")
        camera = session.scalar(select(Camera).where(Camera.code == scenario.camera_code))
        if camera is None:
            raise ScenarioError(409, "SCENARIO_CAMERA_MISSING", "The scenario camera is not seeded")
        delay = (
            self.delay_override_s
            if self.delay_override_s is not None
            else scenario.trigger_after_seconds
        )
        now = self.clock()
        run = ScenarioRun(
            scenario_id=scenario.id,
            camera_id=camera.id,
            video_asset=scenario.video_asset,
            status="scheduled",
            started_by=operator,
            trigger_at=now + timedelta(seconds=delay),
            created_at=now,
        )
        session.add(run)
        session.commit()
        return run

    # --- worker ---

    def recover(self) -> None:
        """A run left `running` by a restart can never finish: mark it failed."""
        with self.sessions() as session:
            session.execute(
                update(ScenarioRun)
                .where(ScenarioRun.status == "running")
                .values(status="failed", completed_at=self.clock(), error="Interrupted by restart")
            )
            session.commit()

    def tick(self) -> int:
        """Processes every due run once. Returns the number of runs processed."""
        processed = 0
        while (run_id := self._claim_due()) is not None:
            self._execute(run_id)
            processed += 1
        return processed

    def _claim_due(self) -> str | None:
        now = self.clock()
        with self.sessions() as session:
            candidates = session.scalars(
                select(ScenarioRun.id)
                .where(ScenarioRun.status == "scheduled", ScenarioRun.trigger_at <= now)
                .order_by(ScenarioRun.trigger_at)
                .limit(5)
            ).all()
            for run_id in candidates:
                # Conditional update: only one worker can move a run from scheduled to running.
                claimed = session.execute(
                    update(ScenarioRun)
                    .where(ScenarioRun.id == run_id, ScenarioRun.status == "scheduled")
                    .values(status="running", triggered_at=now)
                )
                session.commit()
                if claimed.rowcount == 1:
                    return run_id
        return None

    def _execute(self, run_id: str) -> None:
        with self.sessions() as session:
            run = session.get(ScenarioRun, run_id)
            camera = session.get(Camera, run.camera_id)
            path = self.asset_dir / run.video_asset
            try:
                model = self.detector()
                # Detect without a camera first: the detection is stored only if the run was not
                # cancelled (demo reset) while the model was running.
                body, result = fire_detection.analyze(
                    path,
                    path.stat().st_size,
                    model,
                    self.rule,
                    self.sample_fps,
                    self.max_seconds,
                    self.evidence,
                )
            except Exception as exc:
                logger.exception("Scenario run %s failed", run_id)
                session.rollback()
                self._finish(session, run_id, "failed", None, f"{type(exc).__name__}: {exc}"[:500])
                return
            session.refresh(run)
            if run.status != "running":
                return  # cancelled while analysing; discard the result
            detection_id = None
            if body["status"] == "detected":
                detection_id = fire_detection.record_pending(
                    session,
                    camera,
                    body,
                    result,
                    model.name,
                    self.rule,
                    self.evidence,
                    source={
                        "kind": "scenario",
                        "scenario_id": run.scenario_id,
                        "scenario_run_id": run.id,
                        "video_asset": run.video_asset,
                    },
                )
            self._finish(
                session,
                run_id,
                "detected" if detection_id else "not_detected",
                summarize(body),
                None,
                detection_id,
            )

    def _finish(self, session, run_id, status, result, error, detection_id=None) -> None:
        run = session.get(ScenarioRun, run_id)
        run.status, run.completed_at = status, self.clock()
        run.result, run.error, run.detection_event_id = result, error, detection_id
        session.commit()

    def start_worker(self, interval_s: float = 1.0) -> None:
        self.recover()

        def loop() -> None:
            while not self._stop.wait(interval_s):
                try:
                    self.tick()
                except Exception:
                    logger.exception("Scenario worker tick failed")

        self._thread = threading.Thread(target=loop, name="scenario-worker", daemon=True)
        self._thread.start()

    def stop_worker(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)


def summarize(body: dict) -> dict:
    """The run's record of what the real detector returned."""
    return {
        "status": body["status"],
        "event_type": body["event_type"],
        "confidence": body["confidence"],
        "sampled_frames": body["sampled_frames"],
        "positive_frames": body["positive_frames"],
        "processing_seconds": body["processing_seconds"],
        "model": body["model"],
        "rule": body["rule"],
        "classes": {
            label: {
                "confirmed": c["confirmed"],
                "peak_confidence": c["peak_confidence"],
                "positive_frames": c["positive_frames"],
            }
            for label, c in body["classes"].items()
        },
    }

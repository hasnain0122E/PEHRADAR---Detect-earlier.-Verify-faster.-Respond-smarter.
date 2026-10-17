"""Demo scenarios (M5) and the demo media they play.

GET  /scenarios                 configured scenarios + each one's latest run (public read)
POST /scenarios/{id}/start      schedule a run (operator)
POST /scenarios/reset           demo reset (operator)
GET  /media/{name}              licensed demo clips from demo_assets/ (Range requests supported)
"""

import re

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.config import Settings
from app.db import DbSession, utc_now
from app.models import Camera, ScenarioRun
from app.routers.security import operator_error
from app.routers.serializers import scenario_run_json
from app.routers.uploads import error_response
from app.services import operations
from app.services.operations import OperationError
from app.services.scenarios import ASSET_DIR, ScenarioEngine, ScenarioError

ASSET_NAME = re.compile(r"^[a-z0-9_]{1,60}\.mp4$")
DISCLAIMER = (
    "Demo scenario: licensed sample footage on a simulated node, analysed by the real detector. "
    "Not a real Karachi camera or event."
)


class StartBody(BaseModel):
    operator: str | None = Field(default=None, max_length=80)


def build_router(settings: Settings, engine: ScenarioEngine | None) -> APIRouter:
    router = APIRouter()

    def disabled():
        return error_response(
            404, "SCENARIOS_DISABLED", "Demo scenarios are not enabled on this server"
        )

    @router.get("/scenarios")
    def list_scenarios(session: DbSession):
        if engine is None:
            return {"enabled": False, "server_time": utc_now().isoformat(), "items": []}
        cameras = {
            c.code: c
            for c in session.scalars(
                select(Camera).where(
                    Camera.code.in_([s.camera_code for s in engine.scenarios.values()])
                )
            )
        }
        items = []
        for scenario in engine.scenarios.values():
            if not scenario.enabled:
                continue
            latest = session.scalar(
                select(ScenarioRun)
                .where(ScenarioRun.scenario_id == scenario.id)
                .order_by(ScenarioRun.created_at.desc())
                .limit(1)
            )
            camera = cameras.get(scenario.camera_code)
            items.append(
                {
                    "id": scenario.id,
                    "name": scenario.name,
                    "description": scenario.description,
                    "camera_id": camera.id if camera else None,
                    "camera_code": scenario.camera_code,
                    "video_asset": scenario.video_asset,
                    "trigger_after_seconds": engine.delay_override_s
                    if engine.delay_override_s is not None
                    else scenario.trigger_after_seconds,
                    "expected_behavior": scenario.expected_behavior,
                    "latest_run": scenario_run_json(latest),
                }
            )
        return {
            "enabled": True,
            "server_time": utc_now().isoformat(),
            "disclaimer": DISCLAIMER,
            "items": items,
        }

    @router.post("/scenarios/reset")
    def reset(session: DbSession, request: Request):
        if engine is None:
            return disabled()
        if denied := operator_error(request, settings):
            return denied
        try:
            return operations.reset_scenario_data(session)
        except OperationError as exc:
            return error_response(exc.status, exc.code, exc.message)

    @router.post("/scenarios/{scenario_id}/start")
    def start(
        session: DbSession, scenario_id: str, request: Request, body: StartBody | None = None
    ):
        if engine is None:
            return disabled()
        if denied := operator_error(request, settings):
            return denied
        try:
            run = engine.start(session, scenario_id, (body or StartBody()).operator)
        except ScenarioError as exc:
            return error_response(exc.status, exc.code, exc.message)
        return scenario_run_json(run)

    @router.get("/media/{name}")
    def media(name: str):
        path = ASSET_DIR / name
        if not ASSET_NAME.fullmatch(name) or not path.is_file():
            return error_response(404, "NOT_FOUND", "Media not found")
        return FileResponse(
            path, media_type="video/mp4", headers={"Cache-Control": "public, max-age=3600"}
        )

    return router

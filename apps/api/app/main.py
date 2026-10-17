"""FastAPI entry point. Run with: uv run uvicorn app.main:app --reload"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import Settings, get_settings
from app.db import make_engine, make_sessionmaker
from app.detection.evidence import EvidenceStore
from app.detection.fire_model import FireSmokeModel, ModelUnavailable
from app.routers import detect, health, operations, scenarios
from app.routers.uploads import error_response
from app.routing import OsrmRouteProvider, RouteProvider
from app.services.scenarios import ScenarioEngine, load_scenarios

API_PREFIX = "/api/v1"

logger = logging.getLogger("uvicorn.error")


_DEFAULT = object()


def create_app(
    settings: Settings | None = None,
    models: detect.ModelProvider | None = None,
    route_provider: RouteProvider | None | object = _DEFAULT,
) -> FastAPI:
    settings = settings or get_settings()
    docs_enabled = settings.app_env != "production"
    models = models or detect.ModelProvider(lambda: _load_model(settings))
    if route_provider is _DEFAULT:
        route_provider = _route_provider(settings)
    holder: dict[str, ScenarioEngine | None] = {"engine": None}

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if settings.cv_runtime_check:
            _log_cv_runtime()
        try:
            models.get()  # load once at startup; a failure is logged and served as 503
        except ModelUnavailable:
            pass
        engine = holder["engine"]
        if engine is not None and settings.scenario_worker:
            engine.start_worker()
        yield
        if engine is not None:
            engine.stop_worker()

    app = FastAPI(
        title="PehRadar API",
        version=__version__,
        openapi_url=f"{API_PREFIX}/openapi.json" if docs_enabled else None,
        docs_url=f"{API_PREFIX}/docs" if docs_enabled else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    # Engine creation does not connect; the first query does. Migrations: `alembic upgrade head`.
    engine = make_engine(settings.sqlalchemy_url)
    app.state.engine = engine
    app.state.sessionmaker = sessions = make_sessionmaker(engine)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError):
        problems = [
            {"field": ".".join(str(p) for p in e.get("loc", ())), "message": e.get("msg", "")}
            for e in exc.errors()
        ]
        return error_response(422, "VALIDATION_ERROR", "Invalid request", problems=problems)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type", "X-Operator-Key"],
    )
    app.include_router(health.router, prefix=API_PREFIX)
    evidence = EvidenceStore(settings.evidence_dir, settings.evidence_max_files)
    app.include_router(detect.build_router(settings, models, evidence, sessions), prefix=API_PREFIX)
    app.include_router(operations.build_router(settings, route_provider), prefix=API_PREFIX)
    if settings.scenarios_active:
        holder["engine"] = ScenarioEngine(
            load_scenarios(),
            sessions,
            models.get,
            detect.decision_rule(settings),
            evidence,
            sample_fps=settings.video_sample_fps,
            max_seconds=settings.video_max_seconds,
            delay_override_s=settings.scenario_delay_override_s,
        )
    app.state.scenario_engine = holder["engine"]
    app.include_router(scenarios.build_router(settings, holder["engine"]), prefix=API_PREFIX)
    if settings.video_test_enabled:
        from app.routers import video_test

        app.include_router(video_test.build_router(settings), prefix=API_PREFIX)
    return app


def _route_provider(settings: Settings) -> RouteProvider | None:
    if settings.routing_provider == "none":
        return None
    return OsrmRouteProvider(settings.osrm_base_url, settings.routing_timeout_s)


def _load_model(settings: Settings) -> FireSmokeModel:
    return FireSmokeModel(
        settings.model_path, settings.model_name, settings.model_sha256, settings.model_threads
    )


def _log_cv_runtime() -> None:
    # Imported lazily so the heavy CV libraries load only when the check is enabled.
    from app.detection.runtime_check import check_cv_runtime

    report = check_cv_runtime()
    logger.info(
        "CV runtime check OK: opencv=%s numpy=%s onnxruntime=%s providers=%s "
        "session=%s rss_mb=%s peak_rss_mb=%s",
        report.opencv_version,
        report.numpy_version,
        report.onnxruntime_version,
        report.available_providers,
        report.session_providers,
        report.rss_mb,
        report.peak_rss_mb,
    )


app = create_app()

"""FastAPI entry point. Run with: uv run uvicorn app.main:app --reload"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import Settings, get_settings
from app.routers import health

API_PREFIX = "/api/v1"

logger = logging.getLogger("uvicorn.error")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    docs_enabled = settings.app_env != "production"

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if settings.cv_runtime_check:
            _log_cv_runtime()
        yield

    app = FastAPI(
        title="PehRadar API",
        version=__version__,
        openapi_url=f"{API_PREFIX}/openapi.json" if docs_enabled else None,
        docs_url=f"{API_PREFIX}/docs" if docs_enabled else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Operator-Key"],
    )
    app.include_router(health.router, prefix=API_PREFIX)
    if settings.video_test_enabled:
        # Imported lazily so OpenCV loads only when the M1d spike endpoint is enabled.
        from app.routers import video_test

        app.include_router(video_test.build_router(settings), prefix=API_PREFIX)
    return app


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

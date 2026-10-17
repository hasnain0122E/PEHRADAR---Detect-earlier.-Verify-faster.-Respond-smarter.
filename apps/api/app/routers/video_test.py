"""POST /video/test: M1d diagnostics endpoint (upload → decode/sample → metrics, no detection).

Mounted only when VIDEO_TEST_ENABLED=true. Upload guards live in app.routers.uploads.
"""

from dataclasses import asdict

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.config import Settings
from app.detection.video import process_video
from app.routers.uploads import handle_mp4_upload


def build_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    def process(path: str, size: int, _fields: dict[str, str]) -> JSONResponse:
        report = process_video(path, settings.video_sample_fps, settings.video_max_seconds)
        return JSONResponse({"size_bytes": size, **asdict(report)})

    @router.post("/video/test")
    async def video_test(request: Request):
        return await handle_mp4_upload(request, settings.max_upload_mb, process)

    return router

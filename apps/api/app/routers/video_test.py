"""POST /video/test: temporary M1d feasibility endpoint (upload → decode/sample → metrics).

Mounted only when VIDEO_TEST_ENABLED=true. Not the analysis-jobs API, and no detection.
Guards: Content-Length required and capped before the body is read, one request at a time,
.mp4 extension plus ISO-BMFF `ftyp` signature, server-chosen temp path deleted afterwards.
"""

import os
import shutil
import tempfile
import threading
from dataclasses import asdict

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from app.config import Settings
from app.detection.video import VideoError, process_video

MULTIPART_OVERHEAD_BYTES = 64 * 1024
COPY_CHUNK_BYTES = 1024 * 1024


def error_response(status: int, code: str, message: str, **details) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details}},
    )


def build_router(settings: Settings) -> APIRouter:
    router = APIRouter()
    busy = threading.Lock()
    max_bytes = int(settings.video_test_max_mb * 1024 * 1024)

    @router.post("/video/test")
    async def video_test(request: Request):
        declared = request.headers.get("content-length")
        if declared is None or not declared.isdigit():
            return error_response(411, "LENGTH_REQUIRED", "Content-Length header is required")
        if int(declared) > max_bytes + MULTIPART_OVERHEAD_BYTES:
            return _too_large(settings)
        if not request.headers.get("content-type", "").startswith("multipart/form-data"):
            return error_response(415, "UNSUPPORTED_MEDIA", "Send multipart/form-data")
        if not busy.acquire(blocking=False):
            return error_response(409, "VIDEO_TEST_BUSY", "Another video is being processed")
        try:
            async with request.form(max_files=1, max_fields=1) as form:
                upload = form.get("file")
                if not isinstance(upload, UploadFile):
                    return error_response(422, "VALIDATION_ERROR", "Missing form field 'file'")
                if not (upload.filename or "").lower().endswith(".mp4"):
                    return error_response(415, "UNSUPPORTED_MEDIA", "Only .mp4 files are accepted")
                return await run_in_threadpool(_process_upload, upload, settings, max_bytes)
        finally:
            busy.release()

    return router


def _process_upload(upload: UploadFile, settings: Settings, max_bytes: int) -> JSONResponse:
    fd, path = tempfile.mkstemp(prefix="pehradar-", suffix=".mp4")
    try:
        with os.fdopen(fd, "wb") as out:
            upload.file.seek(0)
            shutil.copyfileobj(upload.file, out, COPY_CHUNK_BYTES)
            size = out.tell()
        if size > max_bytes:
            return _too_large(settings)
        with open(path, "rb") as f:
            header = f.read(12)
        if header[4:8] != b"ftyp":
            return error_response(415, "UNSUPPORTED_MEDIA", "File is not an MP4 container")
        try:
            report = process_video(path, settings.video_sample_fps, settings.video_max_seconds)
        except VideoError as exc:
            return error_response(422, exc.code, str(exc))
        return JSONResponse({"size_bytes": size, **asdict(report)})
    finally:
        os.remove(path)


def _too_large(settings: Settings) -> JSONResponse:
    return error_response(
        413,
        "UPLOAD_TOO_LARGE",
        f"Upload exceeds {settings.video_test_max_mb:g} MB",
        max_mb=settings.video_test_max_mb,
    )

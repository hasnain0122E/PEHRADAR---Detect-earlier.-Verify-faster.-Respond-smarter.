"""Shared MP4 upload handling for the video endpoints.

Guards: Content-Length required and capped before the body is read, one video processed at a
time (process-wide), .mp4 extension plus ISO-BMFF `ftyp` signature, server-chosen temp path that
is always deleted. The client filename is used only for the extension check.
"""

import os
import shutil
import tempfile
import threading
from collections.abc import Callable

from fastapi import Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from app.detection.video import VideoError

MULTIPART_OVERHEAD_BYTES = 64 * 1024
COPY_CHUNK_BYTES = 1024 * 1024
MAX_TEXT_FIELDS = 2  # e.g. camera_id

# One video at a time across all endpoints: bounds CPU and RAM on a 0.15-CPU / 512 MB host.
_video_lock = threading.Lock()

# Receives (temp_path, size_bytes, other_form_fields) and returns the response. Runs in a worker
# thread. Other fields are the non-file form values (e.g. camera_id), as strings.
Processor = Callable[[str, int, dict[str, str]], JSONResponse]


def error_response(status: int, code: str, message: str, **details) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details}},
    )


async def handle_mp4_upload(request: Request, max_mb: float, process: Processor) -> JSONResponse:
    max_bytes = int(max_mb * 1024 * 1024)
    declared = request.headers.get("content-length")
    if declared is None or not declared.isdigit():
        return error_response(411, "LENGTH_REQUIRED", "Content-Length header is required")
    if int(declared) > max_bytes + MULTIPART_OVERHEAD_BYTES:
        return _too_large(max_mb)
    if not request.headers.get("content-type", "").startswith("multipart/form-data"):
        return error_response(415, "UNSUPPORTED_MEDIA", "Send multipart/form-data")
    if not _video_lock.acquire(blocking=False):
        return error_response(409, "VIDEO_BUSY", "Another video is being processed; retry shortly")
    try:
        async with request.form(max_files=1, max_fields=MAX_TEXT_FIELDS + 1) as form:
            upload = form.get("file")
            if not isinstance(upload, UploadFile):
                return error_response(422, "VALIDATION_ERROR", "Missing form field 'file'")
            if not (upload.filename or "").lower().endswith(".mp4"):
                return error_response(415, "UNSUPPORTED_MEDIA", "Only .mp4 files are accepted")
            fields = {k: v for k, v in form.items() if isinstance(v, str)}
            return await run_in_threadpool(_save_and_process, upload, max_mb, process, fields)
    finally:
        _video_lock.release()


def _save_and_process(
    upload: UploadFile, max_mb: float, process: Processor, fields: dict[str, str]
) -> JSONResponse:
    fd, path = tempfile.mkstemp(prefix="pehradar-", suffix=".mp4")
    try:
        with os.fdopen(fd, "wb") as out:
            upload.file.seek(0)
            shutil.copyfileobj(upload.file, out, COPY_CHUNK_BYTES)
            size = out.tell()
        if size > int(max_mb * 1024 * 1024):
            return _too_large(max_mb)
        with open(path, "rb") as f:
            header = f.read(12)
        if header[4:8] != b"ftyp":
            return error_response(415, "UNSUPPORTED_MEDIA", "File is not an MP4 container")
        try:
            return process(path, size, fields)
        except VideoError as exc:
            return error_response(422, exc.code, str(exc))
    finally:
        os.remove(path)


def _too_large(max_mb: float) -> JSONResponse:
    return error_response(413, "UPLOAD_TOO_LARGE", f"Upload exceeds {max_mb:g} MB", max_mb=max_mb)

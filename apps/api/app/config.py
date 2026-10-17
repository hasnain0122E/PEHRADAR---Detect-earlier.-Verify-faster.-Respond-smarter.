"""Application settings, loaded once from environment variables (see .env.example)."""

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_ID = "pehradar-api"
LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", protected_namespaces=()
    )

    app_env: Literal["development", "test", "production"] = "development"
    # Comma-separated list of exact browser origins allowed to call the API.
    # Unset: local dev origins outside production, and no browser origins in production.
    # Empty: no browser origins. Direct (non-browser) requests are never affected by CORS.
    cors_origins: str | None = None
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # M1c spike only: run the OpenCV/ONNX Runtime self-check at startup and log the result.
    # Startup fails if the check fails. Remove with the spike.
    cv_runtime_check: bool = False
    # M1d spike only: mounts POST /api/v1/video/test (404 when false). Remove with the spike.
    video_test_enabled: bool = False
    # Video limits shared by /video/test and /detect/fire (M1d: GO WITH LIMITS, Tracker D25).
    max_upload_mb: float = Field(default=20, gt=0)
    video_max_seconds: float = Field(default=60, gt=0)
    video_sample_fps: float = Field(default=2, gt=0)
    # Fire/smoke model (M2). The file is fetched at build time: python -m app.detection.fetch_model
    model_path: str = "models/fire_smoke_yolov8n_320.onnx"
    model_sha256: str | None = "f2699b753e78be8d392bfa63e64bf102ea3ceb8b6086a59dfd8192b61a0c6fad"
    model_name: str = "cctv-ai-fire-smoke-yolov8n-320@343990e"
    model_threads: int = Field(default=1, ge=1)
    # Temporal confirmation (app/domain/fire_decision.py).
    detect_conf_threshold: float = Field(default=0.45, gt=0, le=1)
    detect_min_positive_frames: int = Field(default=3, ge=1)
    detect_window_frames: int = Field(default=5, ge=1)
    detect_single_frame_confidence: float = Field(default=0.0, ge=0, le=1)  # 0 = disabled
    evidence_dir: str | None = None  # default: <system temp>/pehradar-evidence
    evidence_max_files: int = Field(default=20, ge=1)

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins is None:
            return [] if self.app_env == "production" else list(LOCAL_DEV_ORIGINS)
        return _parse_origins(self.cors_origins)

    @model_validator(mode="after")
    def _validate_cors(self) -> "Settings":
        for origin in self.cors_origin_list:
            if origin == "*":
                raise ValueError("CORS_ORIGINS must not contain '*'; list explicit origins")
            parts = urlsplit(origin)
            if parts.scheme not in ("http", "https") or not parts.netloc or parts.path:
                raise ValueError(f"Invalid CORS origin {origin!r}; expected scheme://host[:port]")
            if self.app_env == "production" and parts.scheme != "https":
                raise ValueError(f"CORS origin {origin!r} must use https in production")
        return self


def _parse_origins(raw: str) -> list[str]:
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

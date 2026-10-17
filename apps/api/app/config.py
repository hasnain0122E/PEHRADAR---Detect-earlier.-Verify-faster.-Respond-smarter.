"""Application settings, loaded once from environment variables (see .env.example)."""

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_ID = "pehradar-api"
LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    # Comma-separated list of exact browser origins allowed to call the API.
    # Unset: local dev origins outside production, and no browser origins in production.
    # Empty: no browser origins. Direct (non-browser) requests are never affected by CORS.
    cors_origins: str | None = None
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    # M1c spike only: run the OpenCV/ONNX Runtime self-check at startup and log the result.
    # Startup fails if the check fails. Remove with the spike.
    cv_runtime_check: bool = False

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

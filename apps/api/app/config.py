"""Application settings, loaded once from environment variables (see .env.example)."""

from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_ID = "pehradar-api"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: Literal["development", "test", "production"] = "development"
    # Comma-separated list of exact browser origins allowed to call the API.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return _parse_origins(self.cors_origins)

    @model_validator(mode="after")
    def _validate_cors(self) -> "Settings":
        origins = self.cors_origin_list
        if not origins:
            raise ValueError("CORS_ORIGINS must list at least one origin")
        for origin in origins:
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

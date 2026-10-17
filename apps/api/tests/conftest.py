import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

WEB_ORIGIN = "http://localhost:3000"


def make_settings(**overrides) -> Settings:
    # _env_file=None keeps a developer's local .env from leaking into tests.
    return Settings(_env_file=None, **overrides)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(make_settings(app_env="test", cors_origins=WEB_ORIGIN)))

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app

from .conftest import make_settings


def test_default_origins_are_local_dev_only():
    assert make_settings().cors_origin_list == ["http://localhost:3000", "http://127.0.0.1:3000"]


def test_origins_are_read_from_environment(monkeypatch):
    monkeypatch.setenv("CORS_ORIGINS", " https://a.example , https://b.example/ ")

    assert Settings(_env_file=None).cors_origin_list == ["https://a.example", "https://b.example"]


@pytest.mark.parametrize(
    "origins",
    ["*", "http://localhost:3000,*", "", "localhost:3000", "http://localhost:3000/app"],
)
def test_invalid_origins_are_rejected(origins):
    with pytest.raises(ValidationError):
        make_settings(cors_origins=origins)


def test_production_requires_https_origins():
    with pytest.raises(ValidationError):
        make_settings(app_env="production", cors_origins="http://pehradar.example")

    assert make_settings(app_env="production", cors_origins="https://pehradar.example")


def test_production_disables_interactive_docs():
    from fastapi.testclient import TestClient

    prod = TestClient(
        create_app(make_settings(app_env="production", cors_origins="https://pehradar.example"))
    )
    assert prod.get("/api/v1/docs").status_code == 404
    assert prod.get("/api/v1/openapi.json").status_code == 404
    assert prod.get("/api/v1/health").status_code == 200

from app import __version__
from app.config import APP_ID

from .conftest import WEB_ORIGIN


def test_health_returns_stable_payload(client):
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "app": APP_ID, "version": __version__}


def test_health_is_not_served_outside_api_prefix(client):
    assert client.get("/health").status_code == 404


def test_cors_allows_configured_origin(client):
    response = client.get("/api/v1/health", headers={"Origin": WEB_ORIGIN})

    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN


def test_cors_ignores_unlisted_origin(client):
    response = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers


def test_cors_preflight_for_configured_origin(client):
    response = client.options(
        "/api/v1/health",
        headers={"Origin": WEB_ORIGIN, "Access-Control-Request-Method": "GET"},
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == WEB_ORIGIN


def test_cors_preflight_rejects_unlisted_origin(client):
    response = client.options(
        "/api/v1/health",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )

    assert response.status_code == 400

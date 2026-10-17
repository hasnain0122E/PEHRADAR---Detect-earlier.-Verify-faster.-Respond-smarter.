import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Base
from app.main import create_app
from app.seed import seed

WEB_ORIGIN = "http://localhost:3000"
OPERATOR_KEY = "test-operator-key"
# Production settings require a PostgreSQL URL; tests that never query the DB use this one
# (engine creation does not connect).
UNUSED_PG_URL = "postgresql://user:pass@localhost:5432/unused"


def make_settings(**overrides) -> Settings:
    # _env_file=None keeps a developer's local .env from leaking into tests.
    if overrides.get("app_env") == "production":
        overrides.setdefault("database_url", UNUSED_PG_URL)
    # Tests never call the public OSRM server or start the scenario worker thread.
    overrides.setdefault("routing_provider", "none")
    overrides.setdefault("scenario_worker", False)
    return Settings(_env_file=None, **overrides)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(make_settings(app_env="test", cors_origins=WEB_ORIGIN)))


def make_db_app(tmp_path, models=None, seeded: bool = True, app_kwargs=None, **overrides):
    """App on a fresh SQLite file with tables created (and the Karachi seed loaded)."""
    settings = make_settings(
        app_env="test",
        database_url=f"sqlite:///{(tmp_path / 'test.db').as_posix()}",
        operator_api_key=OPERATOR_KEY,
        evidence_dir=str(tmp_path / "evidence"),
        **overrides,
    )
    app = create_app(settings, models=models, **(app_kwargs or {}))
    Base.metadata.create_all(app.state.engine)
    if seeded:
        with app.state.sessionmaker() as session:
            seed(session)
    return app

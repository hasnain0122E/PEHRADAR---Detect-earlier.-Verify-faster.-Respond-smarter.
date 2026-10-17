"""m5 monitoring network, provenance, scenarios and routes

Forward-safe: only adds nullable columns or columns with server defaults, one new table, and
widens two CHECK constraints. Existing rows keep their data; the seed then fills the new fields.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-17 16:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SOURCE_TYPES = (
    "source_type IN ('public_live', 'verified_mapped', 'simulated_coverage', 'demo_stream')"
)
STREAM_TYPES = "stream_type IN ('hls', 'mjpeg', 'mp4_loop', 'none')"
FACILITY_TYPES = (
    "facility_type IN ('municipal_fire_station', 'port_fire_station', 'airport_fire_station', "
    "'industrial_fire_station', 'rescue_station', 'institutional_fire_response', "
    "'fire_station_unclassified')"
)
TIMELINE_OLD = (
    "event_type IN ('detection_created', 'operator_confirmed', 'station_selected', "
    "'no_station_available', 'status_changed', 'resolved', 'rejected')"
)
TIMELINE_NEW = (
    "event_type IN ('detection_created', 'operator_confirmed', 'station_selected', "
    "'no_station_available', 'route_generated', 'route_unavailable', 'status_changed', "
    "'resolved', 'rejected')"
)
RUN_STATUSES = (
    "status IN ('scheduled', 'running', 'detected', 'not_detected', 'failed', 'cancelled')"
)


def upgrade() -> None:
    with op.batch_alter_table("camera") as batch:
        batch.add_column(sa.Column("district", sa.String(length=60), nullable=True))
        batch.add_column(
            sa.Column(
                "camera_type", sa.String(length=30), nullable=False, server_default="fixed_cctv"
            )
        )
        batch.add_column(
            sa.Column(
                "source_type",
                sa.String(length=30),
                nullable=False,
                server_default="simulated_coverage",
            )
        )
        batch.add_column(sa.Column("source_reference", sa.String(length=300), nullable=True))
        batch.add_column(
            sa.Column("stream_type", sa.String(length=20), nullable=False, server_default="none")
        )
        batch.add_column(sa.Column("stream_url", sa.String(length=500), nullable=True))
        batch.add_column(sa.Column("feed_asset", sa.String(length=80), nullable=True))
        batch.create_check_constraint("ck_camera_source_type", SOURCE_TYPES)
        batch.create_check_constraint("ck_camera_stream_type", STREAM_TYPES)

    with op.batch_alter_table("fire_station") as batch:
        batch.add_column(sa.Column("operator", sa.String(length=160), nullable=True))
        batch.add_column(
            sa.Column(
                "facility_type",
                sa.String(length=40),
                nullable=False,
                server_default="fire_station_unclassified",
            )
        )
        batch.add_column(
            sa.Column(
                "availability_is_demo", sa.Boolean(), nullable=False, server_default=sa.true()
            )
        )
        batch.create_check_constraint("ck_fire_station_facility", FACILITY_TYPES)

    with op.batch_alter_table("incident") as batch:
        batch.add_column(sa.Column("route", sa.JSON(), nullable=True))

    with op.batch_alter_table("incident_timeline_event") as batch:
        batch.drop_constraint("ck_timeline_event_type", type_="check")
        batch.create_check_constraint("ck_timeline_event_type", TIMELINE_NEW)

    op.create_table(
        "scenario_run",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("scenario_id", sa.String(length=60), nullable=False),
        sa.Column("camera_id", sa.String(length=36), nullable=False),
        sa.Column("video_asset", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_by", sa.String(length=80), nullable=True),
        sa.Column("trigger_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detection_event_id", sa.String(length=36), nullable=True),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(RUN_STATUSES, name="ck_scenario_run_status"),
        sa.ForeignKeyConstraint(["camera_id"], ["camera.id"]),
        sa.ForeignKeyConstraint(["detection_event_id"], ["detection_event.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scenario_run_scenario_id", "scenario_run", ["scenario_id"])
    op.create_index("ix_scenario_run_status_trigger", "scenario_run", ["status", "trigger_at"])


def downgrade() -> None:
    op.drop_index("ix_scenario_run_status_trigger", table_name="scenario_run")
    op.drop_index("ix_scenario_run_scenario_id", table_name="scenario_run")
    op.drop_table("scenario_run")
    with op.batch_alter_table("incident_timeline_event") as batch:
        batch.drop_constraint("ck_timeline_event_type", type_="check")
        batch.create_check_constraint("ck_timeline_event_type", TIMELINE_OLD)
    with op.batch_alter_table("incident") as batch:
        batch.drop_column("route")
    with op.batch_alter_table("fire_station") as batch:
        batch.drop_constraint("ck_fire_station_facility", type_="check")
        for column in ("availability_is_demo", "facility_type", "operator"):
            batch.drop_column(column)
    with op.batch_alter_table("camera") as batch:
        batch.drop_constraint("ck_camera_stream_type", type_="check")
        batch.drop_constraint("ck_camera_source_type", type_="check")
        for column in (
            "feed_asset",
            "stream_url",
            "stream_type",
            "source_reference",
            "source_type",
            "camera_type",
            "district",
        ):
            batch.drop_column(column)

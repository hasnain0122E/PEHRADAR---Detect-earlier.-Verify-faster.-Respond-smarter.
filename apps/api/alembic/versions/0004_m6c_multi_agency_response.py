"""m6c multi-agency response: police and ambulance facilities, response units

Forward-safe on SQLite and PostgreSQL (Neon): one column with a server default on fire_station
(every existing row becomes category 'fire'), one nullable JSON column on incident, and two
widened CHECK constraints. No existing row is changed or deleted. The seed then inserts the
police and ambulance facilities.

Downgrade removes the police/ambulance rows first (only seed data; incidents reference fire
stations only), then the columns, and restores the old CHECK constraints.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-18 18:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FACILITY_OLD = (
    "facility_type IN ('municipal_fire_station', 'port_fire_station', 'airport_fire_station', "
    "'industrial_fire_station', 'rescue_station', 'institutional_fire_response', "
    "'fire_station_unclassified')"
)
FACILITY_NEW = (
    "facility_type IN ('municipal_fire_station', 'port_fire_station', 'airport_fire_station', "
    "'industrial_fire_station', 'rescue_station', 'institutional_fire_response', "
    "'fire_station_unclassified', 'police_station', 'ambulance_station')"
)
CATEGORY = "category IN ('fire', 'police', 'ambulance')"
TIMELINE_OLD = (
    "event_type IN ('detection_created', 'operator_confirmed', 'station_selected', "
    "'no_station_available', 'route_generated', 'route_unavailable', 'detection_merged', "
    "'status_changed', 'resolved', 'rejected')"
)
TIMELINE_NEW = (
    "event_type IN ('detection_created', 'operator_confirmed', 'station_selected', "
    "'no_station_available', 'route_generated', 'route_unavailable', 'detection_merged', "
    "'resource_selected', 'no_resource_available', 'status_changed', 'resolved', 'rejected')"
)


def upgrade() -> None:
    with op.batch_alter_table("fire_station") as batch:
        batch.add_column(
            sa.Column("category", sa.String(length=20), nullable=False, server_default="fire")
        )
        batch.drop_constraint("ck_fire_station_facility", type_="check")
        batch.create_check_constraint("ck_fire_station_facility", FACILITY_NEW)
        batch.create_check_constraint("ck_fire_station_category", CATEGORY)
        batch.create_index("ix_fire_station_category", ["category"])
    with op.batch_alter_table("incident") as batch:
        batch.add_column(sa.Column("response_units", sa.JSON(), nullable=True))
    with op.batch_alter_table("incident_timeline_event") as batch:
        batch.drop_constraint("ck_timeline_event_type", type_="check")
        batch.create_check_constraint("ck_timeline_event_type", TIMELINE_NEW)


def downgrade() -> None:
    op.execute(
        "DELETE FROM incident_timeline_event WHERE event_type IN "
        "('resource_selected', 'no_resource_available')"
    )
    with op.batch_alter_table("incident_timeline_event") as batch:
        batch.drop_constraint("ck_timeline_event_type", type_="check")
        batch.create_check_constraint("ck_timeline_event_type", TIMELINE_OLD)
    with op.batch_alter_table("incident") as batch:
        batch.drop_column("response_units")
    op.execute("DELETE FROM fire_station WHERE category <> 'fire'")
    with op.batch_alter_table("fire_station") as batch:
        batch.drop_index("ix_fire_station_category")
        batch.drop_constraint("ck_fire_station_category", type_="check")
        batch.drop_constraint("ck_fire_station_facility", type_="check")
        batch.create_check_constraint("ck_fire_station_facility", FACILITY_OLD)
        batch.drop_column("category")

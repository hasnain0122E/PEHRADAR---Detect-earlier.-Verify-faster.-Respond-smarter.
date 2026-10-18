"""m6b demo feed provenance and the detection-merge timeline event

Forward-safe: one nullable JSON column and a widened CHECK constraint.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-18 10:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TIMELINE_OLD = (
    "event_type IN ('detection_created', 'operator_confirmed', 'station_selected', "
    "'no_station_available', 'route_generated', 'route_unavailable', 'status_changed', "
    "'resolved', 'rejected')"
)
TIMELINE_NEW = (
    "event_type IN ('detection_created', 'operator_confirmed', 'station_selected', "
    "'no_station_available', 'route_generated', 'route_unavailable', 'detection_merged', "
    "'status_changed', 'resolved', 'rejected')"
)


def upgrade() -> None:
    with op.batch_alter_table("camera") as batch:
        batch.add_column(sa.Column("feed_meta", sa.JSON(), nullable=True))
    with op.batch_alter_table("incident_timeline_event") as batch:
        batch.drop_constraint("ck_timeline_event_type", type_="check")
        batch.create_check_constraint("ck_timeline_event_type", TIMELINE_NEW)


def downgrade() -> None:
    with op.batch_alter_table("incident_timeline_event") as batch:
        batch.drop_constraint("ck_timeline_event_type", type_="check")
        batch.create_check_constraint("ck_timeline_event_type", TIMELINE_OLD)
    with op.batch_alter_table("camera") as batch:
        batch.drop_column("feed_meta")

"""Add currency and soft delete

Revision ID: 1acadea2853a
Revises: f964f98a0255
Create Date: 2025-12-17 20:08:23.610089

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector


# revision identifiers, used by Alembic.
revision: str = "1acadea2853a"
down_revision: Union[str, None] = "f964f98a0255"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Получаем инспектор, чтобы проверять, есть ли уже колонки
    conn = op.get_bind()
    inspector = Inspector.from_engine(conn)
    columns = [col["name"] for col in inspector.get_columns("transactions")]

    # 1. Добавляем is_deleted (Soft Delete)
    if "is_deleted" not in columns:
        op.add_column(
            "transactions", sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False)
        )

    # 2. Добавляем currency (Мультивалютность)
    if "currency" not in columns:
        # Ставим KZT по дефолту для старых записей, чтобы не было ошибок
        op.add_column("transactions", sa.Column("currency", sa.String(length=3), server_default="KZT", nullable=False))

    # 3. Добавляем original_amount
    if "original_amount" not in columns:
        op.add_column("transactions", sa.Column("original_amount", sa.Numeric(precision=10, scale=2), nullable=True))


def downgrade() -> None:
    # Удаляем колонки при откате
    op.drop_column("transactions", "original_amount")
    op.drop_column("transactions", "currency")
    op.drop_column("transactions", "is_deleted")

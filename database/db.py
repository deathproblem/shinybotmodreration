import json
from datetime import datetime
from typing import Tuple, List, Optional
import aiosqlite
from config import settings


class Database:
    def __init__(self, db_path: str = settings.DATABASE_PATH):
        self.db_path = db_path

    async def init(self):
        """Initializes database tables."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS warnings (
                    chat_id INTEGER NOT NULL,
                    user_id INTEGER NOT NULL,
                    warn_count INTEGER NOT NULL DEFAULT 0,
                    reasons TEXT DEFAULT '[]',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (chat_id, user_id)
                )
            """)
            await db.commit()

    async def add_warning(self, chat_id: int, user_id: int, reason: str) -> Tuple[int, List[str]]:
        """
        Adds a warning to a user in a specific chat.
        Returns (new_warn_count, reasons_list).
        """
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT warn_count, reasons FROM warnings WHERE chat_id = ? AND user_id = ?",
                (chat_id, user_id)
            ) as cursor:
                row = await cursor.fetchone()

            if row:
                count, reasons_json = row
                try:
                    reasons = json.loads(reasons_json)
                except Exception:
                    reasons = []
                
                count += 1
                reasons.append(f"{datetime.utcnow().strftime('%Y-%m-%d %H:%M')}: {reason}")

                await db.execute(
                    """
                    UPDATE warnings
                    SET warn_count = ?, reasons = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE chat_id = ? AND user_id = ?
                    """,
                    (count, json.dumps(reasons, ensure_ascii=False), chat_id, user_id)
                )
            else:
                count = 1
                reasons = [f"{datetime.utcnow().strftime('%Y-%m-%d %H:%M')}: {reason}"]
                await db.execute(
                    """
                    INSERT INTO warnings (chat_id, user_id, warn_count, reasons)
                    VALUES (?, ?, ?, ?)
                    """,
                    (chat_id, user_id, count, json.dumps(reasons, ensure_ascii=False))
                )

            await db.commit()
            return count, reasons

    async def get_warnings(self, chat_id: int, user_id: int) -> Tuple[int, List[str]]:
        """Returns the current warn count and list of reasons for a user."""
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT warn_count, reasons FROM warnings WHERE chat_id = ? AND user_id = ?",
                (chat_id, user_id)
            ) as cursor:
                row = await cursor.fetchone()
                if not row:
                    return 0, []
                count, reasons_json = row
                try:
                    reasons = json.loads(reasons_json)
                except Exception:
                    reasons = []
                return count, reasons

    async def remove_warning(self, chat_id: int, user_id: int) -> int:
        """Removes one warning from a user. Returns new count."""
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT warn_count, reasons FROM warnings WHERE chat_id = ? AND user_id = ?",
                (chat_id, user_id)
            ) as cursor:
                row = await cursor.fetchone()

            if not row or row[0] <= 0:
                return 0

            count, reasons_json = row
            try:
                reasons = json.loads(reasons_json)
            except Exception:
                reasons = []

            count -= 1
            if reasons:
                reasons.pop()

            if count <= 0:
                await db.execute("DELETE FROM warnings WHERE chat_id = ? AND user_id = ?", (chat_id, user_id))
                new_count = 0
            else:
                await db.execute(
                    "UPDATE warnings SET warn_count = ?, reasons = ?, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ? AND user_id = ?",
                    (count, json.dumps(reasons, ensure_ascii=False), chat_id, user_id)
                )
                new_count = count

            await db.commit()
            return new_count

    async def reset_warnings(self, chat_id: int, user_id: int):
        """Clears all warnings for a user in a chat."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM warnings WHERE chat_id = ? AND user_id = ?", (chat_id, user_id))
            await db.commit()


db = Database()

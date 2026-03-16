import os
import sqlite3
from pathlib import Path
from typing import Optional

import aiosqlite


class Database:
    _instance: Optional["Database"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._conn = None
        return cls._instance

    async def initialize(self, database_path: Optional[str] = None):
        if self._conn is not None:
            return
        db_path = database_path or os.getenv("DATABASE_PATH", "./data/process_mapper.db")
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        await self._conn.execute("PRAGMA foreign_keys = ON;")
        await self._conn.execute("PRAGMA journal_mode = WAL;")
        await self._conn.commit()

    def get_connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database not initialized")
        return self._conn

    async def close(self):
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def health_check(self) -> bool:
        if self._conn is None:
            return False
        try:
            async with self._conn.execute("SELECT 1") as cursor:
                await cursor.fetchone()
            return True
        except Exception:
            return False

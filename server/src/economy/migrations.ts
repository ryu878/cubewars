// Schema migrations for the economy SQLite DB (EPIC 23 — profiles only).

import type Database from "better-sqlite3";

interface Migration {
  id: string;
  sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: "20260824_001_profiles",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY NOT NULL,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname_key TEXT NOT NULL UNIQUE,
        nickname TEXT NOT NULL,
        gold INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const alreadyApplied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: string }>).map((row) => row.id),
  );

  const insertMigration = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (@id, @applied_at)",
  );

  const applyAll = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (alreadyApplied.has(migration.id)) continue;
      db.exec(migration.sql);
      insertMigration.run({ id: migration.id, applied_at: Date.now() });
      console.log(`[economy] migration applied: ${migration.id}`);
    }
  });

  applyAll();
}

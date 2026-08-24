// Schema migrations for the economy SQLite DB.
// EPIC 23: profiles. EPIC 24: eggs, pets, growth_stimulators.

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
  {
    id: "20260824_002_pets_eggs_stimulators",
    sql: `
      CREATE TABLE IF NOT EXISTS eggs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        hatch_deadline_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_eggs_profile ON eggs(profile_id);

      CREATE TABLE IF NOT EXISTS pets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('dog', 'cat', 'bird', 'lion')),
        base_value INTEGER NOT NULL CHECK (base_value >= 1 AND base_value <= 200),
        equip_slot INTEGER CHECK (equip_slot IS NULL OR equip_slot = 1),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pets_profile ON pets(profile_id);

      CREATE TABLE IF NOT EXISTS growth_stimulators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_stimulators_profile ON growth_stimulators(profile_id);
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

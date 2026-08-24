// Schema migrations for the economy SQLite DB.
// EPIC 23: profiles. EPIC 24: eggs, pets, growth_stimulators.
// EPIC 25: gems, amulets, shards, repair_kits; pets.equip_slot allows 2.
// EPIC 26: career_stats + endless_career_stats (durable leaderboards).

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
  {
    id: "20260824_003_gems_amulets_shards_repair",
    sql: `
      -- Allow pet equip_slot = 2 (amulet-gated). SQLite cannot ALTER CHECK;
      -- rebuild pets table while preserving rows.
      CREATE TABLE pets_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('dog', 'cat', 'bird', 'lion')),
        base_value INTEGER NOT NULL CHECK (base_value >= 1 AND base_value <= 200),
        equip_slot INTEGER CHECK (equip_slot IS NULL OR equip_slot IN (1, 2)),
        created_at INTEGER NOT NULL
      );
      INSERT INTO pets_new (id, profile_id, type, base_value, equip_slot, created_at)
        SELECT id, profile_id, type, base_value, equip_slot, created_at FROM pets;
      DROP TABLE pets;
      ALTER TABLE pets_new RENAME TO pets;
      CREATE INDEX IF NOT EXISTS idx_pets_profile ON pets(profile_id);

      CREATE TABLE IF NOT EXISTS gems (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('health', 'armor', 'speed', 'damage')),
        -- Create band is 5–100; death decay may floor down to 1 (EPIC 25 §2.4).
        value INTEGER NOT NULL CHECK (value >= 1 AND value <= 100),
        pet_id INTEGER REFERENCES pets(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_gems_profile ON gems(profile_id);
      CREATE INDEX IF NOT EXISTS idx_gems_pet ON gems(pet_id);
      -- One gem per type per pet when socketed.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gems_pet_type
        ON gems(pet_id, type) WHERE pet_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS amulets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        durability INTEGER NOT NULL CHECK (durability >= 0 AND durability <= 10),
        equipped INTEGER NOT NULL DEFAULT 0 CHECK (equipped IN (0, 1)),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_amulets_profile ON amulets(profile_id);
      -- At most one equipped amulet per profile.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_amulets_equipped
        ON amulets(profile_id) WHERE equipped = 1;

      CREATE TABLE IF NOT EXISTS shards (
        profile_id INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0 AND count <= 10)
      );

      CREATE TABLE IF NOT EXISTS repair_kits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_repair_kits_profile ON repair_kits(profile_id);
    `,
  },
  {
    id: "20260824_004_career_endless_stats",
    sql: `
      CREATE TABLE IF NOT EXISTS career_stats (
        profile_id INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        kills INTEGER NOT NULL DEFAULT 0 CHECK (kills >= 0),
        deaths INTEGER NOT NULL DEFAULT 0 CHECK (deaths >= 0),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS endless_career_stats (
        profile_id INTEGER PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        best_bot_kills INTEGER NOT NULL DEFAULT 0 CHECK (best_bot_kills >= 0),
        best_distance_km REAL NOT NULL DEFAULT 0 CHECK (best_distance_km >= 0),
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

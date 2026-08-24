// One-shot SQLite → Redis import for legacy local economy.sqlite (EPIC 27).
// Runtime path never opens SQLite except behind this import.

import fs from "node:fs";
import type { Redis } from "ioredis";
import type { GemType, PetType } from "@cubewars/shared";
import { resolveEconomyDbPath } from "./db.js";
import {
  createEmptyDocument,
  type EconomyDocument,
  type StoredAmulet,
  type StoredEgg,
  type StoredGem,
  type StoredPet,
  type StoredRepairKit,
  type StoredStimulator,
} from "./document.js";

export interface SqliteImportResult {
  imported: boolean;
  profiles: number;
  reason?: string;
}

interface ImportKeys {
  economyKey: (nicknameKey: string) => string;
  itemOwnerKey: (kind: "pet" | "egg" | "gem" | "amulet", id: number) => string;
  nickIndexKey: string;
  lbPvpKey: string;
  lbEndlessKey: string;
  profileIdCounterKey: string;
  sqliteImportedMarkerKey: string;
}

/**
 * Import legacy SQLite into Redis when flagged / marker missing.
 * Opens SQLite read-only; does not keep the handle after return.
 */
export async function maybeImportSqliteToRedis(
  redis: Redis,
  keys: ImportKeys,
): Promise<SqliteImportResult> {
  const force = process.env.CUBEWARS_SQLITE_IMPORT === "1";
  const marker = await redis.get(keys.sqliteImportedMarkerKey);
  if (marker && !force) {
    return { imported: false, profiles: 0, reason: "marker_present" };
  }

  const dbPath = resolveEconomyDbPath();
  if (!fs.existsSync(dbPath)) {
    if (force) {
      console.warn(`[economy] CUBEWARS_SQLITE_IMPORT=1 but SQLite file missing: ${dbPath}`);
    }
    return { imported: false, profiles: 0, reason: "sqlite_missing" };
  }

  // Dynamic require so runtime stays free of SQLite unless importing.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const profiles = db
      .prepare(
        `SELECT id, nickname_key, nickname, gold, created_at, updated_at FROM profiles ORDER BY id ASC`,
      )
      .all() as Array<{
      id: number;
      nickname_key: string;
      nickname: string;
      gold: number;
      created_at: number;
      updated_at: number;
    }>;

    if (profiles.length === 0) {
      await redis.set(keys.sqliteImportedMarkerKey, String(Date.now()));
      return { imported: true, profiles: 0, reason: "empty_sqlite" };
    }

    let maxProfileId = 0;
    const pipeline = redis.pipeline();

    for (const row of profiles) {
      maxProfileId = Math.max(maxProfileId, row.id);
      const doc = createEmptyDocument(row.id, row.nickname_key, row.nickname, row.created_at);
      doc.gold = row.gold;
      doc.updatedAt = row.updated_at;

      const eggs = db
        .prepare(
          `SELECT id, hatch_deadline_ms, created_at FROM eggs WHERE profile_id = ? ORDER BY id ASC`,
        )
        .all(row.id) as Array<{ id: number; hatch_deadline_ms: number; created_at: number }>;
      doc.eggs = eggs.map(
        (e): StoredEgg => ({
          id: e.id,
          hatchDeadlineMs: e.hatch_deadline_ms,
          createdAt: e.created_at,
        }),
      );
      doc.nextEggId = eggs.reduce((m, e) => Math.max(m, e.id), 0) + 1;

      const pets = db
        .prepare(
          `SELECT id, type, base_value, equip_slot, created_at FROM pets WHERE profile_id = ? ORDER BY id ASC`,
        )
        .all(row.id) as Array<{
        id: number;
        type: string;
        base_value: number;
        equip_slot: number | null;
        created_at: number;
      }>;
      doc.pets = pets.map((p): StoredPet => {
        let equipSlot: 1 | 2 | null = null;
        if (p.equip_slot === 1) equipSlot = 1;
        else if (p.equip_slot === 2) equipSlot = 2;
        return {
          id: p.id,
          type: p.type as PetType,
          baseValue: p.base_value,
          equipSlot,
          createdAt: p.created_at,
        };
      });
      doc.nextPetId = pets.reduce((m, p) => Math.max(m, p.id), 0) + 1;

      const stims = db
        .prepare(`SELECT id, created_at FROM growth_stimulators WHERE profile_id = ? ORDER BY id ASC`)
        .all(row.id) as Array<{ id: number; created_at: number }>;
      doc.stimulators = stims.map(
        (s): StoredStimulator => ({ id: s.id, createdAt: s.created_at }),
      );
      doc.nextStimId = stims.reduce((m, s) => Math.max(m, s.id), 0) + 1;

      const gems = db
        .prepare(
          `SELECT id, type, value, pet_id, created_at FROM gems WHERE profile_id = ? ORDER BY id ASC`,
        )
        .all(row.id) as Array<{
        id: number;
        type: string;
        value: number;
        pet_id: number | null;
        created_at: number;
      }>;
      doc.gems = gems.map(
        (g): StoredGem => ({
          id: g.id,
          gemType: g.type as GemType,
          value: g.value,
          petId: g.pet_id,
          createdAt: g.created_at,
        }),
      );
      doc.nextGemId = gems.reduce((m, g) => Math.max(m, g.id), 0) + 1;

      const amulets = db
        .prepare(
          `SELECT id, durability, equipped, created_at FROM amulets WHERE profile_id = ? ORDER BY id ASC`,
        )
        .all(row.id) as Array<{
        id: number;
        durability: number;
        equipped: number;
        created_at: number;
      }>;
      doc.amulets = amulets.map(
        (a): StoredAmulet => ({
          id: a.id,
          durability: a.durability,
          equipped: a.equipped === 1,
          createdAt: a.created_at,
        }),
      );
      doc.nextAmuletId = amulets.reduce((m, a) => Math.max(m, a.id), 0) + 1;

      const kits = db
        .prepare(`SELECT id, created_at FROM repair_kits WHERE profile_id = ? ORDER BY id ASC`)
        .all(row.id) as Array<{ id: number; created_at: number }>;
      doc.repairKits = kits.map(
        (k): StoredRepairKit => ({ id: k.id, createdAt: k.created_at }),
      );
      doc.nextRepairKitId = kits.reduce((m, k) => Math.max(m, k.id), 0) + 1;

      const shards = db
        .prepare(`SELECT count FROM shards WHERE profile_id = ?`)
        .get(row.id) as { count: number } | undefined;
      doc.shardCount = shards?.count ?? 0;

      const career = db
        .prepare(`SELECT kills, deaths, updated_at FROM career_stats WHERE profile_id = ?`)
        .get(row.id) as { kills: number; deaths: number; updated_at: number } | undefined;
      if (career) {
        doc.career = {
          kills: career.kills,
          deaths: career.deaths,
          updatedAt: career.updated_at,
        };
      }

      const endless = db
        .prepare(
          `SELECT best_bot_kills, best_distance_km, updated_at FROM endless_career_stats WHERE profile_id = ?`,
        )
        .get(row.id) as
        | { best_bot_kills: number; best_distance_km: number; updated_at: number }
        | undefined;
      if (endless) {
        doc.endless = {
          botKills: endless.best_bot_kills,
          distanceKm: endless.best_distance_km,
          updatedAt: endless.updated_at,
        };
      }

      pipeline.set(keys.economyKey(row.nickname_key), JSON.stringify(doc));
      pipeline.sadd(keys.nickIndexKey, row.nickname_key);
      for (const egg of doc.eggs) {
        pipeline.set(keys.itemOwnerKey("egg", egg.id), row.nickname_key);
      }
      for (const pet of doc.pets) {
        pipeline.set(keys.itemOwnerKey("pet", pet.id), row.nickname_key);
      }
      for (const gem of doc.gems) {
        pipeline.set(keys.itemOwnerKey("gem", gem.id), row.nickname_key);
      }
      for (const amulet of doc.amulets) {
        pipeline.set(keys.itemOwnerKey("amulet", amulet.id), row.nickname_key);
      }
      if (doc.career.kills > 0 || doc.career.deaths > 0) {
        pipeline.zadd(keys.lbPvpKey, doc.career.kills, row.nickname_key);
      }
      if (doc.endless.botKills > 0 || doc.endless.distanceKm > 0) {
        pipeline.zadd(keys.lbEndlessKey, doc.endless.botKills, row.nickname_key);
      }
    }

    if (maxProfileId > 0) {
      pipeline.set(keys.profileIdCounterKey, String(maxProfileId));
    }
    pipeline.set(keys.sqliteImportedMarkerKey, String(Date.now()));
    await pipeline.exec();

    console.log(
      `[economy] sqlite import complete: profiles=${profiles.length} from ${dbPath}`,
    );
    return { imported: true, profiles: profiles.length };
  } finally {
    db.close();
  }
}

/** Re-export document type for callers that type-check import helpers. */
export type { EconomyDocument };

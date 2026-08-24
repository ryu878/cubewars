// Durable player economy profiles keyed by nickname (EPIC 23 + EPIC 24).
// Gold / pets / eggs / stimulators are transactional. Single-process
// assumption: better-sqlite3 sync API; do not run multiple server processes
// against the same SQLite file.

import path from "node:path";
import type Database from "better-sqlite3";
import {
  ECONOMY_CAPS,
  INCUBATION,
  PET_TYPES,
  STIMULATOR_SOFT_CAP,
  aggregateEquippedRatings,
  applyStimulatorDeadline,
  emptyRatings,
  isEggReady,
  shouldGrantEggDrop,
  shouldGrantStimulatorDrop,
  type PetType,
  type ProfileRatings,
  normalizeNickname,
} from "@cubewars/shared";
import { openEconomyDatabase, resolveEconomyDbPath } from "./db.js";
import { runMigrations } from "./migrations.js";

export interface EconomyProfile {
  id: number;
  nicknameKey: string;
  nickname: string;
  gold: number;
  createdAt: number;
  updatedAt: number;
}

export interface EconomyEgg {
  id: number;
  profileId: number;
  hatchDeadlineMs: number;
  createdAt: number;
}

export interface EconomyPet {
  id: number;
  profileId: number;
  type: PetType;
  baseValue: number;
  equipSlot: 1 | null;
  createdAt: number;
}

export interface FullEconomyProfile {
  id: number;
  nicknameKey: string;
  nickname: string;
  gold: number;
  pets: EconomyPet[];
  eggs: EconomyEgg[];
  stimulatorCount: number;
  ratings: ProfileRatings;
  slot2Enabled: false;
}

export type EconomyActionErrorCode =
  | "not_found"
  | "cross_profile"
  | "slot2_disabled"
  | "invalid_slot"
  | "pet_cap"
  | "egg_cap"
  | "stimulator_cap"
  | "not_ready"
  | "no_stimulator"
  | "already_ready";

export class EconomyActionError extends Error {
  readonly code: EconomyActionErrorCode;

  constructor(code: EconomyActionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "EconomyActionError";
  }
}

interface ProfileRow {
  id: number;
  nickname_key: string;
  nickname: string;
  gold: number;
  created_at: number;
  updated_at: number;
}

interface EggRow {
  id: number;
  profile_id: number;
  hatch_deadline_ms: number;
  created_at: number;
}

interface PetRow {
  id: number;
  profile_id: number;
  type: string;
  base_value: number;
  equip_slot: number | null;
  created_at: number;
}

function rowToProfile(row: ProfileRow): EconomyProfile {
  return {
    id: row.id,
    nicknameKey: row.nickname_key,
    nickname: row.nickname,
    gold: row.gold,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEgg(row: EggRow): EconomyEgg {
  return {
    id: row.id,
    profileId: row.profile_id,
    hatchDeadlineMs: row.hatch_deadline_ms,
    createdAt: row.created_at,
  };
}

function rowToPet(row: PetRow): EconomyPet {
  const type = row.type as PetType;
  return {
    id: row.id,
    profileId: row.profile_id,
    type,
    baseValue: row.base_value,
    equipSlot: row.equip_slot === 1 ? 1 : null,
    createdAt: row.created_at,
  };
}

/** Resolve incubation duration; env override for QA/tests only (positive int ms). */
export function resolveIncubationDurationMs(
  envValue: string | undefined = process.env.CUBEWARS_INCUBATION_MS,
): number {
  if (envValue && envValue.trim().length > 0) {
    const parsed = Number(envValue.trim());
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return INCUBATION.durationMs;
}

function randomPetType(): PetType {
  return PET_TYPES[Math.floor(Math.random() * PET_TYPES.length)]!;
}

function randomBaseValue(): number {
  return 1 + Math.floor(Math.random() * 200);
}

export class EconomyStore {
  readonly dbPath: string;

  constructor(
    private db: Database.Database,
    dbPath: string,
  ) {
    this.dbPath = dbPath;
  }

  static open(dbPath: string = resolveEconomyDbPath()): EconomyStore {
    const resolved = path.resolve(dbPath);
    const db = openEconomyDatabase(resolved);
    runMigrations(db);
    console.log(`[economy] database ready: ${resolved}`);
    return new EconomyStore(db, resolved);
  }

  /** Close the underlying SQLite handle (tests / shutdown). */
  close(): void {
    this.db.close();
  }

  getOrCreateProfile(nickname: string): EconomyProfile {
    const normalized = normalizeNickname(nickname);
    if (!normalized.ok) {
      throw new Error(`cannot create economy profile for invalid nickname: ${normalized.reason}`);
    }
    const existing = this.getProfile(normalized.key);
    if (existing) {
      if (existing.nickname !== normalized.nickname) {
        const now = Date.now();
        this.db
          .prepare(
            "UPDATE profiles SET nickname = @nickname, updated_at = @updated_at WHERE nickname_key = @nickname_key",
          )
          .run({
            nickname: normalized.nickname,
            updated_at: now,
            nickname_key: normalized.key,
          });
        return { ...existing, nickname: normalized.nickname, updatedAt: now };
      }
      return existing;
    }

    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO profiles (nickname_key, nickname, gold, created_at, updated_at)
         VALUES (@nickname_key, @nickname, 0, @created_at, @updated_at)`,
      )
      .run({
        nickname_key: normalized.key,
        nickname: normalized.nickname,
        created_at: now,
        updated_at: now,
      });

    return {
      id: Number(result.lastInsertRowid),
      nicknameKey: normalized.key,
      nickname: normalized.nickname,
      gold: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  getProfile(nicknameKey: string): EconomyProfile | null {
    const row = this.db
      .prepare(
        `SELECT id, nickname_key, nickname, gold, created_at, updated_at
         FROM profiles WHERE nickname_key = ?`,
      )
      .get(nicknameKey) as ProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  getGold(nicknameKey: string): number {
    return this.getProfile(nicknameKey)?.gold ?? 0;
  }

  /**
   * Add gold to a profile (creating it if needed). Rejects non-finite or
   * negative amounts. Returns the updated profile. Gold never goes below 0
   * (CHECK constraint + application reject of negative deltas).
   */
  addGold(nicknameKeyOrNickname: string, amount: number): EconomyProfile {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`addGold amount must be a non-negative finite number, got ${amount}`);
    }
    const amountInt = Math.floor(amount);

    const normalized = normalizeNickname(nicknameKeyOrNickname);
    const key = normalized.ok ? normalized.key : nicknameKeyOrNickname.toLocaleLowerCase();
    const display = normalized.ok ? normalized.nickname : nicknameKeyOrNickname;

    const run = this.db.transaction(() => {
      if (normalized.ok) {
        this.getOrCreateProfile(display);
      } else if (!this.getProfile(key)) {
        throw new Error(`addGold requires an existing profile when nickname is invalid: ${key}`);
      }
      const now = Date.now();
      this.db
        .prepare(
          `UPDATE profiles
           SET gold = gold + @amount, updated_at = @updated_at
           WHERE nickname_key = @nickname_key`,
        )
        .run({ amount: amountInt, updated_at: now, nickname_key: key });
      const profile = this.getProfile(key);
      if (!profile) {
        throw new Error(`profile missing after addGold for key=${key}`);
      }
      return profile;
    });

    return run();
  }

  listEggs(profileId: number): EconomyEgg[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, hatch_deadline_ms, created_at
         FROM eggs WHERE profile_id = ? ORDER BY id ASC`,
      )
      .all(profileId) as EggRow[];
    return rows.map(rowToEgg);
  }

  listPets(profileId: number): EconomyPet[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, type, base_value, equip_slot, created_at
         FROM pets WHERE profile_id = ? ORDER BY id ASC`,
      )
      .all(profileId) as PetRow[];
    return rows.map(rowToPet);
  }

  countEggs(profileId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM eggs WHERE profile_id = ?").get(profileId) as {
      c: number;
    };
    return row.c;
  }

  countPets(profileId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM pets WHERE profile_id = ?").get(profileId) as {
      c: number;
    };
    return row.c;
  }

  countStimulators(profileId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM growth_stimulators WHERE profile_id = ?")
      .get(profileId) as { c: number };
    return row.c;
  }

  getFullProfile(nickname: string): FullEconomyProfile {
    const base = this.getOrCreateProfile(nickname);
    const pets = this.listPets(base.id);
    const eggs = this.listEggs(base.id);
    const stimulatorCount = this.countStimulators(base.id);
    const ratings = aggregateEquippedRatings(
      pets.map((p) => ({ type: p.type, baseValue: p.baseValue, equipSlot: p.equipSlot })),
      false,
    );
    return {
      id: base.id,
      nicknameKey: base.nicknameKey,
      nickname: base.nickname,
      gold: base.gold,
      pets,
      eggs,
      stimulatorCount,
      ratings,
      slot2Enabled: false,
    };
  }

  /**
   * Grant an egg with hatch deadline = now + incubation duration.
   * Duration from `CUBEWARS_INCUBATION_MS` (positive int) or INCUBATION.durationMs.
   */
  grantEgg(
    nickname: string,
    nowMs: number = Date.now(),
    durationMs: number = resolveIncubationDurationMs(),
  ): EconomyEgg {
    const profile = this.getOrCreateProfile(nickname);
    if (this.countEggs(profile.id) >= ECONOMY_CAPS.eggs) {
      throw new EconomyActionError("egg_cap", "egg cap reached");
    }
    if (this.countPets(profile.id) >= ECONOMY_CAPS.pets) {
      throw new EconomyActionError("pet_cap", "pet cap reached (cannot grant egg)");
    }
    const hatchDeadlineMs = nowMs + durationMs;
    const result = this.db
      .prepare(
        `INSERT INTO eggs (profile_id, hatch_deadline_ms, created_at)
         VALUES (@profile_id, @hatch_deadline_ms, @created_at)`,
      )
      .run({
        profile_id: profile.id,
        hatch_deadline_ms: hatchDeadlineMs,
        created_at: nowMs,
      });
    this.touchProfile(profile.id, nowMs);
    return {
      id: Number(result.lastInsertRowid),
      profileId: profile.id,
      hatchDeadlineMs,
      createdAt: nowMs,
    };
  }

  /** Grant one stimulator row; rejects when soft-cap reached. */
  grantStimulator(nickname: string, nowMs: number = Date.now()): { id: number } {
    const profile = this.getOrCreateProfile(nickname);
    if (this.countStimulators(profile.id) >= STIMULATOR_SOFT_CAP) {
      throw new EconomyActionError("stimulator_cap", "stimulator soft-cap reached");
    }
    const result = this.db
      .prepare(
        `INSERT INTO growth_stimulators (profile_id, created_at)
         VALUES (@profile_id, @created_at)`,
      )
      .run({ profile_id: profile.id, created_at: nowMs });
    this.touchProfile(profile.id, nowMs);
    return { id: Number(result.lastInsertRowid) };
  }

  /**
   * Human-only kill item drops (egg + stimulator). Gold is handled separately.
   * Rolls are independent. Caps skip the drop silently (gold still granted upstream).
   */
  tryKillItemDrops(
    nickname: string,
    victimIsHuman: boolean,
    rolls: { egg: number; stimulator: number } = { egg: Math.random(), stimulator: Math.random() },
    nowMs: number = Date.now(),
  ): { egg: EconomyEgg | null; stimulator: boolean } {
    if (!victimIsHuman) {
      return { egg: null, stimulator: false };
    }
    const profile = this.getOrCreateProfile(nickname);
    let egg: EconomyEgg | null = null;
    let stimulator = false;

    const eggCount = this.countEggs(profile.id);
    const petCount = this.countPets(profile.id);
    if (shouldGrantEggDrop(eggCount, petCount, rolls.egg)) {
      try {
        egg = this.grantEgg(nickname, nowMs);
      } catch (err) {
        if (!(err instanceof EconomyActionError)) throw err;
        // Cap race — skip silently.
      }
    }

    const stimCount = this.countStimulators(profile.id);
    if (shouldGrantStimulatorDrop(stimCount, rolls.stimulator)) {
      try {
        this.grantStimulator(nickname, nowMs);
        stimulator = true;
      } catch (err) {
        if (!(err instanceof EconomyActionError)) throw err;
      }
    }

    return { egg, stimulator };
  }

  applyStimulator(nickname: string, eggId: number, nowMs: number = Date.now()): EconomyEgg {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const eggRow = this.db
        .prepare(
          `SELECT id, profile_id, hatch_deadline_ms, created_at FROM eggs WHERE id = ?`,
        )
        .get(eggId) as EggRow | undefined;
      if (!eggRow) {
        throw new EconomyActionError("not_found", `egg ${eggId} not found`);
      }
      if (eggRow.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "egg belongs to another profile");
      }
      if (isEggReady(eggRow.hatch_deadline_ms, nowMs)) {
        throw new EconomyActionError("already_ready", "egg is already ready to hatch");
      }
      const stim = this.db
        .prepare(
          `SELECT id FROM growth_stimulators WHERE profile_id = ? ORDER BY id ASC LIMIT 1`,
        )
        .get(profile.id) as { id: number } | undefined;
      if (!stim) {
        throw new EconomyActionError("no_stimulator", "no growth stimulator available");
      }
      const newDeadline = applyStimulatorDeadline(eggRow.hatch_deadline_ms, nowMs);
      this.db.prepare("DELETE FROM growth_stimulators WHERE id = ?").run(stim.id);
      this.db
        .prepare("UPDATE eggs SET hatch_deadline_ms = @deadline WHERE id = @id")
        .run({ deadline: newDeadline, id: eggId });
      this.touchProfile(profile.id, nowMs);
      return {
        id: eggRow.id,
        profileId: eggRow.profile_id,
        hatchDeadlineMs: newDeadline,
        createdAt: eggRow.created_at,
      };
    });
    return run();
  }

  hatchEgg(
    nickname: string,
    eggId: number,
    nowMs: number = Date.now(),
    opts?: { type?: PetType; baseValue?: number },
  ): EconomyPet {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const eggRow = this.db
        .prepare(
          `SELECT id, profile_id, hatch_deadline_ms, created_at FROM eggs WHERE id = ?`,
        )
        .get(eggId) as EggRow | undefined;
      if (!eggRow) {
        throw new EconomyActionError("not_found", `egg ${eggId} not found`);
      }
      if (eggRow.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "egg belongs to another profile");
      }
      if (!isEggReady(eggRow.hatch_deadline_ms, nowMs)) {
        throw new EconomyActionError("not_ready", "egg is still incubating");
      }
      if (this.countPets(profile.id) >= ECONOMY_CAPS.pets) {
        throw new EconomyActionError("pet_cap", "pet cap reached");
      }
      const type = opts?.type ?? randomPetType();
      const baseValue = opts?.baseValue ?? randomBaseValue();
      if (!PET_TYPES.includes(type) || baseValue < 1 || baseValue > 200) {
        throw new Error(`invalid hatch pet type/value: ${type}/${baseValue}`);
      }
      this.db.prepare("DELETE FROM eggs WHERE id = ?").run(eggId);
      const result = this.db
        .prepare(
          `INSERT INTO pets (profile_id, type, base_value, equip_slot, created_at)
           VALUES (@profile_id, @type, @base_value, NULL, @created_at)`,
        )
        .run({
          profile_id: profile.id,
          type,
          base_value: baseValue,
          created_at: nowMs,
        });
      this.touchProfile(profile.id, nowMs);
      return {
        id: Number(result.lastInsertRowid),
        profileId: profile.id,
        type,
        baseValue,
        equipSlot: null as 1 | null,
        createdAt: nowMs,
      };
    });
    return run();
  }

  equipPet(nickname: string, petId: number, slot: number, nowMs: number = Date.now()): EconomyPet {
    if (slot === 2) {
      throw new EconomyActionError("slot2_disabled", "pet slot 2 is not available");
    }
    if (slot !== 1) {
      throw new EconomyActionError("invalid_slot", `invalid equip slot ${slot}`);
    }
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const petRow = this.db
        .prepare(
          `SELECT id, profile_id, type, base_value, equip_slot, created_at FROM pets WHERE id = ?`,
        )
        .get(petId) as PetRow | undefined;
      if (!petRow) {
        throw new EconomyActionError("not_found", `pet ${petId} not found`);
      }
      if (petRow.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "pet belongs to another profile");
      }
      // Unequip any other pet currently in slot 1.
      this.db
        .prepare("UPDATE pets SET equip_slot = NULL WHERE profile_id = ? AND equip_slot = 1")
        .run(profile.id);
      this.db.prepare("UPDATE pets SET equip_slot = 1 WHERE id = ?").run(petId);
      this.touchProfile(profile.id, nowMs);
      return rowToPet({ ...petRow, equip_slot: 1 });
    });
    return run();
  }

  unequipPet(nickname: string, petId: number, nowMs: number = Date.now()): EconomyPet {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const petRow = this.db
        .prepare(
          `SELECT id, profile_id, type, base_value, equip_slot, created_at FROM pets WHERE id = ?`,
        )
        .get(petId) as PetRow | undefined;
      if (!petRow) {
        throw new EconomyActionError("not_found", `pet ${petId} not found`);
      }
      if (petRow.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "pet belongs to another profile");
      }
      this.db.prepare("UPDATE pets SET equip_slot = NULL WHERE id = ?").run(petId);
      this.touchProfile(profile.id, nowMs);
      return rowToPet({ ...petRow, equip_slot: null });
    });
    return run();
  }

  /** Ratings for an already-known nickname key (no create). */
  getRatingsForKey(nicknameKey: string): ProfileRatings {
    const profile = this.getProfile(nicknameKey);
    if (!profile) return emptyRatings();
    const pets = this.listPets(profile.id);
    return aggregateEquippedRatings(
      pets.map((p) => ({ type: p.type, baseValue: p.baseValue, equipSlot: p.equipSlot })),
      false,
    );
  }

  private touchProfile(profileId: number, nowMs: number): void {
    this.db.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").run(nowMs, profileId);
  }
}

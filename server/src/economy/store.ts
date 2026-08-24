// Durable player economy profiles keyed by nickname (EPIC 23–25).
// Gold / pets / eggs / stimulators / gems / amulets / shards / repair kits
// are transactional. Single-process assumption: better-sqlite3 sync API;
// do not run multiple server processes against the same SQLite file.

import path from "node:path";
import type Database from "better-sqlite3";
import {
  ECONOMY_CAPS,
  GEM_TYPES,
  GEM_VALUE_MAX,
  GEM_VALUE_MIN,
  INCUBATION,
  PET_TYPES,
  REPAIR_KIT_SOFT_CAP,
  STIMULATOR_SOFT_CAP,
  aggregateEquippedRatings,
  applyDeathEffectivenessDecay,
  applyStimulatorDeadline,
  emptyRatings,
  isEggReady,
  shouldGrantAmuletDrop,
  shouldGrantEggDrop,
  shouldGrantGemDrop,
  shouldGrantRepairKitDrop,
  shouldGrantShard,
  shouldGrantStimulatorDrop,
  type GemType,
  type PetGemBonuses,
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
  equipSlot: 1 | 2 | null;
  createdAt: number;
}

export interface EconomyGem {
  id: number;
  profileId: number;
  gemType: GemType;
  value: number;
  petId: number | null;
  createdAt: number;
}

export interface EconomyAmulet {
  id: number;
  profileId: number;
  durability: number;
  equipped: boolean;
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
  gems: EconomyGem[];
  amulets: EconomyAmulet[];
  shardCount: number;
  repairKitCount: number;
  ratings: ProfileRatings;
  slot2Enabled: boolean;
}

export type EconomyActionErrorCode =
  | "not_found"
  | "cross_profile"
  | "slot2_disabled"
  | "invalid_slot"
  | "pet_cap"
  | "egg_cap"
  | "stimulator_cap"
  | "gem_cap"
  | "amulet_cap"
  | "shard_cap"
  | "insufficient_shards"
  | "type_occupied"
  | "already_socketed"
  | "not_socketed"
  | "no_repair_kit"
  | "repair_kit_cap"
  | "not_ready"
  | "no_stimulator"
  | "already_ready"
  | "already_equipped"
  | "not_equipped";

export class EconomyActionError extends Error {
  readonly code: EconomyActionErrorCode;

  constructor(code: EconomyActionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "EconomyActionError";
  }
}

export interface KillItemDropsResult {
  egg: EconomyEgg | null;
  stimulator: boolean;
  gem: EconomyGem | null;
  shard: boolean;
  amulet: EconomyAmulet | null;
  repairKit: boolean;
}

export interface KillDropRolls {
  egg: number;
  stimulator: number;
  gem: number;
  amulet: number;
  repairKit: number;
}

export interface VictimDropContext {
  /** Victim nickname (same profile keying as killer). */
  nickname: string;
  /** Match-level: true if this killer already received a shard from this victim. */
  alreadyGrantedShard: boolean;
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

interface GemRow {
  id: number;
  profile_id: number;
  type: string;
  value: number;
  pet_id: number | null;
  created_at: number;
}

interface AmuletRow {
  id: number;
  profile_id: number;
  durability: number;
  equipped: number;
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
  let equipSlot: 1 | 2 | null = null;
  if (row.equip_slot === 1) equipSlot = 1;
  else if (row.equip_slot === 2) equipSlot = 2;
  return {
    id: row.id,
    profileId: row.profile_id,
    type,
    baseValue: row.base_value,
    equipSlot,
    createdAt: row.created_at,
  };
}

function rowToGem(row: GemRow): EconomyGem {
  return {
    id: row.id,
    profileId: row.profile_id,
    gemType: row.type as GemType,
    value: row.value,
    petId: row.pet_id,
    createdAt: row.created_at,
  };
}

function rowToAmulet(row: AmuletRow): EconomyAmulet {
  return {
    id: row.id,
    profileId: row.profile_id,
    durability: row.durability,
    equipped: row.equipped === 1,
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

function defaultKillRolls(): KillDropRolls {
  return {
    egg: Math.random(),
    stimulator: Math.random(),
    gem: Math.random(),
    amulet: Math.random(),
    repairKit: Math.random(),
  };
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

  listGems(profileId: number): EconomyGem[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, type, value, pet_id, created_at
         FROM gems WHERE profile_id = ? ORDER BY id ASC`,
      )
      .all(profileId) as GemRow[];
    return rows.map(rowToGem);
  }

  listAmulets(profileId: number): EconomyAmulet[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, durability, equipped, created_at
         FROM amulets WHERE profile_id = ? ORDER BY id ASC`,
      )
      .all(profileId) as AmuletRow[];
    return rows.map(rowToAmulet);
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

  countGems(profileId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM gems WHERE profile_id = ?").get(profileId) as {
      c: number;
    };
    return row.c;
  }

  countAmulets(profileId: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM amulets WHERE profile_id = ?").get(profileId) as {
      c: number;
    };
    return row.c;
  }

  countRepairKits(profileId: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM repair_kits WHERE profile_id = ?")
      .get(profileId) as { c: number };
    return row.c;
  }

  getShardCount(profileId: number): number {
    const row = this.db.prepare("SELECT count FROM shards WHERE profile_id = ?").get(profileId) as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  }

  hasAnyAmulet(profileId: number): boolean {
    return this.countAmulets(profileId) > 0;
  }

  isSlot2Enabled(profileId: number): boolean {
    const row = this.db
      .prepare("SELECT id FROM amulets WHERE profile_id = ? AND equipped = 1 LIMIT 1")
      .get(profileId) as { id: number } | undefined;
    return Boolean(row);
  }

  /** Gems socketed on pets that are currently equipped (slot 1 or 2). */
  listGemsOnEquippedPets(profileId: number): EconomyGem[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.profile_id, g.type, g.value, g.pet_id, g.created_at
         FROM gems g
         INNER JOIN pets p ON p.id = g.pet_id
         WHERE g.profile_id = ? AND p.profile_id = ? AND p.equip_slot IN (1, 2)
         ORDER BY g.id ASC`,
      )
      .all(profileId, profileId) as GemRow[];
    return rows.map(rowToGem);
  }

  private gemBonusesByPet(profileId: number): Map<number, PetGemBonuses> {
    const map = new Map<number, PetGemBonuses>();
    for (const gem of this.listGems(profileId)) {
      if (gem.petId === null) continue;
      const existing = map.get(gem.petId) ?? {};
      existing[gem.gemType] = gem.value;
      map.set(gem.petId, existing);
    }
    return map;
  }

  private computeRatings(profileId: number): ProfileRatings {
    const pets = this.listPets(profileId);
    const gemMap = this.gemBonusesByPet(profileId);
    const slot2Enabled = this.isSlot2Enabled(profileId);
    return aggregateEquippedRatings(
      pets.map((p) => ({
        type: p.type,
        baseValue: p.baseValue,
        equipSlot: p.equipSlot,
        gems: gemMap.get(p.id),
      })),
      slot2Enabled,
    );
  }

  getFullProfile(nickname: string): FullEconomyProfile {
    const base = this.getOrCreateProfile(nickname);
    const pets = this.listPets(base.id);
    const eggs = this.listEggs(base.id);
    const gems = this.listGems(base.id);
    const amulets = this.listAmulets(base.id);
    const stimulatorCount = this.countStimulators(base.id);
    const shardCount = this.getShardCount(base.id);
    const repairKitCount = this.countRepairKits(base.id);
    const slot2Enabled = this.isSlot2Enabled(base.id);
    const ratings = this.computeRatings(base.id);
    return {
      id: base.id,
      nicknameKey: base.nicknameKey,
      nickname: base.nickname,
      gold: base.gold,
      pets,
      eggs,
      stimulatorCount,
      gems,
      amulets,
      shardCount,
      repairKitCount,
      ratings,
      slot2Enabled,
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
   * Grant a gem into the bag.
   * - Default (mint): value must be in [GEM_VALUE_MIN, GEM_VALUE_MAX] (5–100).
   * - `allowExistingValue` (loot copy): allows decayed values down to 1 (schema min)
   *   so kill loot never rejects post-death gems (Critic F-001).
   */
  grantGem(
    nickname: string,
    gemType: GemType,
    value: number,
    nowMs: number = Date.now(),
    opts?: { allowExistingValue?: boolean },
  ): EconomyGem {
    const minValue = opts?.allowExistingValue ? 1 : GEM_VALUE_MIN;
    if (
      !GEM_TYPES.includes(gemType) ||
      !Number.isInteger(value) ||
      value < minValue ||
      value > GEM_VALUE_MAX
    ) {
      throw new Error(`invalid gem type/value: ${gemType}/${value}`);
    }
    const profile = this.getOrCreateProfile(nickname);
    if (this.countGems(profile.id) >= ECONOMY_CAPS.gems) {
      throw new EconomyActionError("gem_cap", "gem cap reached");
    }
    const result = this.db
      .prepare(
        `INSERT INTO gems (profile_id, type, value, pet_id, created_at)
         VALUES (@profile_id, @type, @value, NULL, @created_at)`,
      )
      .run({
        profile_id: profile.id,
        type: gemType,
        value,
        created_at: nowMs,
      });
    this.touchProfile(profile.id, nowMs);
    return {
      id: Number(result.lastInsertRowid),
      profileId: profile.id,
      gemType,
      value,
      petId: null,
      createdAt: nowMs,
    };
  }

  grantAmulet(
    nickname: string,
    durability: number = ECONOMY_CAPS.amuletDurabilityMax,
    nowMs: number = Date.now(),
  ): EconomyAmulet {
    const dur = Math.max(0, Math.min(ECONOMY_CAPS.amuletDurabilityMax, Math.floor(durability)));
    if (dur <= 0) {
      throw new Error("cannot grant amulet with durability <= 0");
    }
    const profile = this.getOrCreateProfile(nickname);
    if (this.countAmulets(profile.id) >= ECONOMY_CAPS.amulets) {
      throw new EconomyActionError("amulet_cap", "amulet cap reached");
    }
    const result = this.db
      .prepare(
        `INSERT INTO amulets (profile_id, durability, equipped, created_at)
         VALUES (@profile_id, @durability, 0, @created_at)`,
      )
      .run({
        profile_id: profile.id,
        durability: dur,
        created_at: nowMs,
      });
    this.touchProfile(profile.id, nowMs);
    return {
      id: Number(result.lastInsertRowid),
      profileId: profile.id,
      durability: dur,
      equipped: false,
      createdAt: nowMs,
    };
  }

  grantRepairKit(nickname: string, nowMs: number = Date.now()): { id: number } {
    const profile = this.getOrCreateProfile(nickname);
    if (this.countRepairKits(profile.id) >= REPAIR_KIT_SOFT_CAP) {
      throw new EconomyActionError("repair_kit_cap", "repair kit soft-cap reached");
    }
    const result = this.db
      .prepare(
        `INSERT INTO repair_kits (profile_id, created_at)
         VALUES (@profile_id, @created_at)`,
      )
      .run({ profile_id: profile.id, created_at: nowMs });
    this.touchProfile(profile.id, nowMs);
    return { id: Number(result.lastInsertRowid) };
  }

  addShard(nickname: string, amount: number = 1, nowMs: number = Date.now()): number {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`addShard amount must be a positive integer, got ${amount}`);
    }
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const current = this.getShardCount(profile.id);
      if (current >= ECONOMY_CAPS.shards) {
        throw new EconomyActionError("shard_cap", "shard cap reached");
      }
      const next = Math.min(ECONOMY_CAPS.shards, current + amount);
      this.db
        .prepare(
          `INSERT INTO shards (profile_id, count) VALUES (@profile_id, @count)
           ON CONFLICT(profile_id) DO UPDATE SET count = @count`,
        )
        .run({ profile_id: profile.id, count: next });
      this.touchProfile(profile.id, nowMs);
      return next;
    });
    return run();
  }

  /**
   * Human-only kill item drops (egg/stim + gem/shard/amulet/repair).
   * Gold is handled separately. Caps skip the drop silently.
   * Gem/amulet drops are **loot copies** (victim keeps items).
   */
  tryKillItemDrops(
    nickname: string,
    victimIsHuman: boolean,
    rolls: Partial<KillDropRolls> = {},
    nowMs: number = Date.now(),
    victim?: VictimDropContext,
  ): KillItemDropsResult {
    const merged: KillDropRolls = { ...defaultKillRolls(), ...rolls };
    const empty: KillItemDropsResult = {
      egg: null,
      stimulator: false,
      gem: null,
      shard: false,
      amulet: null,
      repairKit: false,
    };
    if (!victimIsHuman) {
      return empty;
    }
    const profile = this.getOrCreateProfile(nickname);
    let egg: EconomyEgg | null = null;
    let stimulator = false;
    let gem: EconomyGem | null = null;
    let shard = false;
    let amulet: EconomyAmulet | null = null;
    let repairKit = false;

    const eggCount = this.countEggs(profile.id);
    const petCount = this.countPets(profile.id);
    if (shouldGrantEggDrop(eggCount, petCount, merged.egg)) {
      try {
        egg = this.grantEgg(nickname, nowMs);
      } catch (err) {
        if (!(err instanceof EconomyActionError)) throw err;
      }
    }

    const stimCount = this.countStimulators(profile.id);
    if (shouldGrantStimulatorDrop(stimCount, merged.stimulator)) {
      try {
        this.grantStimulator(nickname, nowMs);
        stimulator = true;
      } catch (err) {
        if (!(err instanceof EconomyActionError)) throw err;
      }
    }

    if (victim) {
      const victimProfile = this.getOrCreateProfile(victim.nickname);
      const victimHasAmulet = this.hasAnyAmulet(victimProfile.id);
      const victimEquippedGems = this.listGemsOnEquippedPets(victimProfile.id);

      if (
        shouldGrantGemDrop(this.countGems(profile.id), victimEquippedGems.length > 0, merged.gem)
      ) {
        const source = victimEquippedGems[Math.floor(Math.random() * victimEquippedGems.length)]!;
        try {
          // Loot copy may carry death-decayed values (< GEM_VALUE_MIN); never abort kill path.
          gem = this.grantGem(nickname, source.gemType, source.value, nowMs, {
            allowExistingValue: true,
          });
        } catch (err) {
          // Caps or unexpected errors: skip gem drop; do not throw out of kill economy.
          if (!(err instanceof EconomyActionError)) {
            console.warn(
              `[economy] gem loot copy skipped for ${nickname}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      if (
        shouldGrantShard(
          this.countAmulets(profile.id),
          this.getShardCount(profile.id),
          victimHasAmulet,
          victim.alreadyGrantedShard,
        )
      ) {
        try {
          this.addShard(nickname, 1, nowMs);
          shard = true;
        } catch (err) {
          if (!(err instanceof EconomyActionError)) throw err;
        }
      }

      if (shouldGrantAmuletDrop(this.countAmulets(profile.id), victimHasAmulet, merged.amulet)) {
        const victimAmulets = this.listAmulets(victimProfile.id);
        const equipped = victimAmulets.find((a) => a.equipped);
        const source =
          equipped ?? victimAmulets[Math.floor(Math.random() * victimAmulets.length)];
        if (source) {
          try {
            amulet = this.grantAmulet(nickname, source.durability, nowMs);
          } catch (err) {
            if (!(err instanceof EconomyActionError)) throw err;
          }
        }
      }

      if (shouldGrantRepairKitDrop(this.countRepairKits(profile.id), merged.repairKit)) {
        try {
          this.grantRepairKit(nickname, nowMs);
          repairKit = true;
        } catch (err) {
          if (!(err instanceof EconomyActionError)) throw err;
        }
      }
    }

    return { egg, stimulator, gem, shard, amulet, repairKit };
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
        equipSlot: null as 1 | 2 | null,
        createdAt: nowMs,
      };
    });
    return run();
  }

  equipPet(nickname: string, petId: number, slot: number, nowMs: number = Date.now()): EconomyPet {
    if (slot !== 1 && slot !== 2) {
      throw new EconomyActionError("invalid_slot", `invalid equip slot ${slot}`);
    }
    const profile = this.getOrCreateProfile(nickname);
    if (slot === 2 && !this.isSlot2Enabled(profile.id)) {
      throw new EconomyActionError("slot2_disabled", "pet slot 2 requires an equipped amulet");
    }
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
      this.db
        .prepare("UPDATE pets SET equip_slot = NULL WHERE profile_id = ? AND equip_slot = ?")
        .run(profile.id, slot);
      this.db.prepare("UPDATE pets SET equip_slot = ? WHERE id = ?").run(slot, petId);
      this.touchProfile(profile.id, nowMs);
      return rowToPet({ ...petRow, equip_slot: slot });
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

  socketGem(nickname: string, gemId: number, petId: number, nowMs: number = Date.now()): EconomyGem {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const gemRow = this.db
        .prepare(
          `SELECT id, profile_id, type, value, pet_id, created_at FROM gems WHERE id = ?`,
        )
        .get(gemId) as GemRow | undefined;
      if (!gemRow) {
        throw new EconomyActionError("not_found", `gem ${gemId} not found`);
      }
      if (gemRow.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "gem belongs to another profile");
      }
      if (gemRow.pet_id !== null) {
        throw new EconomyActionError("already_socketed", "gem is already socketed");
      }
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
      const occupied = this.db
        .prepare("SELECT id FROM gems WHERE pet_id = ? AND type = ?")
        .get(petId, gemRow.type) as { id: number } | undefined;
      if (occupied) {
        throw new EconomyActionError("type_occupied", `pet already has a ${gemRow.type} gem`);
      }
      this.db.prepare("UPDATE gems SET pet_id = ? WHERE id = ?").run(petId, gemId);
      this.touchProfile(profile.id, nowMs);
      return rowToGem({ ...gemRow, pet_id: petId });
    });
    return run();
  }

  unsocketGem(nickname: string, gemId: number, nowMs: number = Date.now()): EconomyGem {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const gemRow = this.db
        .prepare(
          `SELECT id, profile_id, type, value, pet_id, created_at FROM gems WHERE id = ?`,
        )
        .get(gemId) as GemRow | undefined;
      if (!gemRow) {
        throw new EconomyActionError("not_found", `gem ${gemId} not found`);
      }
      if (gemRow.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "gem belongs to another profile");
      }
      if (gemRow.pet_id === null) {
        throw new EconomyActionError("not_socketed", "gem is not socketed");
      }
      // Cap check on remove: always true when moving to bag (same profile gem count).
      if (this.countGems(profile.id) > ECONOMY_CAPS.gems) {
        throw new EconomyActionError("gem_cap", "gem cap exceeded");
      }
      this.db.prepare("UPDATE gems SET pet_id = NULL WHERE id = ?").run(gemId);
      this.touchProfile(profile.id, nowMs);
      return rowToGem({ ...gemRow, pet_id: null });
    });
    return run();
  }

  equipAmulet(nickname: string, amuletId: number, nowMs: number = Date.now()): EconomyAmulet {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT id, profile_id, durability, equipped, created_at FROM amulets WHERE id = ?`,
        )
        .get(amuletId) as AmuletRow | undefined;
      if (!row) {
        throw new EconomyActionError("not_found", `amulet ${amuletId} not found`);
      }
      if (row.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "amulet belongs to another profile");
      }
      if (row.equipped === 1) {
        throw new EconomyActionError("already_equipped", "amulet already equipped");
      }
      this.db
        .prepare("UPDATE amulets SET equipped = 0 WHERE profile_id = ? AND equipped = 1")
        .run(profile.id);
      this.db.prepare("UPDATE amulets SET equipped = 1 WHERE id = ?").run(amuletId);
      this.touchProfile(profile.id, nowMs);
      return rowToAmulet({ ...row, equipped: 1 });
    });
    return run();
  }

  unequipAmulet(nickname: string, amuletId: number, nowMs: number = Date.now()): EconomyAmulet {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT id, profile_id, durability, equipped, created_at FROM amulets WHERE id = ?`,
        )
        .get(amuletId) as AmuletRow | undefined;
      if (!row) {
        throw new EconomyActionError("not_found", `amulet ${amuletId} not found`);
      }
      if (row.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "amulet belongs to another profile");
      }
      if (row.equipped !== 1) {
        throw new EconomyActionError("not_equipped", "amulet is not equipped");
      }
      this.db.prepare("UPDATE amulets SET equipped = 0 WHERE id = ?").run(amuletId);
      // Force unequip pet in slot 2 when amulet removed.
      this.db
        .prepare("UPDATE pets SET equip_slot = NULL WHERE profile_id = ? AND equip_slot = 2")
        .run(profile.id);
      this.touchProfile(profile.id, nowMs);
      return rowToAmulet({ ...row, equipped: 0 });
    });
    return run();
  }

  craftAmulet(nickname: string, nowMs: number = Date.now()): EconomyAmulet {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      if (this.countAmulets(profile.id) >= ECONOMY_CAPS.amulets) {
        throw new EconomyActionError("amulet_cap", "amulet cap reached");
      }
      const shards = this.getShardCount(profile.id);
      if (shards < ECONOMY_CAPS.amuletCraftShards) {
        throw new EconomyActionError("insufficient_shards", "need 10 shards to craft an amulet");
      }
      const next = shards - ECONOMY_CAPS.amuletCraftShards;
      this.db
        .prepare(
          `INSERT INTO shards (profile_id, count) VALUES (@profile_id, @count)
           ON CONFLICT(profile_id) DO UPDATE SET count = @count`,
        )
        .run({ profile_id: profile.id, count: next });
      const result = this.db
        .prepare(
          `INSERT INTO amulets (profile_id, durability, equipped, created_at)
           VALUES (@profile_id, @durability, 0, @created_at)`,
        )
        .run({
          profile_id: profile.id,
          durability: ECONOMY_CAPS.amuletDurabilityMax,
          created_at: nowMs,
        });
      this.touchProfile(profile.id, nowMs);
      return {
        id: Number(result.lastInsertRowid),
        profileId: profile.id,
        durability: ECONOMY_CAPS.amuletDurabilityMax,
        equipped: false,
        createdAt: nowMs,
      };
    });
    return run();
  }

  repairAmulet(nickname: string, amuletId: number, nowMs: number = Date.now()): EconomyAmulet {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      const row = this.db
        .prepare(
          `SELECT id, profile_id, durability, equipped, created_at FROM amulets WHERE id = ?`,
        )
        .get(amuletId) as AmuletRow | undefined;
      if (!row) {
        throw new EconomyActionError("not_found", `amulet ${amuletId} not found`);
      }
      if (row.profile_id !== profile.id) {
        throw new EconomyActionError("cross_profile", "amulet belongs to another profile");
      }
      const kit = this.db
        .prepare("SELECT id FROM repair_kits WHERE profile_id = ? ORDER BY id ASC LIMIT 1")
        .get(profile.id) as { id: number } | undefined;
      if (!kit) {
        throw new EconomyActionError("no_repair_kit", "no repair kit available");
      }
      const nextDur = Math.min(ECONOMY_CAPS.amuletDurabilityMax, row.durability + 1);
      this.db.prepare("DELETE FROM repair_kits WHERE id = ?").run(kit.id);
      this.db.prepare("UPDATE amulets SET durability = ? WHERE id = ?").run(nextDur, amuletId);
      this.touchProfile(profile.id, nowMs);
      return rowToAmulet({ ...row, durability: nextDur });
    });
    return run();
  }

  /**
   * Human death penalties (EPIC 25 §2.4): equipped amulet durability −1
   * (destroy at 0); each pet that was active at death (slot 1 or 2) and its
   * socketed gems lose 10% effectiveness (floor, min 1). Slot-2 unequip runs
   * AFTER decay so a destroyed amulet does not skip the slot-2 pet (Critic F-002).
   * Bots must not call this.
   */
  applyHumanDeathPenalties(
    nickname: string,
    nowMs: number = Date.now(),
  ): {
    amuletDestroyed: boolean;
    durabilityAfter: number | null;
    petsDecayed: number;
    gemsDecayed: number;
  } {
    const profile = this.getOrCreateProfile(nickname);
    const run = this.db.transaction(() => {
      let amuletDestroyed = false;
      let durabilityAfter: number | null = null;
      let petsDecayed = 0;
      let gemsDecayed = 0;

      // Snapshot active pets before amulet destroy / slot2 unequip (F-002).
      const activePets = this.db
        .prepare(
          `SELECT id, profile_id, type, base_value, equip_slot, created_at FROM pets
           WHERE profile_id = ? AND equip_slot IN (1, 2)`,
        )
        .all(profile.id) as PetRow[];

      const equipped = this.db
        .prepare(
          `SELECT id, profile_id, durability, equipped, created_at FROM amulets
           WHERE profile_id = ? AND equipped = 1 LIMIT 1`,
        )
        .get(profile.id) as AmuletRow | undefined;
      if (equipped) {
        const next = equipped.durability - 1;
        if (next <= 0) {
          this.db.prepare("DELETE FROM amulets WHERE id = ?").run(equipped.id);
          amuletDestroyed = true;
          durabilityAfter = 0;
        } else {
          this.db.prepare("UPDATE amulets SET durability = ? WHERE id = ?").run(next, equipped.id);
          durabilityAfter = next;
        }
      }

      for (const pet of activePets) {
        const nextBase = applyDeathEffectivenessDecay(pet.base_value);
        if (nextBase !== pet.base_value) {
          this.db.prepare("UPDATE pets SET base_value = ? WHERE id = ?").run(nextBase, pet.id);
          petsDecayed += 1;
        }
        const gems = this.db
          .prepare(
            `SELECT id, profile_id, type, value, pet_id, created_at FROM gems WHERE pet_id = ?`,
          )
          .all(pet.id) as GemRow[];
        for (const gem of gems) {
          const nextVal = applyDeathEffectivenessDecay(gem.value);
          if (nextVal !== gem.value) {
            this.db.prepare("UPDATE gems SET value = ? WHERE id = ?").run(nextVal, gem.id);
            gemsDecayed += 1;
          }
        }
      }

      // Unequip slot 2 only after decay so the former slot-2 pet still loses 10%.
      if (amuletDestroyed) {
        this.db
          .prepare("UPDATE pets SET equip_slot = NULL WHERE profile_id = ? AND equip_slot = 2")
          .run(profile.id);
      }

      this.touchProfile(profile.id, nowMs);
      return { amuletDestroyed, durabilityAfter, petsDecayed, gemsDecayed };
    });
    return run();
  }

  /** Ratings for an already-known nickname key (no create). */
  getRatingsForKey(nicknameKey: string): ProfileRatings {
    const profile = this.getProfile(nicknameKey);
    if (!profile) return emptyRatings();
    return this.computeRatings(profile.id);
  }

  /** Test helper: grant a pet directly without egg. */
  grantPetForTests(
    nickname: string,
    type: PetType,
    baseValue: number,
    nowMs: number = Date.now(),
  ): EconomyPet {
    const profile = this.getOrCreateProfile(nickname);
    if (this.countPets(profile.id) >= ECONOMY_CAPS.pets) {
      throw new EconomyActionError("pet_cap", "pet cap reached");
    }
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
      equipSlot: null,
      createdAt: nowMs,
    };
  }

  private touchProfile(profileId: number, nowMs: number): void {
    this.db.prepare("UPDATE profiles SET updated_at = ? WHERE id = ?").run(nowMs, profileId);
  }
}

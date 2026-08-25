// Durable player economy profiles keyed by nickname + economy scope (EPIC 23–27, 35).
// Redis primary store with write-through in-process cache. Single game-server
// process assumption; Redis AOF required for durability across Redis restarts.
// EPIC 35: two isolated pools per nickname — deathmatch | sandbox.

import type { Redis } from "ioredis";
import {
  DROP_CHANCE,
  ECONOMY_CAPS,
  GEM_TYPES,
  GEM_VALUE_MAX,
  GEM_VALUE_MIN,
  GOLD_DROP_MAX,
  GOLD_DROP_MIN,
  INCUBATION,
  INVENTORY_ITEM_TYPES,
  LEADERBOARD_LIMIT,
  PET_TYPES,
  REPAIR_KIT_SOFT_CAP,
  STIMULATOR_SOFT_CAP,
  aggregateEquippedRatings,
  applyDeathEffectivenessDecay,
  applyStimulatorDeadline,
  emptyRatings,
  footprintForItemType,
  isEggReady,
  isValidAnchor,
  isValidPaletteIndex,
  randomPaletteIndex,
  type GemType,
  type InventoryItemType,
  type PetGemBonuses,
  type PetType,
  type MatchMode,
  type ProfileRatings,
  normalizeNickname,
} from "@cubewars/shared";
import {
  cloneDocument,
  createEmptyDocument,
  type EconomyDocument,
  type StoredGem,
} from "./document.js";
import { maybeImportSqliteToRedis } from "./importSqlite.js";
import {
  autoPackDocument,
  canPlaceAt,
  clearItemAnchor,
  findFit,
  needsAutoPack,
  setItemAnchor,
} from "./inventoryGrid.js";
import { connectRedis, resolveRedisUrl } from "./redis.js";
import { footprintForEscrow, type EscrowInsertRef, type EscrowPayload } from "./escrow.js";

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
  slotAnchor: number;
  createdAt: number;
}

export interface EconomyPet {
  id: number;
  profileId: number;
  type: PetType;
  baseValue: number;
  equipSlot: 1 | 2 | null;
  slotAnchor: number | null;
  /** EPIC 39: AVATAR_COLOR_PALETTE index for companion mesh. */
  colorIndex: number;
  createdAt: number;
}

export interface EconomyGem {
  id: number;
  profileId: number;
  gemType: GemType;
  value: number;
  petId: number | null;
  slotAnchor: number | null;
  createdAt: number;
}

export interface EconomyAmulet {
  id: number;
  profileId: number;
  durability: number;
  equipped: boolean;
  slotAnchor: number | null;
  createdAt: number;
}

export interface EconomyStimulator {
  id: number;
  profileId: number;
  slotAnchor: number;
  createdAt: number;
}

export interface EconomyRepairKit {
  id: number;
  profileId: number;
  slotAnchor: number;
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
  stimulators: EconomyStimulator[];
  gems: EconomyGem[];
  amulets: EconomyAmulet[];
  shardCount: number;
  shardSlotAnchor: number | null;
  repairKitCount: number;
  repairKits: EconomyRepairKit[];
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
  | "not_equipped"
  | "inventory_full"
  | "bad_anchor"
  | "overlap"
  | "not_in_bag"
  | "invalid_item_type"
  | "insufficient_gold"
  | "invalid_price"
  | "sandbox_forbidden"
  | "buyer_cap"
  | "lot_inactive"
  | "bid_too_low"
  | "self_bid"
  | "no_buyout"
  | "trade_invalid"
  | "not_deathmatch";

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
  substitutedGold: number;
  substitutedKinds: string[];
}

export interface KillDropRolls {
  egg: number;
  stimulator: number;
  gem: number;
  amulet: number;
  repairKit: number;
  substituteGold?: number;
}

export interface VictimDropContext {
  nickname: string;
  alreadyGrantedShard: boolean;
}

export interface CareerStatsEntry {
  nickname: string;
  nicknameKey: string;
  kills: number;
  deaths: number;
}

export interface EndlessCareerEntry {
  nickname: string;
  nicknameKey: string;
  botKills: number;
  distanceKm: number;
}

export interface EconomyStoreOpenOptions {
  /** Redis URL override (tests). Default: CUBEWARS_REDIS_URL or redis://127.0.0.1:6379 */
  redisUrl?: string;
  /**
   * Key namespace without trailing colon (default `cw`).
   * Tests should pass a unique prefix e.g. `cw:test:<uuid>` and call `flushNamespace()`.
   */
  keyPrefix?: string;
  /** Skip optional SQLite import (tests). */
  skipSqliteImport?: boolean;
}

export type EconomyScope = "deathmatch" | "sandbox";

/** Competitive (public / Deathmatch) pool is the default for lobby/career and legacy callers. */
export const DEFAULT_ECONOMY_SCOPE: EconomyScope = "deathmatch";

/** Server-only: derive economy pool from match mode. Never trust a client-supplied scope. */
export function economyScopeFromMatchMode(mode: MatchMode): EconomyScope {
  return mode === "public" ? "deathmatch" : "sandbox";
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

/** EPIC 39: coerce legacy/missing colorIndex to a valid palette index (default 0). */
function normalizePetColorIndex(value: unknown): number {
  return isValidPaletteIndex(value) ? value : 0;
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

function rollGoldDropAmount(): number {
  return GOLD_DROP_MIN + Math.floor(Math.random() * (GOLD_DROP_MAX - GOLD_DROP_MIN + 1));
}

export class EconomyStore {
  /** Display string for logs (Redis URL). Kept as `dbPath` alias for older callers. */
  readonly dbPath: string;
  readonly redisUrl: string;
  readonly keyPrefix: string;

  private readonly redis: Redis;
  /** Write-through cache: `${scope}:${nicknameKey}` → document. */
  private readonly cache = new Map<string, EconomyDocument>();

  private constructor(redis: Redis, redisUrl: string, keyPrefix: string) {
    this.redis = redis;
    this.redisUrl = redisUrl;
    this.keyPrefix = keyPrefix;
    this.dbPath = redisUrl;
  }

  /** EPIC 38: Redis client for auction house keys in the same namespace. */
  getRedisClient(): Redis {
    return this.redis;
  }

  private cacheKey(scope: EconomyScope, nicknameKey: string): string {
    return `${scope}:${nicknameKey}`;
  }

  /** Scoped Redis key (EPIC 35): deathmatch | sandbox pools are fully isolated. */
  private economyKey(scope: EconomyScope, nicknameKey: string): string {
    return `${this.keyPrefix}:economy:v1:${scope}:${nicknameKey}`;
  }

  /** Pre-EPIC-35 unscoped key — migrated into deathmatch on first read. */
  private legacyEconomyKey(nicknameKey: string): string {
    return `${this.keyPrefix}:economy:v1:${nicknameKey}`;
  }

  private get nickIndexKey(): string {
    return `${this.keyPrefix}:economy:v1:index`;
  }

  private get lbPvpKey(): string {
    return `${this.keyPrefix}:lb:pvp:v1`;
  }

  private get lbEndlessKey(): string {
    return `${this.keyPrefix}:lb:endless:v1`;
  }

  private get profileIdCounterKey(): string {
    return `${this.keyPrefix}:id:profile`;
  }

  private get sqliteImportedMarkerKey(): string {
    return `${this.keyPrefix}:meta:sqlite_imported`;
  }

  /**
   * Connect Redis (PING required), optional SQLite→Redis import, ready for use.
   * Throws with a clear message if Redis is down.
   */
  static async open(options: EconomyStoreOpenOptions | string = {}): Promise<EconomyStore> {
    // Back-compat: older regressions passed a sqlite path string — ignore path,
    // use Redis with an isolated prefix derived from the path basename.
    let opts: EconomyStoreOpenOptions;
    if (typeof options === "string") {
      const slug = options.replace(/[^a-zA-Z0-9]+/g, "_").slice(-48);
      opts = {
        keyPrefix: `cw:test:${slug || "legacy"}`,
        skipSqliteImport: true,
      };
    } else {
      opts = options;
    }

    const { redis, url, keyPrefix } = await connectRedis({
      url: opts.redisUrl ?? resolveRedisUrl(),
      keyPrefix: opts.keyPrefix,
    });
    const store = new EconomyStore(redis, url, keyPrefix);

    if (!opts.skipSqliteImport) {
      await maybeImportSqliteToRedis(redis, {
        economyKey: (k) => store.economyKey("deathmatch", k),
        itemOwnerKey: (kind, id) => store.itemOwnerKey(kind, id),
        nickIndexKey: store.nickIndexKey,
        lbPvpKey: store.lbPvpKey,
        lbEndlessKey: store.lbEndlessKey,
        profileIdCounterKey: store.profileIdCounterKey,
        sqliteImportedMarkerKey: store.sqliteImportedMarkerKey,
      });
    }

    console.log(`[economy] redis ready: ${url} (prefix=${keyPrefix})`);
    return store;
  }

  /** Close Redis connection (tests / shutdown). */
  async close(): Promise<void> {
    this.cache.clear();
    await this.redis.quit();
  }

  /** Delete all keys under this store's prefix (tests only). */
  async flushNamespace(): Promise<void> {
    const pattern = `${this.keyPrefix}:*`;
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== "0");
    this.cache.clear();
  }

  private docToProfile(doc: EconomyDocument): EconomyProfile {
    return {
      id: doc.id,
      nicknameKey: doc.nicknameKey,
      nickname: doc.nickname,
      gold: doc.gold,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private eggFromDoc(doc: EconomyDocument, egg: EconomyDocument["eggs"][number]): EconomyEgg {
    return {
      id: egg.id,
      profileId: doc.id,
      hatchDeadlineMs: egg.hatchDeadlineMs,
      slotAnchor: typeof egg.slotAnchor === "number" ? egg.slotAnchor : -1,
      createdAt: egg.createdAt,
    };
  }

  private petFromDoc(doc: EconomyDocument, pet: EconomyDocument["pets"][number]): EconomyPet {
    return {
      id: pet.id,
      profileId: doc.id,
      type: pet.type,
      baseValue: pet.baseValue,
      equipSlot: pet.equipSlot,
      slotAnchor:
        pet.equipSlot === 1 || pet.equipSlot === 2
          ? null
          : typeof pet.slotAnchor === "number"
            ? pet.slotAnchor
            : null,
      colorIndex: normalizePetColorIndex(pet.colorIndex),
      createdAt: pet.createdAt,
    };
  }

  private gemFromDoc(doc: EconomyDocument, gem: EconomyDocument["gems"][number]): EconomyGem {
    return {
      id: gem.id,
      profileId: doc.id,
      gemType: gem.gemType,
      value: gem.value,
      petId: gem.petId,
      slotAnchor:
        gem.petId !== null
          ? null
          : typeof gem.slotAnchor === "number"
            ? gem.slotAnchor
            : null,
      createdAt: gem.createdAt,
    };
  }

  private amuletFromDoc(
    doc: EconomyDocument,
    amulet: EconomyDocument["amulets"][number],
  ): EconomyAmulet {
    return {
      id: amulet.id,
      profileId: doc.id,
      durability: amulet.durability,
      equipped: amulet.equipped,
      slotAnchor: amulet.equipped
        ? null
        : typeof amulet.slotAnchor === "number"
          ? amulet.slotAnchor
          : null,
      createdAt: amulet.createdAt,
    };
  }

  private stimFromDoc(
    doc: EconomyDocument,
    stim: EconomyDocument["stimulators"][number],
  ): EconomyStimulator {
    return {
      id: stim.id,
      profileId: doc.id,
      slotAnchor: typeof stim.slotAnchor === "number" ? stim.slotAnchor : -1,
      createdAt: stim.createdAt,
    };
  }

  private kitFromDoc(
    doc: EconomyDocument,
    kit: EconomyDocument["repairKits"][number],
  ): EconomyRepairKit {
    return {
      id: kit.id,
      profileId: doc.id,
      slotAnchor: typeof kit.slotAnchor === "number" ? kit.slotAnchor : -1,
      createdAt: kit.createdAt,
    };
  }

  private async loadDoc(
    scope: EconomyScope,
    nicknameKey: string,
  ): Promise<EconomyDocument | null> {
    const ck = this.cacheKey(scope, nicknameKey);
    const cached = this.cache.get(ck);
    if (cached) {
      await this.ensureInventoryPacked(scope, cached);
      return cached;
    }
    let raw = await this.redis.get(this.economyKey(scope, nicknameKey));
    if (!raw && scope === "deathmatch") {
      raw = await this.migrateLegacyEconomyDoc(nicknameKey);
    }
    if (!raw) return null;
    const doc = JSON.parse(raw) as EconomyDocument;
    if (doc.shardSlotAnchor === undefined) doc.shardSlotAnchor = null;
    this.cache.set(ck, doc);
    await this.ensureInventoryPacked(scope, doc);
    return doc;
  }

  /**
   * EPIC 35: one-time idempotent migration of unscoped
   * `${prefix}:economy:v1:${nicknameKey}` → deathmatch-scoped key.
   * Returns the document JSON if migration (or concurrent migrate) succeeded.
   */
  private async migrateLegacyEconomyDoc(nicknameKey: string): Promise<string | null> {
    const legacyKey = this.legacyEconomyKey(nicknameKey);
    const legacyRaw = await this.redis.get(legacyKey);
    if (!legacyRaw) return null;
    const scopedKey = this.economyKey("deathmatch", nicknameKey);
    const created = await this.redis.set(scopedKey, legacyRaw, "NX");
    if (created === "OK") {
      await this.redis.del(legacyKey);
      console.log(`[economy] migrated legacy profile -> deathmatch for ${nicknameKey}`);
      return legacyRaw;
    }
    // Another reader won the race — use whatever is under the scoped key now.
    return this.redis.get(scopedKey);
  }

  /** One-shot auto-pack for legacy docs missing slotAnchor (EPIC 29). */
  private async ensureInventoryPacked(scope: EconomyScope, doc: EconomyDocument): Promise<void> {
    if (!needsAutoPack(doc)) return;
    autoPackDocument(doc);
    console.log(`[economy] inventory auto-pack once for ${doc.nicknameKey} [${scope}]`);
    await this.saveDoc(scope, doc);
  }

  /** Assign a free bag anchor or throw inventory_full. */
  private assignBagAnchor(
    doc: EconomyDocument,
    itemType: InventoryItemType,
    itemId: number,
  ): number {
    const footprint = footprintForItemType(itemType);
    const anchor = findFit(doc, footprint);
    if (anchor === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cells for footprint");
    }
    setItemAnchor(doc, itemType, itemId, anchor);
    return anchor;
  }

  /**
   * Persist document to Redis first; only then update the write-through cache.
   * On Redis failure: invalidate cache for this key and throw so callers do not
   * treat the mutation as durable (F-002).
   */
  private async saveDoc(scope: EconomyScope, doc: EconomyDocument): Promise<void> {
    const ck = this.cacheKey(scope, doc.nicknameKey);
    const multi = this.redis.multi();
    multi.set(this.economyKey(scope, doc.nicknameKey), JSON.stringify(doc));
    multi.sadd(this.nickIndexKey, doc.nicknameKey);
    // Career / endless leaderboards stay on the deathmatch document only
    // (competitive stats; sandbox farming must not pollute them).
    if (scope === "deathmatch") {
      if (doc.career.kills > 0 || doc.career.deaths > 0) {
        multi.zadd(this.lbPvpKey, doc.career.kills, doc.nicknameKey);
      }
      if (doc.endless.botKills > 0 || doc.endless.distanceKm > 0) {
        multi.zadd(this.lbEndlessKey, doc.endless.botKills, doc.nicknameKey);
      }
    }

    let results: [Error | null, unknown][] | null;
    try {
      results = await multi.exec();
    } catch (err) {
      this.cache.delete(ck);
      throw err instanceof Error ? err : new Error(String(err));
    }

    if (!results) {
      this.cache.delete(ck);
      throw new Error(
        `Redis MULTI/EXEC discarded while saving economy doc for ${doc.nicknameKey} [${scope}]`,
      );
    }
    for (const [err] of results) {
      if (err) {
        this.cache.delete(ck);
        throw err;
      }
    }

    this.cache.set(ck, doc);
  }

  private itemOwnerKey(kind: "pet" | "egg" | "gem" | "amulet", id: number): string {
    return `${this.keyPrefix}:item:${kind}:${id}`;
  }

  private async bindItemOwner(
    kind: "pet" | "egg" | "gem" | "amulet",
    id: number,
    nicknameKey: string,
  ): Promise<void> {
    await this.redis.set(this.itemOwnerKey(kind, id), nicknameKey);
  }

  private async unbindItemOwner(kind: "pet" | "egg" | "gem" | "amulet", id: number): Promise<void> {
    await this.redis.del(this.itemOwnerKey(kind, id));
  }

  private async allocProfileId(): Promise<number> {
    return this.redis.incr(this.profileIdCounterKey);
  }

  private async assertItemOwnedOrThrow(
    kind: "pet" | "egg" | "gem" | "amulet",
    id: number,
    nicknameKey: string,
    notFoundMessage: string,
  ): Promise<void> {
    const owner = await this.redis.get(this.itemOwnerKey(kind, id));
    if (owner && owner !== nicknameKey) {
      throw new EconomyActionError("cross_profile", `${kind} belongs to another profile`);
    }
    if (!owner) {
      throw new EconomyActionError("not_found", notFoundMessage);
    }
  }

  async getOrCreateProfile(
    nickname: string,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyProfile> {
    const normalized = normalizeNickname(nickname);
    if (!normalized.ok) {
      throw new Error(`cannot create economy profile for invalid nickname: ${normalized.reason}`);
    }
    const existing = await this.loadDoc(scope, normalized.key);
    if (existing) {
      if (existing.nickname !== normalized.nickname) {
        const now = Date.now();
        existing.nickname = normalized.nickname;
        existing.updatedAt = now;
        await this.saveDoc(scope, existing);
      }
      return this.docToProfile(existing);
    }

    const now = Date.now();
    const id = await this.allocProfileId();
    const doc = createEmptyDocument(id, normalized.key, normalized.nickname, now);
    await this.saveDoc(scope, doc);
    return this.docToProfile(doc);
  }

  async getProfile(
    nicknameKey: string,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyProfile | null> {
    const doc = await this.loadDoc(scope, nicknameKey);
    return doc ? this.docToProfile(doc) : null;
  }

  async getGold(
    nicknameKey: string,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<number> {
    return (await this.getProfile(nicknameKey, scope))?.gold ?? 0;
  }

  async addGold(
    nicknameKeyOrNickname: string,
    amount: number,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyProfile> {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`addGold amount must be a non-negative finite number, got ${amount}`);
    }
    const amountInt = Math.floor(amount);

    const normalized = normalizeNickname(nicknameKeyOrNickname);
    const key = normalized.ok ? normalized.key : nicknameKeyOrNickname.toLocaleLowerCase();
    const display = normalized.ok ? normalized.nickname : nicknameKeyOrNickname;

    if (normalized.ok) {
      await this.getOrCreateProfile(display, scope);
    } else if (!(await this.getProfile(key, scope))) {
      throw new Error(`addGold requires an existing profile when nickname is invalid: ${key}`);
    }

    const doc = await this.loadDoc(scope, key);
    if (!doc) {
      throw new Error(`profile missing after addGold for key=${key} scope=${scope}`);
    }
    const now = Date.now();
    doc.gold += amountInt;
    doc.updatedAt = now;
    await this.saveDoc(scope, doc);
    return this.docToProfile(doc);
  }

  async incrementCareerKillDeath(
    attackerNickname: string,
    victimNickname: string,
  ): Promise<{ attacker: CareerStatsEntry; victim: CareerStatsEntry }> {
    // Career K/D always lives on the deathmatch pool (competitive).
    const scope: EconomyScope = "deathmatch";
    const attackerProfile = await this.getOrCreateProfile(attackerNickname, scope);
    const victimProfile = await this.getOrCreateProfile(victimNickname, scope);
    const attackerDoc = (await this.loadDoc(scope, attackerProfile.nicknameKey))!;
    const victimDoc = (await this.loadDoc(scope, victimProfile.nicknameKey))!;
    const now = Date.now();
    attackerDoc.career.kills += 1;
    attackerDoc.career.updatedAt = now;
    attackerDoc.updatedAt = now;
    victimDoc.career.deaths += 1;
    victimDoc.career.updatedAt = now;
    victimDoc.updatedAt = now;
    await this.saveDoc(scope, attackerDoc);
    await this.saveDoc(scope, victimDoc);
    return {
      attacker: {
        nicknameKey: attackerDoc.nicknameKey,
        nickname: attackerDoc.nickname,
        kills: attackerDoc.career.kills,
        deaths: attackerDoc.career.deaths,
      },
      victim: {
        nicknameKey: victimDoc.nicknameKey,
        nickname: victimDoc.nickname,
        kills: victimDoc.career.kills,
        deaths: victimDoc.career.deaths,
      },
    };
  }

  async listCareerLeaderboard(limit: number = LEADERBOARD_LIMIT): Promise<CareerStatsEntry[]> {
    const lim = Math.max(0, Math.floor(limit));
    if (lim === 0) return [];
    // Fetch a generous slice then re-sort by kills DESC, deaths ASC, nickname.
    const fetchCount =
      lim === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Math.min(lim * 5, 10_000);
    const members =
      fetchCount === Number.MAX_SAFE_INTEGER
        ? await this.redis.zrevrange(this.lbPvpKey, 0, -1)
        : await this.redis.zrevrange(this.lbPvpKey, 0, fetchCount - 1);
    const entries: CareerStatsEntry[] = [];
    for (const key of members) {
      const doc = await this.loadDoc("deathmatch", key);
      if (!doc) continue;
      if (doc.career.kills === 0 && doc.career.deaths === 0) continue;
      entries.push({
        nicknameKey: doc.nicknameKey,
        nickname: doc.nickname,
        kills: doc.career.kills,
        deaths: doc.career.deaths,
      });
    }
    entries.sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.nickname.localeCompare(b.nickname),
    );
    return lim === Number.MAX_SAFE_INTEGER ? entries : entries.slice(0, lim);
  }

  async listAllCareerStats(): Promise<CareerStatsEntry[]> {
    // Include all nicknames that have career activity (index scan for deaths-only).
    const keys = await this.redis.smembers(this.nickIndexKey);
    const entries: CareerStatsEntry[] = [];
    for (const key of keys) {
      const doc = await this.loadDoc("deathmatch", key);
      if (!doc) continue;
      if (doc.career.kills === 0 && doc.career.deaths === 0) continue;
      entries.push({
        nicknameKey: doc.nicknameKey,
        nickname: doc.nickname,
        kills: doc.career.kills,
        deaths: doc.career.deaths,
      });
    }
    entries.sort(
      (a, b) => b.kills - a.kills || a.deaths - b.deaths || a.nickname.localeCompare(b.nickname),
    );
    return entries;
  }

  async upsertEndlessBest(
    nickname: string,
    botKills: number,
    distanceKm: number,
  ): Promise<EndlessCareerEntry> {
    if (!Number.isFinite(botKills) || botKills < 0 || !Number.isFinite(distanceKm) || distanceKm < 0) {
      throw new Error(`invalid endless best values: botKills=${botKills} distanceKm=${distanceKm}`);
    }
    const killsInt = Math.floor(botKills);
    // Endless personal bests stay on the deathmatch document (lobby leaderboard).
    const scope: EconomyScope = "deathmatch";
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    const now = Date.now();
    doc.endless.botKills = Math.max(doc.endless.botKills, killsInt);
    doc.endless.distanceKm = Math.max(doc.endless.distanceKm, distanceKm);
    doc.endless.updatedAt = now;
    doc.updatedAt = now;
    await this.saveDoc(scope, doc);
    return {
      nicknameKey: doc.nicknameKey,
      nickname: doc.nickname,
      botKills: doc.endless.botKills,
      distanceKm: doc.endless.distanceKm,
    };
  }

  async listEndlessLeaderboard(limit: number = LEADERBOARD_LIMIT): Promise<EndlessCareerEntry[]> {
    const lim = Math.max(0, Math.floor(limit));
    if (lim === 0) return [];
    const fetchCount =
      lim === Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : Math.min(lim * 5, 10_000);
    const members =
      fetchCount === Number.MAX_SAFE_INTEGER
        ? await this.redis.zrevrange(this.lbEndlessKey, 0, -1)
        : await this.redis.zrevrange(this.lbEndlessKey, 0, fetchCount - 1);
    const entries: EndlessCareerEntry[] = [];
    for (const key of members) {
      const doc = await this.loadDoc("deathmatch", key);
      if (!doc) continue;
      if (doc.endless.botKills === 0 && doc.endless.distanceKm === 0) continue;
      entries.push({
        nicknameKey: doc.nicknameKey,
        nickname: doc.nickname,
        botKills: doc.endless.botKills,
        distanceKm: doc.endless.distanceKm,
      });
    }
    entries.sort(
      (a, b) =>
        b.botKills - a.botKills ||
        b.distanceKm - a.distanceKm ||
        a.nickname.localeCompare(b.nickname),
    );
    return lim === Number.MAX_SAFE_INTEGER ? entries : entries.slice(0, lim);
  }

  async listAllEndlessCareerStats(): Promise<EndlessCareerEntry[]> {
    return this.listEndlessLeaderboard(Number.MAX_SAFE_INTEGER);
  }

  async listEggs(profileId: number): Promise<EconomyEgg[]> {
    const doc = await this.findDocByProfileId(profileId);
    if (!doc) return [];
    return doc.eggs.map((e) => this.eggFromDoc(doc, e));
  }

  async listPets(profileId: number): Promise<EconomyPet[]> {
    const doc = await this.findDocByProfileId(profileId);
    if (!doc) return [];
    return doc.pets.map((p) => this.petFromDoc(doc, p));
  }

  async listGems(profileId: number): Promise<EconomyGem[]> {
    const doc = await this.findDocByProfileId(profileId);
    if (!doc) return [];
    return doc.gems.map((g) => this.gemFromDoc(doc, g));
  }

  async listAmulets(profileId: number): Promise<EconomyAmulet[]> {
    const doc = await this.findDocByProfileId(profileId);
    if (!doc) return [];
    return doc.amulets.map((a) => this.amuletFromDoc(doc, a));
  }

  async countEggs(profileId: number): Promise<number> {
    const doc = await this.findDocByProfileId(profileId);
    return doc?.eggs.length ?? 0;
  }

  async countPets(profileId: number): Promise<number> {
    const doc = await this.findDocByProfileId(profileId);
    return doc?.pets.length ?? 0;
  }

  async countStimulators(profileId: number): Promise<number> {
    const doc = await this.findDocByProfileId(profileId);
    return doc?.stimulators.length ?? 0;
  }

  async countGems(profileId: number): Promise<number> {
    const doc = await this.findDocByProfileId(profileId);
    return doc?.gems.length ?? 0;
  }

  async countAmulets(profileId: number): Promise<number> {
    const doc = await this.findDocByProfileId(profileId);
    return doc?.amulets.length ?? 0;
  }

  async countRepairKits(profileId: number): Promise<number> {
    const doc = await this.findDocByProfileId(profileId);
    return doc?.repairKits.length ?? 0;
  }

  async getShardCount(profileId: number): Promise<number> {
    const doc = await this.findDocByProfileId(profileId);
    return doc?.shardCount ?? 0;
  }

  async hasAnyAmulet(profileId: number): Promise<boolean> {
    return (await this.countAmulets(profileId)) > 0;
  }

  isSlot2EnabledDoc(doc: EconomyDocument): boolean {
    return doc.amulets.some((a) => a.equipped);
  }

  async isSlot2Enabled(profileId: number): Promise<boolean> {
    const doc = await this.findDocByProfileId(profileId);
    return doc ? this.isSlot2EnabledDoc(doc) : false;
  }

  async listGemsOnEquippedPets(profileId: number): Promise<EconomyGem[]> {
    const doc = await this.findDocByProfileId(profileId);
    if (!doc) return [];
    const equippedPetIds = new Set(
      doc.pets.filter((p) => p.equipSlot === 1 || p.equipSlot === 2).map((p) => p.id),
    );
    return doc.gems
      .filter((g) => g.petId !== null && equippedPetIds.has(g.petId))
      .map((g) => this.gemFromDoc(doc, g));
  }

  private gemBonusesByPet(doc: EconomyDocument): Map<number, PetGemBonuses> {
    const map = new Map<number, PetGemBonuses>();
    for (const gem of doc.gems) {
      if (gem.petId === null) continue;
      const existing = map.get(gem.petId) ?? {};
      existing[gem.gemType] = gem.value;
      map.set(gem.petId, existing);
    }
    return map;
  }

  private computeRatings(doc: EconomyDocument): ProfileRatings {
    const gemMap = this.gemBonusesByPet(doc);
    const slot2Enabled = this.isSlot2EnabledDoc(doc);
    return aggregateEquippedRatings(
      doc.pets.map((p) => ({
        type: p.type,
        baseValue: p.baseValue,
        equipSlot: p.equipSlot,
        gems: gemMap.get(p.id),
      })),
      slot2Enabled,
    );
  }

  private async findDocByProfileId(profileId: number): Promise<EconomyDocument | null> {
    for (const doc of this.cache.values()) {
      if (doc.id === profileId) return doc;
    }
    const keys = await this.redis.smembers(this.nickIndexKey);
    const scopes: EconomyScope[] = ["deathmatch", "sandbox"];
    for (const key of keys) {
      for (const scope of scopes) {
        const doc = await this.loadDoc(scope, key);
        if (doc && doc.id === profileId) return doc;
      }
    }
    return null;
  }

  async getFullProfile(
    nickname: string,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<FullEconomyProfile> {
    const base = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, base.nicknameKey))!;
    return {
      id: doc.id,
      nicknameKey: doc.nicknameKey,
      nickname: doc.nickname,
      gold: doc.gold,
      pets: doc.pets.map((p) => this.petFromDoc(doc, p)),
      eggs: doc.eggs.map((e) => this.eggFromDoc(doc, e)),
      stimulatorCount: doc.stimulators.length,
      stimulators: doc.stimulators.map((s) => this.stimFromDoc(doc, s)),
      gems: doc.gems.map((g) => this.gemFromDoc(doc, g)),
      amulets: doc.amulets.map((a) => this.amuletFromDoc(doc, a)),
      shardCount: doc.shardCount,
      shardSlotAnchor:
        doc.shardCount > 0 && typeof doc.shardSlotAnchor === "number"
          ? doc.shardSlotAnchor
          : null,
      repairKitCount: doc.repairKits.length,
      repairKits: doc.repairKits.map((k) => this.kitFromDoc(doc, k)),
      ratings: this.computeRatings(doc),
      slot2Enabled: this.isSlot2EnabledDoc(doc),
    };
  }

  async grantEgg(
    nickname: string,
    nowMs: number = Date.now(),
    durationMs: number = resolveIncubationDurationMs(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyEgg> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.eggs.length >= ECONOMY_CAPS.eggs) {
      throw new EconomyActionError("egg_cap", "egg cap reached");
    }
    if (doc.pets.length >= ECONOMY_CAPS.pets) {
      throw new EconomyActionError("pet_cap", "pet cap reached (cannot grant egg)");
    }
    if (findFit(doc, 1) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cell for egg");
    }
    const hatchDeadlineMs = nowMs + durationMs;
    const id = doc.nextEggId++;
    const egg = { id, hatchDeadlineMs, createdAt: nowMs, slotAnchor: null as number | null };
    doc.eggs.push(egg);
    this.assignBagAnchor(doc, "egg", id);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    await this.bindItemOwner("egg", id, doc.nicknameKey);
    return this.eggFromDoc(doc, egg);
  }

  async grantStimulator(
    nickname: string,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<{ id: number }> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.stimulators.length >= STIMULATOR_SOFT_CAP) {
      throw new EconomyActionError("stimulator_cap", "stimulator soft-cap reached");
    }
    if (findFit(doc, 1) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cell for stimulator");
    }
    const id = doc.nextStimId++;
    doc.stimulators.push({ id, createdAt: nowMs, slotAnchor: null });
    this.assignBagAnchor(doc, "stimulator", id);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return { id };
  }

  async grantGem(
    nickname: string,
    gemType: GemType,
    value: number,
    nowMs: number = Date.now(),
    opts?: { allowExistingValue?: boolean },
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyGem> {
    const minValue = opts?.allowExistingValue ? 1 : GEM_VALUE_MIN;
    if (
      !GEM_TYPES.includes(gemType) ||
      !Number.isInteger(value) ||
      value < minValue ||
      value > GEM_VALUE_MAX
    ) {
      throw new Error(`invalid gem type/value: ${gemType}/${value}`);
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.gems.length >= ECONOMY_CAPS.gems) {
      throw new EconomyActionError("gem_cap", "gem cap reached");
    }
    if (findFit(doc, 1) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cell for gem");
    }
    const id = doc.nextGemId++;
    const gem = {
      id,
      gemType,
      value,
      petId: null as number | null,
      createdAt: nowMs,
      slotAnchor: null as number | null,
    };
    doc.gems.push(gem);
    this.assignBagAnchor(doc, "gem", id);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    await this.bindItemOwner("gem", id, doc.nicknameKey);
    return this.gemFromDoc(doc, gem);
  }

  async grantAmulet(
    nickname: string,
    durability: number = ECONOMY_CAPS.amuletDurabilityMax,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyAmulet> {
    const dur = Math.max(0, Math.min(ECONOMY_CAPS.amuletDurabilityMax, Math.floor(durability)));
    if (dur <= 0) {
      throw new Error("cannot grant amulet with durability <= 0");
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.amulets.length >= ECONOMY_CAPS.amulets) {
      throw new EconomyActionError("amulet_cap", "amulet cap reached");
    }
    if (findFit(doc, 2) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cells for amulet");
    }
    const id = doc.nextAmuletId++;
    const amulet = {
      id,
      durability: dur,
      equipped: false,
      createdAt: nowMs,
      slotAnchor: null as number | null,
    };
    doc.amulets.push(amulet);
    this.assignBagAnchor(doc, "amulet", id);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    await this.bindItemOwner("amulet", id, doc.nicknameKey);
    return this.amuletFromDoc(doc, amulet);
  }

  async grantRepairKit(
    nickname: string,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<{ id: number }> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.repairKits.length >= REPAIR_KIT_SOFT_CAP) {
      throw new EconomyActionError("repair_kit_cap", "repair kit soft-cap reached");
    }
    if (findFit(doc, 1) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cell for repair kit");
    }
    const id = doc.nextRepairKitId++;
    doc.repairKits.push({ id, createdAt: nowMs, slotAnchor: null });
    this.assignBagAnchor(doc, "repair_kit", id);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return { id };
  }

  async addShard(
    nickname: string,
    amount: number = 1,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<number> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new Error(`addShard amount must be a positive integer, got ${amount}`);
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.shardCount >= ECONOMY_CAPS.shards) {
      throw new EconomyActionError("shard_cap", "shard cap reached");
    }
    const hadStack = doc.shardCount > 0;
    if (!hadStack && findFit(doc, 1) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cell for shard stack");
    }
    doc.shardCount = Math.min(ECONOMY_CAPS.shards, doc.shardCount + amount);
    if (!hadStack) {
      this.assignBagAnchor(doc, "shard_stack", 0);
    }
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return doc.shardCount;
  }

  async tryKillItemDrops(
    nickname: string,
    victimIsHuman: boolean,
    rolls: Partial<KillDropRolls> = {},
    nowMs: number = Date.now(),
    victim?: VictimDropContext,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<KillItemDropsResult> {
    return this.resolveKillDrops(nickname, victimIsHuman, rolls, nowMs, victim, scope);
  }

  async resolveKillDrops(
    nickname: string,
    victimIsHuman: boolean,
    rolls: Partial<KillDropRolls> = {},
    nowMs: number = Date.now(),
    victim?: VictimDropContext,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<KillItemDropsResult> {
    const merged: KillDropRolls = { ...defaultKillRolls(), ...rolls };
    const empty: KillItemDropsResult = {
      egg: null,
      stimulator: false,
      gem: null,
      shard: false,
      amulet: null,
      repairKit: false,
      substitutedGold: 0,
      substitutedKinds: [],
    };
    if (!victimIsHuman) {
      return empty;
    }
    await this.getOrCreateProfile(nickname, scope);
    let egg: EconomyEgg | null = null;
    let stimulator = false;
    let gem: EconomyGem | null = null;
    let shard = false;
    let amulet: EconomyAmulet | null = null;
    let repairKit = false;
    let substitutedGold = 0;
    const substitutedKinds: string[] = [];

    const substitute = async (kind: string): Promise<void> => {
      const amount =
        merged.substituteGold !== undefined && Number.isFinite(merged.substituteGold)
          ? Math.floor(merged.substituteGold)
          : rollGoldDropAmount();
      const clamped = Math.max(GOLD_DROP_MIN, Math.min(GOLD_DROP_MAX, amount));
      await this.addGold(nickname, clamped, scope);
      substitutedGold += clamped;
      substitutedKinds.push(kind);
      console.log(
        `[economy] drop_substituted_gold kind=${kind} amount=${clamped} -> ${nickname}`,
      );
    };

    if (merged.egg < DROP_CHANCE.egg) {
      try {
        egg = await this.grantEgg(nickname, nowMs, resolveIncubationDurationMs(), scope);
      } catch (err) {
        if (err instanceof EconomyActionError) await substitute("egg");
        else throw err;
      }
    }

    if (merged.stimulator < DROP_CHANCE.growthStimulator) {
      try {
        await this.grantStimulator(nickname, nowMs, scope);
        stimulator = true;
      } catch (err) {
        if (err instanceof EconomyActionError) await substitute("stimulator");
        else throw err;
      }
    }

    if (victim) {
      const victimProfile = await this.getOrCreateProfile(victim.nickname, scope);
      const victimDoc = (await this.loadDoc(scope, victimProfile.nicknameKey))!;
      const victimHasAmulet = victimDoc.amulets.length > 0;
      const victimEquippedGems = await this.listGemsOnEquippedPets(victimProfile.id);
      const killerProfile = await this.getOrCreateProfile(nickname, scope);
      const killerDoc = (await this.loadDoc(scope, killerProfile.nicknameKey))!;

      if (victimEquippedGems.length > 0 && merged.gem < DROP_CHANCE.gem) {
        const source = victimEquippedGems[Math.floor(Math.random() * victimEquippedGems.length)]!;
        try {
          gem = await this.grantGem(nickname, source.gemType, source.value, nowMs, {
            allowExistingValue: true,
          }, scope);
        } catch (err) {
          if (err instanceof EconomyActionError) {
            await substitute("gem");
          } else {
            console.warn(
              `[economy] gem loot copy skipped for ${nickname}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }

      if (
        victimHasAmulet &&
        !victim.alreadyGrantedShard &&
        killerDoc.amulets.length < ECONOMY_CAPS.amulets
      ) {
        try {
          await this.addShard(nickname, 1, nowMs, scope);
          shard = true;
        } catch (err) {
          if (err instanceof EconomyActionError) await substitute("shard");
          else throw err;
        }
      }

      if (victimHasAmulet && merged.amulet < DROP_CHANCE.amulet) {
        const equipped = victimDoc.amulets.find((a) => a.equipped);
        const source =
          equipped ?? victimDoc.amulets[Math.floor(Math.random() * victimDoc.amulets.length)];
        if (source) {
          try {
            amulet = await this.grantAmulet(nickname, source.durability, nowMs, scope);
          } catch (err) {
            if (err instanceof EconomyActionError) await substitute("amulet");
            else throw err;
          }
        }
      }
    }

    // Repair kits do not depend on victim inventory — roll for any eligible kill
    // (including sandbox bot victims, EPIC 35).
    if (merged.repairKit < DROP_CHANCE.repairKit) {
      try {
        await this.grantRepairKit(nickname, nowMs, scope);
        repairKit = true;
      } catch (err) {
        if (err instanceof EconomyActionError) await substitute("repairKit");
        else throw err;
      }
    }

    return {
      egg,
      stimulator,
      gem,
      shard,
      amulet,
      repairKit,
      substitutedGold,
      substitutedKinds,
    };
  }

  async applyStimulator(
    nickname: string,
    eggId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyEgg> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    const egg = doc.eggs.find((e) => e.id === eggId);
    if (!egg) {
      await this.assertItemOwnedOrThrow("egg", eggId, doc.nicknameKey, `egg ${eggId} not found`);
      throw new EconomyActionError("not_found", `egg ${eggId} not found`);
    }
    if (isEggReady(egg.hatchDeadlineMs, nowMs)) {
      throw new EconomyActionError("already_ready", "egg is already ready to hatch");
    }
    const stim = doc.stimulators[0];
    if (!stim) {
      throw new EconomyActionError("no_stimulator", "no growth stimulator available");
    }
    const newDeadline = applyStimulatorDeadline(egg.hatchDeadlineMs, nowMs);
    doc.stimulators = doc.stimulators.slice(1);
    egg.hatchDeadlineMs = newDeadline;
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.eggFromDoc(doc, egg);
  }

  async hatchEgg(
    nickname: string,
    eggId: number,
    nowMs: number = Date.now(),
    opts?: { type?: PetType; baseValue?: number },
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyPet> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    const eggIndex = doc.eggs.findIndex((e) => e.id === eggId);
    if (eggIndex < 0) {
      await this.assertItemOwnedOrThrow("egg", eggId, doc.nicknameKey, `egg ${eggId} not found`);
      throw new EconomyActionError("not_found", `egg ${eggId} not found`);
    }
    const egg = doc.eggs[eggIndex]!;
    if (!isEggReady(egg.hatchDeadlineMs, nowMs)) {
      throw new EconomyActionError("not_ready", "egg is still incubating");
    }
    if (doc.pets.length >= ECONOMY_CAPS.pets) {
      throw new EconomyActionError("pet_cap", "pet cap reached");
    }
    const type = opts?.type ?? randomPetType();
    const baseValue = opts?.baseValue ?? randomBaseValue();
    if (!PET_TYPES.includes(type) || baseValue < 1 || baseValue > 200) {
      throw new Error(`invalid hatch pet type/value: ${type}/${baseValue}`);
    }
    // Free egg cell first so the new pet can reuse those cells if needed.
    doc.eggs.splice(eggIndex, 1);
    await this.unbindItemOwner("egg", eggId);
    if (findFit(doc, 2) === null) {
      // Roll back egg removal into memory before rejecting (persist nothing yet).
      doc.eggs.splice(eggIndex, 0, egg);
      await this.bindItemOwner("egg", eggId, doc.nicknameKey);
      throw new EconomyActionError("inventory_full", "no free 2-cell fit for hatched pet");
    }
    const id = doc.nextPetId++;
    const pet = {
      id,
      type,
      baseValue,
      equipSlot: null as 1 | 2 | null,
      createdAt: nowMs,
      slotAnchor: null as number | null,
      colorIndex: randomPaletteIndex(),
    };
    doc.pets.push(pet);
    this.assignBagAnchor(doc, "pet", id);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    await this.bindItemOwner("pet", id, doc.nicknameKey);
    return this.petFromDoc(doc, pet);
  }

  async equipPet(
    nickname: string,
    petId: number,
    slot: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyPet> {
    if (slot !== 1 && slot !== 2) {
      throw new EconomyActionError("invalid_slot", `invalid equip slot ${slot}`);
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (slot === 2 && !this.isSlot2EnabledDoc(live)) {
      throw new EconomyActionError("slot2_disabled", "pet slot 2 requires an equipped amulet");
    }
    if (!live.pets.some((p) => p.id === petId)) {
      await this.assertItemOwnedOrThrow("pet", petId, live.nicknameKey, `pet ${petId} not found`);
      throw new EconomyActionError("not_found", `pet ${petId} not found`);
    }
    const doc = cloneDocument(live);
    const pet = doc.pets.find((p) => p.id === petId)!;
    clearItemAnchor(doc, "pet", petId);
    const displaced = doc.pets.filter((p) => p.id !== petId && p.equipSlot === slot);
    for (const other of displaced) {
      other.equipSlot = null;
      if (findFit(doc, 2) === null) {
        throw new EconomyActionError(
          "inventory_full",
          "no free inventory cells to unequip displaced pet",
        );
      }
      this.assignBagAnchor(doc, "pet", other.id);
    }
    pet.equipSlot = slot;
    pet.slotAnchor = null;
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.petFromDoc(doc, pet);
  }

  async unequipPet(
    nickname: string,
    petId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyPet> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    const livePet = live.pets.find((p) => p.id === petId);
    if (!livePet) {
      await this.assertItemOwnedOrThrow("pet", petId, live.nicknameKey, `pet ${petId} not found`);
      throw new EconomyActionError("not_found", `pet ${petId} not found`);
    }
    if (livePet.equipSlot === null) {
      return this.petFromDoc(live, livePet);
    }
    const doc = cloneDocument(live);
    const pet = doc.pets.find((p) => p.id === petId)!;
    if (findFit(doc, 2) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cells to unequip pet");
    }
    pet.equipSlot = null;
    this.assignBagAnchor(doc, "pet", petId);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.petFromDoc(doc, pet);
  }

  /**
   * EPIC 39: set a owned pet's cosmetic palette index. Validates ownership +
   * index range server-side. Color is part of the pet entity (persists with
   * the Redis economy document for the active scope).
   */
  async setPetColor(
    nickname: string,
    petId: number,
    paletteIndex: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyPet> {
    if (!isValidPaletteIndex(paletteIndex)) {
      throw new EconomyActionError("invalid_slot", `invalid pet color index ${paletteIndex}`);
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (!live.pets.some((p) => p.id === petId)) {
      await this.assertItemOwnedOrThrow("pet", petId, live.nicknameKey, `pet ${petId} not found`);
      throw new EconomyActionError("not_found", `pet ${petId} not found`);
    }
    const doc = cloneDocument(live);
    const pet = doc.pets.find((p) => p.id === petId)!;
    pet.colorIndex = paletteIndex;
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.petFromDoc(doc, pet);
  }

  async socketGem(
    nickname: string,
    gemId: number,
    petId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyGem> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    const gem = doc.gems.find((g) => g.id === gemId);
    if (!gem) {
      await this.assertItemOwnedOrThrow("gem", gemId, doc.nicknameKey, `gem ${gemId} not found`);
      throw new EconomyActionError("not_found", `gem ${gemId} not found`);
    }
    if (gem.petId !== null) {
      throw new EconomyActionError("already_socketed", "gem is already socketed");
    }
    const pet = doc.pets.find((p) => p.id === petId);
    if (!pet) {
      await this.assertItemOwnedOrThrow("pet", petId, doc.nicknameKey, `pet ${petId} not found`);
      throw new EconomyActionError("not_found", `pet ${petId} not found`);
    }
    if (doc.gems.some((g) => g.petId === petId && g.gemType === gem.gemType)) {
      throw new EconomyActionError("type_occupied", `pet already has a ${gem.gemType} gem`);
    }
    gem.petId = petId;
    gem.slotAnchor = null;
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.gemFromDoc(doc, gem);
  }

  async unsocketGem(
    nickname: string,
    gemId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyGem> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    const gem = doc.gems.find((g) => g.id === gemId);
    if (!gem) {
      await this.assertItemOwnedOrThrow("gem", gemId, doc.nicknameKey, `gem ${gemId} not found`);
      throw new EconomyActionError("not_found", `gem ${gemId} not found`);
    }
    if (gem.petId === null) {
      throw new EconomyActionError("not_socketed", "gem is not socketed");
    }
    if (doc.gems.length > ECONOMY_CAPS.gems) {
      throw new EconomyActionError("gem_cap", "gem cap exceeded");
    }
    if (findFit(doc, 1) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cell to unsocket gem");
    }
    gem.petId = null;
    this.assignBagAnchor(doc, "gem", gemId);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.gemFromDoc(doc, gem);
  }

  async equipAmulet(
    nickname: string,
    amuletId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyAmulet> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (!live.amulets.some((a) => a.id === amuletId)) {
      await this.assertItemOwnedOrThrow(
        "amulet",
        amuletId,
        live.nicknameKey,
        `amulet ${amuletId} not found`,
      );
      throw new EconomyActionError("not_found", `amulet ${amuletId} not found`);
    }
    const equippedLive = live.amulets.find((a) => a.id === amuletId)!;
    if (equippedLive.equipped) {
      throw new EconomyActionError("already_equipped", "amulet already equipped");
    }
    const doc = cloneDocument(live);
    const amulet = doc.amulets.find((a) => a.id === amuletId)!;
    clearItemAnchor(doc, "amulet", amuletId);
    const previous = doc.amulets.find((a) => a.equipped);
    if (previous) {
      previous.equipped = false;
      if (findFit(doc, 2) === null) {
        throw new EconomyActionError(
          "inventory_full",
          "no free inventory cells for previously equipped amulet",
        );
      }
      this.assignBagAnchor(doc, "amulet", previous.id);
    }
    amulet.equipped = true;
    amulet.slotAnchor = null;
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.amuletFromDoc(doc, amulet);
  }

  async unequipAmulet(
    nickname: string,
    amuletId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyAmulet> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    const liveAmulet = live.amulets.find((a) => a.id === amuletId);
    if (!liveAmulet) {
      await this.assertItemOwnedOrThrow(
        "amulet",
        amuletId,
        live.nicknameKey,
        `amulet ${amuletId} not found`,
      );
      throw new EconomyActionError("not_found", `amulet ${amuletId} not found`);
    }
    if (!liveAmulet.equipped) {
      throw new EconomyActionError("not_equipped", "amulet is not equipped");
    }
    const doc = cloneDocument(live);
    const amulet = doc.amulets.find((a) => a.id === amuletId)!;
    const slot2Pets = doc.pets.filter((p) => p.equipSlot === 2);
    for (const p of slot2Pets) {
      p.equipSlot = null;
      if (findFit(doc, 2) === null) {
        throw new EconomyActionError(
          "inventory_full",
          "no free inventory cells for slot-2 pet after unequip",
        );
      }
      this.assignBagAnchor(doc, "pet", p.id);
    }
    if (findFit(doc, 2) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cells to unequip amulet");
    }
    amulet.equipped = false;
    this.assignBagAnchor(doc, "amulet", amuletId);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.amuletFromDoc(doc, amulet);
  }

  async craftAmulet(
    nickname: string,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyAmulet> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.amulets.length >= ECONOMY_CAPS.amulets) {
      throw new EconomyActionError("amulet_cap", "amulet cap reached");
    }
    if (doc.shardCount < ECONOMY_CAPS.amuletCraftShards) {
      throw new EconomyActionError("insufficient_shards", "need 10 shards to craft an amulet");
    }
    // Temporarily free the shard stack if craft will empty it, so amulet can use that cell.
    const prevShards = doc.shardCount;
    const prevShardAnchor = doc.shardSlotAnchor;
    doc.shardCount -= ECONOMY_CAPS.amuletCraftShards;
    if (doc.shardCount <= 0) {
      doc.shardCount = 0;
      doc.shardSlotAnchor = null;
    }
    if (findFit(doc, 2) === null) {
      doc.shardCount = prevShards;
      doc.shardSlotAnchor = prevShardAnchor;
      throw new EconomyActionError("inventory_full", "no free inventory cells for crafted amulet");
    }
    const id = doc.nextAmuletId++;
    const amulet = {
      id,
      durability: ECONOMY_CAPS.amuletDurabilityMax,
      equipped: false,
      createdAt: nowMs,
      slotAnchor: null as number | null,
    };
    doc.amulets.push(amulet);
    this.assignBagAnchor(doc, "amulet", id);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    await this.bindItemOwner("amulet", id, doc.nicknameKey);
    return this.amuletFromDoc(doc, amulet);
  }

  async repairAmulet(
    nickname: string,
    amuletId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyAmulet> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    const amulet = doc.amulets.find((a) => a.id === amuletId);
    if (!amulet) {
      await this.assertItemOwnedOrThrow("amulet", amuletId, doc.nicknameKey, `amulet ${amuletId} not found`);
      throw new EconomyActionError("not_found", `amulet ${amuletId} not found`);
    }
    const kit = doc.repairKits[0];
    if (!kit) {
      throw new EconomyActionError("no_repair_kit", "no repair kit available");
    }
    doc.repairKits = doc.repairKits.slice(1);
    amulet.durability = Math.min(ECONOMY_CAPS.amuletDurabilityMax, amulet.durability + 1);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return this.amuletFromDoc(doc, amulet);
  }

  async applyHumanDeathPenalties(
    nickname: string,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<{
    amuletDestroyed: boolean;
    durabilityAfter: number | null;
    petsDecayed: number;
    gemsDecayed: number;
  }> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = cloneDocument((await this.loadDoc(scope, profile.nicknameKey))!);

    let amuletDestroyed = false;
    let durabilityAfter: number | null = null;
    let petsDecayed = 0;
    let gemsDecayed = 0;

    const activePets = doc.pets.filter((p) => p.equipSlot === 1 || p.equipSlot === 2);

    const equipped = doc.amulets.find((a) => a.equipped);
    if (equipped) {
      const next = equipped.durability - 1;
      if (next <= 0) {
        doc.amulets = doc.amulets.filter((a) => a.id !== equipped.id);
        amuletDestroyed = true;
        durabilityAfter = 0;
        await this.unbindItemOwner("amulet", equipped.id);
      } else {
        equipped.durability = next;
        durabilityAfter = next;
      }
    }

    for (const pet of activePets) {
      const nextBase = applyDeathEffectivenessDecay(pet.baseValue);
      if (nextBase !== pet.baseValue) {
        pet.baseValue = nextBase;
        petsDecayed += 1;
      }
      for (const gem of doc.gems.filter((g) => g.petId === pet.id)) {
        const nextVal = applyDeathEffectivenessDecay(gem.value);
        if (nextVal !== gem.value) {
          gem.value = nextVal;
          gemsDecayed += 1;
        }
      }
    }

    if (amuletDestroyed) {
      for (const p of doc.pets) {
        if (p.equipSlot === 2) {
          p.equipSlot = null;
          const anchor = findFit(doc, 2);
          if (anchor !== null) {
            setItemAnchor(doc, "pet", p.id, anchor);
          } else {
            // Extremely full bag: leave without anchor; ensureInventoryPacked will retry.
            p.slotAnchor = null;
            console.warn(
              `[economy] inventory_full placing slot-2 pet#${p.id} after amulet destroy (${doc.nicknameKey})`,
            );
          }
        }
      }
    }

    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return { amuletDestroyed, durabilityAfter, petsDecayed, gemsDecayed };
  }

  async getRatingsForKey(
    nicknameKey: string,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<ProfileRatings> {
    const doc = await this.loadDoc(scope, nicknameKey);
    if (!doc) return emptyRatings();
    return this.computeRatings(doc);
  }

  async grantPetForTests(
    nickname: string,
    type: PetType,
    baseValue: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EconomyPet> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.pets.length >= ECONOMY_CAPS.pets) {
      throw new EconomyActionError("pet_cap", "pet cap reached");
    }
    if (findFit(doc, 2) === null) {
      throw new EconomyActionError("inventory_full", "no free inventory cells for pet");
    }
    const id = doc.nextPetId++;
    const pet = {
      id,
      type,
      baseValue,
      equipSlot: null as 1 | 2 | null,
      createdAt: nowMs,
      slotAnchor: null as number | null,
      colorIndex: randomPaletteIndex(),
    };
    doc.pets.push(pet);
    this.assignBagAnchor(doc, "pet", id);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    await this.bindItemOwner("pet", id, doc.nicknameKey);
    return this.petFromDoc(doc, pet);
  }

  async moveItem(
    nickname: string,
    itemType: InventoryItemType,
    itemId: number,
    toAnchor: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<void> {
    if (!(INVENTORY_ITEM_TYPES as readonly string[]).includes(itemType)) {
      throw new EconomyActionError("invalid_item_type", `invalid item type ${itemType}`);
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    const doc = cloneDocument(live);
    const footprint = footprintForItemType(itemType);
    this.assertBagItem(doc, itemType, itemId);
    if (!isValidAnchor(toAnchor, footprint)) {
      throw new EconomyActionError("bad_anchor", "anchor out of range or invalid footprint");
    }
    if (!canPlaceAt(doc, toAnchor, footprint, { itemType, itemId })) {
      throw new EconomyActionError("overlap", "target cells overlap another item");
    }
    setItemAnchor(doc, itemType, itemId, toAnchor);
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
  }

  async discardItem(
    nickname: string,
    itemType: InventoryItemType,
    itemId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<void> {
    if (!(INVENTORY_ITEM_TYPES as readonly string[]).includes(itemType)) {
      throw new EconomyActionError("invalid_item_type", `invalid item type ${itemType}`);
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    const doc = cloneDocument(live);
    this.assertBagItem(doc, itemType, itemId);

    switch (itemType) {
      case "pet": {
        doc.pets = doc.pets.filter((p) => p.id !== itemId);
        await this.unbindItemOwner("pet", itemId);
        break;
      }
      case "egg": {
        doc.eggs = doc.eggs.filter((e) => e.id !== itemId);
        await this.unbindItemOwner("egg", itemId);
        break;
      }
      case "gem": {
        doc.gems = doc.gems.filter((g) => g.id !== itemId);
        await this.unbindItemOwner("gem", itemId);
        break;
      }
      case "amulet": {
        doc.amulets = doc.amulets.filter((a) => a.id !== itemId);
        await this.unbindItemOwner("amulet", itemId);
        break;
      }
      case "stimulator": {
        doc.stimulators = doc.stimulators.filter((s) => s.id !== itemId);
        break;
      }
      case "repair_kit": {
        doc.repairKits = doc.repairKits.filter((k) => k.id !== itemId);
        break;
      }
      case "shard_stack": {
        doc.shardCount = 0;
        doc.shardSlotAnchor = null;
        break;
      }
    }
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    console.log(
      `[economy] discard ${itemType}#${itemId} by ${doc.nicknameKey}`,
    );
  }

  /**
   * Debit gold from a profile (EPIC 38 auction/trade). Throws insufficient_gold.
   */
  async debitGold(
    nickname: string,
    amount: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new EconomyActionError("invalid_price", `debit amount must be positive int, got ${amount}`);
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    if (doc.gold < amount) {
      throw new EconomyActionError("insufficient_gold", "not enough gold");
    }
    doc.gold -= amount;
    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
  }

  /**
   * Extract a bag item into an escrow payload (removes from bag). Pets take
   * their socketed gems with them. Deathmatch-only callers must pass scope.
   */
  async extractBagItem(
    nickname: string,
    itemType: InventoryItemType,
    itemId: number,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
    shardQuantity?: number,
  ): Promise<EscrowPayload> {
    if (!(INVENTORY_ITEM_TYPES as readonly string[]).includes(itemType)) {
      throw new EconomyActionError("invalid_item_type", `invalid item type ${itemType}`);
    }
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    const doc = cloneDocument(live);
    this.assertBagItem(doc, itemType, itemId);

    let payload: EscrowPayload;
    switch (itemType) {
      case "pet": {
        const pet = doc.pets.find((p) => p.id === itemId)!;
        const gems = doc.gems.filter((g) => g.petId === itemId).map((g) => ({ ...g, petId: null as number | null }));
        doc.pets = doc.pets.filter((p) => p.id !== itemId);
        doc.gems = doc.gems.filter((g) => g.petId !== itemId);
        await this.unbindItemOwner("pet", itemId);
        for (const g of gems) {
          await this.unbindItemOwner("gem", g.id);
        }
        payload = {
          itemType: "pet",
          pet: { ...pet, equipSlot: null, slotAnchor: null },
          gems: gems.map((g) => ({ ...g, petId: null, slotAnchor: null })),
        };
        break;
      }
      case "egg": {
        const egg = doc.eggs.find((e) => e.id === itemId)!;
        doc.eggs = doc.eggs.filter((e) => e.id !== itemId);
        await this.unbindItemOwner("egg", itemId);
        payload = { itemType: "egg", egg: { ...egg, slotAnchor: null } };
        break;
      }
      case "gem": {
        const gem = doc.gems.find((g) => g.id === itemId)!;
        doc.gems = doc.gems.filter((g) => g.id !== itemId);
        await this.unbindItemOwner("gem", itemId);
        payload = { itemType: "gem", gem: { ...gem, petId: null, slotAnchor: null } };
        break;
      }
      case "amulet": {
        const amulet = doc.amulets.find((a) => a.id === itemId)!;
        doc.amulets = doc.amulets.filter((a) => a.id !== itemId);
        await this.unbindItemOwner("amulet", itemId);
        payload = { itemType: "amulet", amulet: { ...amulet, equipped: false, slotAnchor: null } };
        break;
      }
      case "stimulator": {
        const stim = doc.stimulators.find((s) => s.id === itemId)!;
        doc.stimulators = doc.stimulators.filter((s) => s.id !== itemId);
        payload = { itemType: "stimulator", stimulator: { ...stim, slotAnchor: null } };
        break;
      }
      case "repair_kit": {
        const kit = doc.repairKits.find((k) => k.id === itemId)!;
        doc.repairKits = doc.repairKits.filter((k) => k.id !== itemId);
        payload = { itemType: "repair_kit", repairKit: { ...kit, slotAnchor: null } };
        break;
      }
      case "shard_stack": {
        const qty =
          typeof shardQuantity === "number" && Number.isInteger(shardQuantity)
            ? shardQuantity
            : doc.shardCount;
        if (qty <= 0 || qty > doc.shardCount) {
          throw new EconomyActionError("invalid_item_type", `invalid shard quantity ${qty}`);
        }
        doc.shardCount -= qty;
        if (doc.shardCount <= 0) {
          doc.shardCount = 0;
          doc.shardSlotAnchor = null;
        }
        payload = { itemType: "shard_stack", quantity: qty };
        break;
      }
    }

    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return payload;
  }

  /**
   * Preview whether a receiver can accept an escrow payload (caps + footprint).
   * Does not mutate. Throws EconomyActionError with buyer_cap / inventory_full / *_cap.
   */
  async assertCanAcceptEscrow(
    nickname: string,
    payload: EscrowPayload,
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<void> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const doc = (await this.loadDoc(scope, profile.nicknameKey))!;
    this.assertDocCanAcceptEscrow(doc, payload);
  }

  private assertDocCanAcceptEscrow(doc: EconomyDocument, payload: EscrowPayload): void {
    const footprint = footprintForEscrow(payload);
    switch (payload.itemType) {
      case "pet": {
        if (doc.pets.length >= ECONOMY_CAPS.pets) {
          throw new EconomyActionError("pet_cap", "pet cap reached");
        }
        const gemAdd = payload.gems.length;
        if (doc.gems.length + gemAdd > ECONOMY_CAPS.gems) {
          throw new EconomyActionError("gem_cap", "gem cap reached");
        }
        if (findFit(doc, footprint) === null) {
          throw new EconomyActionError("inventory_full", "no free cells for pet");
        }
        break;
      }
      case "egg": {
        if (doc.eggs.length >= ECONOMY_CAPS.eggs) {
          throw new EconomyActionError("egg_cap", "egg cap reached");
        }
        if (findFit(doc, 1) === null) {
          throw new EconomyActionError("inventory_full", "no free cell for egg");
        }
        break;
      }
      case "gem": {
        if (doc.gems.length >= ECONOMY_CAPS.gems) {
          throw new EconomyActionError("gem_cap", "gem cap reached");
        }
        if (findFit(doc, 1) === null) {
          throw new EconomyActionError("inventory_full", "no free cell for gem");
        }
        break;
      }
      case "amulet": {
        if (doc.amulets.length >= ECONOMY_CAPS.amulets) {
          throw new EconomyActionError("amulet_cap", "amulet cap reached");
        }
        if (findFit(doc, 2) === null) {
          throw new EconomyActionError("inventory_full", "no free cells for amulet");
        }
        break;
      }
      case "stimulator": {
        if (doc.stimulators.length >= STIMULATOR_SOFT_CAP) {
          throw new EconomyActionError("stimulator_cap", "stimulator soft-cap reached");
        }
        if (findFit(doc, 1) === null) {
          throw new EconomyActionError("inventory_full", "no free cell for stimulator");
        }
        break;
      }
      case "repair_kit": {
        if (doc.repairKits.length >= REPAIR_KIT_SOFT_CAP) {
          throw new EconomyActionError("repair_kit_cap", "repair kit soft-cap reached");
        }
        if (findFit(doc, 1) === null) {
          throw new EconomyActionError("inventory_full", "no free cell for repair kit");
        }
        break;
      }
      case "shard_stack": {
        if (doc.shardCount + payload.quantity > ECONOMY_CAPS.shards) {
          throw new EconomyActionError("shard_cap", "shard cap reached");
        }
        if (doc.shardCount <= 0 && findFit(doc, 1) === null) {
          throw new EconomyActionError("inventory_full", "no free cell for shard stack");
        }
        break;
      }
    }
  }

  /**
   * Insert an escrow payload into the receiver's bag, reminting IDs and
   * rebinding ownership. Throws if caps/footprint fail.
   * Returns a remint ref so callers can reverse a partial transfer (F-002).
   */
  async insertEscrowItem(
    nickname: string,
    payload: EscrowPayload,
    nowMs: number = Date.now(),
    scope: EconomyScope = DEFAULT_ECONOMY_SCOPE,
  ): Promise<EscrowInsertRef> {
    const profile = await this.getOrCreateProfile(nickname, scope);
    const live = (await this.loadDoc(scope, profile.nicknameKey))!;
    const doc = cloneDocument(live);
    this.assertDocCanAcceptEscrow(doc, payload);

    let remint: EscrowInsertRef;
    switch (payload.itemType) {
      case "pet": {
        const id = doc.nextPetId++;
        const pet = {
          ...payload.pet,
          id,
          equipSlot: null as 1 | 2 | null,
          slotAnchor: null as number | null,
        };
        doc.pets.push(pet);
        this.assignBagAnchor(doc, "pet", id);
        await this.bindItemOwner("pet", id, doc.nicknameKey);
        for (const g of payload.gems) {
          const gemId = doc.nextGemId++;
          const gem: StoredGem = {
            ...g,
            id: gemId,
            petId: id,
            slotAnchor: null,
          };
          doc.gems.push(gem);
          await this.bindItemOwner("gem", gemId, doc.nicknameKey);
        }
        remint = { itemType: "pet", itemId: id };
        break;
      }
      case "egg": {
        const id = doc.nextEggId++;
        doc.eggs.push({ ...payload.egg, id, slotAnchor: null });
        this.assignBagAnchor(doc, "egg", id);
        await this.bindItemOwner("egg", id, doc.nicknameKey);
        remint = { itemType: "egg", itemId: id };
        break;
      }
      case "gem": {
        const id = doc.nextGemId++;
        doc.gems.push({ ...payload.gem, id, petId: null, slotAnchor: null });
        this.assignBagAnchor(doc, "gem", id);
        await this.bindItemOwner("gem", id, doc.nicknameKey);
        remint = { itemType: "gem", itemId: id };
        break;
      }
      case "amulet": {
        const id = doc.nextAmuletId++;
        doc.amulets.push({
          ...payload.amulet,
          id,
          equipped: false,
          slotAnchor: null,
        });
        this.assignBagAnchor(doc, "amulet", id);
        await this.bindItemOwner("amulet", id, doc.nicknameKey);
        remint = { itemType: "amulet", itemId: id };
        break;
      }
      case "stimulator": {
        const id = doc.nextStimId++;
        doc.stimulators.push({ ...payload.stimulator, id, slotAnchor: null });
        this.assignBagAnchor(doc, "stimulator", id);
        remint = { itemType: "stimulator", itemId: id };
        break;
      }
      case "repair_kit": {
        const id = doc.nextRepairKitId++;
        doc.repairKits.push({ ...payload.repairKit, id, slotAnchor: null });
        this.assignBagAnchor(doc, "repair_kit", id);
        remint = { itemType: "repair_kit", itemId: id };
        break;
      }
      case "shard_stack": {
        const had = doc.shardCount > 0;
        doc.shardCount += payload.quantity;
        if (!had) this.assignBagAnchor(doc, "shard_stack", 0);
        remint = { itemType: "shard_stack", quantity: payload.quantity };
        break;
      }
    }

    doc.updatedAt = nowMs;
    await this.saveDoc(scope, doc);
    return remint;
  }

  /** Ensure the item exists in the bag (not equipped / socketed). */
  private assertBagItem(
    doc: EconomyDocument,
    itemType: InventoryItemType,
    itemId: number,
  ): void {
    switch (itemType) {
      case "pet": {
        const pet = doc.pets.find((p) => p.id === itemId);
        if (!pet) throw new EconomyActionError("not_found", `pet ${itemId} not found`);
        if (pet.equipSlot === 1 || pet.equipSlot === 2) {
          throw new EconomyActionError("not_in_bag", "equipped pets cannot be moved/discarded");
        }
        return;
      }
      case "egg": {
        if (!doc.eggs.some((e) => e.id === itemId)) {
          throw new EconomyActionError("not_found", `egg ${itemId} not found`);
        }
        return;
      }
      case "gem": {
        const gem = doc.gems.find((g) => g.id === itemId);
        if (!gem) throw new EconomyActionError("not_found", `gem ${itemId} not found`);
        if (gem.petId !== null) {
          throw new EconomyActionError("not_in_bag", "socketed gems cannot be moved/discarded");
        }
        return;
      }
      case "amulet": {
        const amulet = doc.amulets.find((a) => a.id === itemId);
        if (!amulet) throw new EconomyActionError("not_found", `amulet ${itemId} not found`);
        if (amulet.equipped) {
          throw new EconomyActionError("not_in_bag", "equipped amulets cannot be moved/discarded");
        }
        return;
      }
      case "stimulator": {
        if (!doc.stimulators.some((s) => s.id === itemId)) {
          throw new EconomyActionError("not_found", `stimulator ${itemId} not found`);
        }
        return;
      }
      case "repair_kit": {
        if (!doc.repairKits.some((k) => k.id === itemId)) {
          throw new EconomyActionError("not_found", `repair kit ${itemId} not found`);
        }
        return;
      }
      case "shard_stack": {
        if (doc.shardCount <= 0) {
          throw new EconomyActionError("not_found", "shard stack is empty");
        }
        return;
      }
    }
  }
}

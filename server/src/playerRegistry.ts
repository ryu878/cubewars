// Authoritative player registry + movement simulation.
// Deliberately transport-agnostic: no `ws` types here, only game/simulation
// state (per global-standards.mdc: keep game logic separate from transport).

import {
  BUNNY_HOP,
  COMBAT,
  DAMAGE_ZONE_MULTIPLIERS,
  GRENADE_SPLASH,
  MAX_PITCH,
  MOVEMENT,
  ARENA_GEOMETRY,
  SPAWN_POINTS,
  WEAPON_ORDER,
  WEAPON_STATS,
  applyArmorDr,
  damageMultiplierFromRatings,
  emptyRatings,
  maxHealthBonusFromRatings,
  speedMultiplierFromRatings,
  boxesBlockingAt,
  crateTopHeightAt,
  resolveHorizontalCollisions,
  resolveSteppedMovement,
  type PickupCategory,
  type DamageKind,
  type DamageZone,
  type MapBox,
  type PlayerScore,
  type PlayerState,
  type ProfileRatings,
  type ShotTrace,
  type Vector3,
  type WeaponType,
} from "@cubewars/shared";
import { buildShotTrace, findGrenadeSplashCandidates, performHitscan } from "./combat.js";

/** Sanity bound so a malformed/runaway input can never send a player to infinity — a coarse outer clamp, independent of (and checked before) the precise wall/crate collision resolution below. */
const WORLD_BOUND = 200;

/** Clamp a value into [-1, 1] — defends against an out-of-range or malicious moveForward/moveRight. */
function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

/** Wrap an arbitrary finite angle into (-PI, PI]. Non-finite input is treated as "no turn". */
function normalizeYaw(yaw: number, fallback: number): number {
  if (!Number.isFinite(yaw)) return fallback;
  const twoPi = Math.PI * 2;
  let wrapped = yaw % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

/** Clamp pitch to the same [-MAX_PITCH, MAX_PITCH] range the client's own mouse-look enforces (shared/src/combat.ts) — defends against a client claiming an aim angle its own controls could never produce. */
function clampPitch(pitch: number, fallback: number): number {
  if (!Number.isFinite(pitch)) return fallback;
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}

export interface PlayerRecord {
  id: string;
  nickname: string;
  nicknameKey: string;
  position: Vector3;
  velocityY: number;
  grounded: boolean;
  /**
   * EPIC 8 Story 8.2 "bunny hop": true whenever this player is eligible to
   * trigger a bunny-hop boost, i.e. has not already used one during the
   * current air-time. Reset to true only on landing (see stepPlayer()'s
   * ground-clamp branch) and set false the moment a boost is actually
   * applied — this is the server-side gate that makes "one boost per
   * air-time" enforceable no matter how many jump inputs a raw WS client
   * sends while airborne (security-baseline.mdc: never trust client input
   * as authoritative for gameplay-relevant state).
   */
  bunnyHopAvailable: boolean;
  /**
   * One-shot latch (EPIC 8 Story 8.2): set true by applyInput() when it
   * observes a genuine false->true edge on the incoming `jump` field (a
   * fresh Space key-down, never a held key or a level read in isolation —
   * see applyInput() below), always consumed (read and cleared) by the very
   * next stepPlayer() tick regardless of outcome, so it can never persist
   * across multiple physics ticks or accumulate into more than one trigger.
   */
  pendingBunnyHopTrigger: boolean;
  /**
   * Horizontal move-speed multiplier for stepPlayer()'s dx/dz computation
   * (EPIC 8 Story 8.2) — 1 normally, BUNNY_HOP.speedMultiplier for the rest
   * of the current air-time once a boost triggers, reset to 1 on landing.
   * See BUNNY_HOP doc comment (shared/src/index.ts) for why this is a
   * temporary speed multiplier rather than a persisted velocity impulse.
   */
  airSpeedMultiplier: number;
  yaw: number;
  /** Look pitch, radians, clamped to [-MAX_PITCH, MAX_PITCH]. Tracked continuously from input messages (see clampPitch) so the hitscan raycast always fires along the player's actual current aim. */
  pitch: number;
  /**
   * Current health, [0, maxHealth]. Baseline max is COMBAT.maxHealth; EPIC 24
   * pet health rating raises maxHealth for this life.
   */
  health: number;
  /**
   * Effective max HP for this life (EPIC 24). Equals COMBAT.maxHealth plus
   * the equipped pet health bonus. Respawns refill to this value.
   */
  maxHealth: number;
  /**
   * Current armor, [0, COMBAT.maxArmor] (EPIC 7 "Health & Armor Pickups").
   * Absorbs damage before health on a confirmed hit (see fire() below).
   * Reset to 0 on every respawn (see applyBaselineLoadout()) and on a
   * brand-new connection (spawn()) — armor does not persist across death
   * (EPIC 7 spec Section 2), matching the pistol-only weapon reset EPIC 6
   * already established.
   */
  armor: number;
  /**
   * Equipped pet profile ratings (EPIC 24). Server-only; recalculated on
   * equip/unequip/hatch via applyPetRatings(). Default empty (no pets).
   */
  petRatings: ProfileRatings;
  /** False while dead and waiting to respawn. */
  alive: boolean;
  /** Server timestamp (Date.now()-based) at which a dead player should respawn; null while alive. */
  respawnAtMs: number | null;
  /** Confirmed kill count (EPIC 5 Story 5.2), in-memory only — resets on server restart, no persistence in this scope. Incremented exclusively in fire() below, the same place death is resolved, so this can never drift from what actually killed a player. */
  kills: number;
  /**
   * Weapon ownership + ammo (EPIC 6 "Weapons & Ammo"). Reset to the
   * pistol-only baseline on every respawn (see applyBaselineLoadout()) —
   * picked-up weapons/ammo are lost on death, matching arena-FFA convention
   * (Quake/UT-style pickups) and the EPIC's "ammo scarcity has real stakes"
   * intent (Critic non-blocking recommendation, folded in before merge).
   * Also reset on a brand-new connection (spawn()) and, trivially, on
   * disconnect (the whole PlayerRecord is discarded, see remove()).
   */
  ownedWeapons: Set<WeaponType>;
  /** Currently equipped weapon; always a member of ownedWeapons. */
  equippedWeapon: WeaponType;
  /** Remaining ammo per non-pistol weapon owned so far. Absent key == 0 (never picked up). Pistol is never tracked here (WEAPON_STATS.pistol.infiniteAmmo). */
  ammo: Partial<Record<WeaponType, number>>;
  /** Latest validated input intent — physics integrates from this every tick, not from raw message timing. */
  intent: {
    moveForward: number;
    moveRight: number;
    jump: boolean;
  };
}

/** Result of PlayerRegistry.applyPickup() — whether the pickup-consumption rule (EPIC 6 spec) says this pickup actually benefited the player. */
export interface ApplyPickupResult {
  applied: boolean;
  /**
   * Set (to the weapon just picked up) if this pickup also auto-equipped it
   * (EPIC 13 Story 13.2: any applied pickup — first-time unlock OR ammo
   * refill of an already-owned weapon — of a strictly-higher-tier,
   * now-non-empty weapon than what's currently equipped) — observability
   * only, for the caller (server/src/match.ts tick()) to log a material
   * game-state transition. Absent when no auto-equip happened.
   */
  autoSwitchedTo?: WeaponType;
}

/** This player's current weapon/ammo state, for building a LoadoutMessage (shared/src/index.ts) — sent only to the owning player's own socket, never broadcast (server/src/index.ts sendLoadout()). */
export interface LoadoutSnapshot {
  equippedWeapon: WeaponType;
  ammo: number | null;
  ownedWeapons: WeaponType[];
}

export interface DamageEvent {
  targetId: string;
  damage: number;
  damageKind: DamageKind;
  hitZone: DamageZone;
  targetHealth: number;
  targetArmor: number;
  point: Vector3;
  killed: boolean;
  respawnAtMs: number | null;
}

export type FireOutcome =
  | {
      hit: false;
      /** True if the miss was because the equipped weapon had 0 ammo (EPIC 6 "dry weapon" rule) — the caller logs this distinctly from a normal aim-miss. */
      dry: boolean;
      /**
       * Set (to the newly-equipped weapon) if this fire attempt caused an
       * empty-ammo auto-switch (EPIC 13 Story 13.1) — observability only,
       * for the caller (server/src/match.ts resolveFire()) to log a
       * material game-state transition. Absent when no auto-switch
       * happened.
       */
      autoSwitchedTo?: WeaponType;
      /**
       * The weapon that was actually fired (EPIC 14 "Sound System" Story
       * 14.4), captured from the pre-auto-switch local `weapon` below —
       * present on every branch that represents a REAL fire attempt.
       * Deliberately ABSENT on the very first early bail (`!shooter ||
       * !shooter.alive`) below, since no real trigger pull happened
       * server-side in that case — the caller (match.ts resolveFire())
       * uses "is `weapon` present" as its own gate for whether to
       * broadcast a FireBroadcastEvent at all.
       */
      weapon?: WeaponType;
      damageEvents?: DamageEvent[];
      shotTrace?: ShotTrace;
      projectileSpawn?: {
        weapon: Extract<WeaponType, "grenade_launcher">;
        trace: ShotTrace;
      };
    }
  | {
      hit: true;
      targetId: string;
      damage: number;
      targetHealth: number;
      /** Target's remaining armor after this hit's absorption math (EPIC 7 Section 2) — not part of the broadcast HitEvent (world_state's PlayerState.armor is the continuous source of truth for clients), only surfaced here for the caller's server-log line so Tester/ops can see the armor-absorbs-first math play out per hit. */
      targetArmor: number;
      point: Vector3;
      killed: boolean;
      respawnAtMs: number | null;
      /** See the `hit: false` variant's doc comment above — same meaning: this shot's own ammo decrement emptied the weapon and triggered an auto-switch, independent of whether the shot itself landed. */
      autoSwitchedTo?: WeaponType;
      /** The weapon that was actually fired — see the `hit: false` variant's doc comment above. Always present here (a landed hit is by definition a real fire attempt). */
      weapon?: WeaponType;
      damageKind: DamageKind;
      hitZone: DamageZone;
      damageEvents: DamageEvent[];
      shotTrace?: ShotTrace;
    };

export interface RespawnOutcome {
  playerId: string;
  position: Vector3;
  health: number;
}

/**
 * Apply the pistol-only baseline loadout (plus zeroed armor, EPIC 7) to
 * `player`, in place. Used by both spawn() (a brand-new connection) and
 * processRespawns() (EPIC 6 Critic review non-blocking recommendation,
 * folded in before merge: weapon/ammo ownership resets on death rather than
 * persisting indefinitely, matching arena-FFA convention and the "ammo
 * scarcity has real stakes" intent the EPIC is building toward) — one
 * baseline definition, not a literal duplicated in two places. EPIC 7
 * extends this same reset (rather than adding a second respawn-reset path,
 * per the EPIC 7 spec's explicit instruction) to also zero armor: "armor
 * does not persist across death ... it must be re-earned each life."
 */
function applyBaselineLoadout(
  player: Pick<PlayerRecord, "ownedWeapons" | "equippedWeapon" | "ammo" | "armor">,
): void {
  player.ownedWeapons = new Set<WeaponType>(["pistol"]);
  player.equippedWeapon = "pistol";
  player.ammo = {};
  player.armor = 0;
}

/**
 * Anti-clustering threshold (EPIC 5 Story 5.3), in world units: a spawn
 * point with an alive player closer than this is treated as "occupied" and
 * excluded when a safer alternative exists. SPAWN_POINTS (shared/src/mapData.ts)
 * are laid out with ~16 units between the nearest points within one site and
 * ~68 units between the two sites, so this only ever excludes the
 * literal nearest neighbor(s) of an occupied point, not an entire site.
 */
const MIN_SPAWN_SEPARATION = 12;

export interface PlayerRegistryOptions {
  getGeometry?: () => readonly MapBox[];
  getSpawnPoints?: () => readonly Vector3[];
  worldBound?: number;
}

function computeDirectDamage(baseDamage: number, hitZone: Exclude<DamageZone, "splash">): number {
  return Math.max(1, Math.round(baseDamage * DAMAGE_ZONE_MULTIPLIERS[hitZone]));
}

function computeGrenadeSplashDamage(baseDamage: number, distance: number): number {
  if (distance > GRENADE_SPLASH.radius) return 0;
  const falloff = 1 - distance / GRENADE_SPLASH.radius;
  return Math.max(1, Math.min(baseDamage, Math.round(baseDamage * GRENADE_SPLASH.maxDamageFraction * falloff)));
}

/** Scale weapon base damage by the shooter's pet damage rating (EPIC 24). */
function scaleWeaponDamage(baseDamage: number, shooter: PlayerRecord): number {
  const mult = damageMultiplierFromRatings(shooter.petRatings.damageRating);
  return Math.max(1, Math.round(baseDamage * mult));
}

export class PlayerRegistry {
  private players = new Map<string, PlayerRecord>();

  constructor(private options: PlayerRegistryOptions = {}) {}

  private geometry(): readonly MapBox[] {
    return this.options.getGeometry?.() ?? ARENA_GEOMETRY;
  }

  private spawnPoints(): readonly Vector3[] {
    const points = this.options.getSpawnPoints?.() ?? SPAWN_POINTS;
    return points.length > 0 ? points : SPAWN_POINTS;
  }

  /**
   * Anti-clustering heuristic (EPIC 5 Story 5.3): rank every candidate in
   * SPAWN_POINTS by its distance to the NEAREST currently-alive player, then
   * pick randomly among whichever candidates clear MIN_SPAWN_SEPARATION
   * (adds variety instead of always the single farthest point). If the
   * arena is crowded enough that no candidate clears the margin, fall back
   * to the single point with the largest such distance ("farthest from
   * other players") rather than picking blindly at random — this is the
   * "prefer the spawn point farthest from other players" fallback the Story
   * 5.3 AC explicitly allows. With zero alive players (first connection),
   * every point is equally fine and this reduces to a plain random pick,
   * same as before this EPIC.
   */
  private chooseSpawnPoint(): Vector3 {
    const others: Vector3[] = [];
    for (const player of this.players.values()) {
      if (player.alive) others.push(player.position);
    }

    if (others.length === 0) {
      const points = this.spawnPoints();
      return points[Math.floor(Math.random() * points.length)];
    }

    const ranked = this.spawnPoints().map((point) => {
      let nearestDistance = Infinity;
      for (const other of others) {
        const distance = Math.hypot(point.x - other.x, point.z - other.z);
        if (distance < nearestDistance) nearestDistance = distance;
      }
      return { point, nearestDistance };
    });

    const clear = ranked.filter((candidate) => candidate.nearestDistance >= MIN_SPAWN_SEPARATION);
    if (clear.length > 0) {
      return clear[Math.floor(Math.random() * clear.length)].point;
    }

    let farthest = ranked[0];
    for (const candidate of ranked) {
      if (candidate.nearestDistance > farthest.nearestDistance) farthest = candidate;
    }
    return farthest.point;
  }

  /**
   * Pick a spawn point via the anti-clustering heuristic above, then jitter
   * a little (so repeat spawns at the same point don't land pixel-identical)
   * and re-resolve against the same collision geometry used every
   * simulation tick — a defensive guarantee that a spawn can never land
   * inside a wall/crate even if a future edit moves SPAWN_POINTS closer to
   * geometry than intended. Shared by both initial spawn() and respawn
   * (processRespawns()) so there is exactly one spawn-picking implementation.
   */
  private pickSpawnPosition(): Vector3 {
    const base = this.chooseSpawnPoint();
    const jitterRadius = 2;
    const angle = Math.random() * Math.PI * 2;
    const jitterX = Math.cos(angle) * jitterRadius * Math.random();
    const jitterZ = Math.sin(angle) * jitterRadius * Math.random();
    const resolved = resolveHorizontalCollisions(base.x + jitterX, base.z + jitterZ, undefined, this.geometry());
    return { x: resolved.x, y: MOVEMENT.groundY, z: resolved.z };
  }

  spawn(id: string, nickname: string = id, nicknameKey: string = nickname.toLocaleLowerCase()): PlayerRecord {
    return this.spawnAt(id, this.pickSpawnPosition(), nickname, nicknameKey);
  }

  spawnAt(
    id: string,
    position: Vector3,
    nickname: string = id,
    nicknameKey: string = nickname.toLocaleLowerCase(),
  ): PlayerRecord {
    const record: PlayerRecord = {
      id,
      nickname,
      nicknameKey,
      position: { ...position },
      velocityY: 0,
      grounded: true,
      bunnyHopAvailable: true,
      pendingBunnyHopTrigger: false,
      airSpeedMultiplier: 1,
      yaw: 0,
      pitch: 0,
      health: COMBAT.maxHealth,
      maxHealth: COMBAT.maxHealth,
      armor: 0,
      petRatings: emptyRatings(),
      alive: true,
      respawnAtMs: null,
      kills: 0,
      // Placeholder values, immediately overwritten below by
      // applyBaselineLoadout() — the same pistol-only baseline (plus zeroed
      // armor, EPIC 7) reapplied on every respawn (processRespawns()), so
      // there is exactly one definition of "the starting loadout" instead of
      // a duplicated literal.
      ownedWeapons: new Set<WeaponType>(),
      equippedWeapon: "pistol",
      ammo: {},
      intent: { moveForward: 0, moveRight: 0, jump: false },
    };
    applyBaselineLoadout(record);
    this.players.set(id, record);
    return record;
  }

  /**
   * Apply equipped pet ratings to a living (or just-spawned) player (EPIC 24).
   * Max-HP increase heals only the delta when currently at the old max; if
   * damaged, current HP is kept unless it exceeds the new max (then clamped).
   * DR / speed / damage multipliers take effect immediately on subsequent
   * combat/movement ticks.
   */
  applyPetRatings(playerId: string, ratings: ProfileRatings): void {
    const player = this.players.get(playerId);
    if (!player) return;
    const oldMax = player.maxHealth;
    const newMax = COMBAT.maxHealth + maxHealthBonusFromRatings(ratings.healthRating);
    player.petRatings = { ...ratings };
    player.maxHealth = newMax;
    if (player.alive) {
      if (player.health >= oldMax) {
        player.health = newMax;
      } else if (player.health > newMax) {
        player.health = newMax;
      }
    }
  }

  remove(id: string): void {
    this.players.delete(id);
  }

  has(id: string): boolean {
    return this.players.has(id);
  }

  isAlive(id: string): boolean {
    return this.players.get(id)?.alive ?? false;
  }

  /**
   * Direct read access to a player's full authoritative record (EPIC 9 bot
   * AI — server/src/botAI.ts needs to read a bot's own position/yaw/alive
   * state every tick to decide its next input intent, the same way it would
   * read `PlayerState` fields if it were a client). Server-internal only,
   * never serialized back to any client. Callers must still go through
   * applyInput()/fire()/etc. for any state MUTATION — this getter exists for
   * reads only, by convention (not enforced by the type system, since this
   * stays entirely within the trusted server process).
   */
  getPlayer(id: string): PlayerRecord | undefined {
    return this.players.get(id);
  }

  hasNicknameKey(nicknameKey: string): boolean {
    for (const player of this.players.values()) {
      if (player.nicknameKey === nicknameKey) return true;
    }
    return false;
  }

  getNickname(id: string): string {
    return this.players.get(id)?.nickname ?? id;
  }

  size(): number {
    return this.players.size;
  }

  /**
   * Validate and apply a raw input payload's intent for a player. Returns
   * false (and applies nothing) if the payload is malformed — caller should
   * log this as an anomaly per security-baseline.mdc rather than trust it.
   */
  applyInput(
    id: string,
    raw: { moveForward: unknown; moveRight: unknown; yaw: unknown; pitch: unknown; jump: unknown },
  ): boolean {
    const player = this.players.get(id);
    if (!player) return false;

    if (
      typeof raw.moveForward !== "number" ||
      typeof raw.moveRight !== "number" ||
      typeof raw.yaw !== "number" ||
      typeof raw.pitch !== "number" ||
      typeof raw.jump !== "boolean" ||
      !Number.isFinite(raw.moveForward) ||
      !Number.isFinite(raw.moveRight) ||
      !Number.isFinite(raw.yaw) ||
      !Number.isFinite(raw.pitch)
    ) {
      return false;
    }

    // EPIC 8 Story 8.2: detect a genuine false->true edge on the jump field
    // BEFORE overwriting the stored level below — this is what turns "jump
    // is currently held" (a level, per the PlayerInputMessage doc comment)
    // into "the player just pressed Space" (an edge), server-side and from
    // the server's own previously-stored state, never trusted as an
    // asserted claim from the client. Latched (not overwritten to false)
    // so it survives until the next physics tick consumes it even if
    // several input messages arrive between ticks (the client sends at
    // ~30Hz, the physics tick runs at 20Hz).
    if (raw.jump && !player.intent.jump) {
      player.pendingBunnyHopTrigger = true;
    }

    player.intent.moveForward = clampUnit(raw.moveForward);
    player.intent.moveRight = clampUnit(raw.moveRight);
    player.intent.jump = raw.jump;
    player.yaw = normalizeYaw(raw.yaw, player.yaw);
    player.pitch = clampPitch(raw.pitch, player.pitch);
    return true;
  }

  /**
   * Resolve a fire event for `shooterId` using the server's own
   * authoritative hitscan (server/src/combat.ts) and the shooter's own
   * SERVER-TRACKED equipped weapon (never client-supplied — see
   * shared/src/index.ts FireEvent doc comment; EPIC 6 keeps that discipline:
   * there is still no client-side weapon/damage field anywhere in
   * FireEvent). Returns `{ hit: false, dry }` if the shooter doesn't exist,
   * is dead, the equipped weapon is out of ammo (`dry: true` — EPIC 6 "dry
   * weapon" rule: no damage, ammo not further decremented, doesn't even
   * attempt a hitscan), or the ray didn't connect with another player (miss
   * or blocked by geometry, `dry: false`). The caller (index.ts) only
   * broadcasts a HitEvent/DeathEvent when `hit` is true, so a client can
   * never make itself or anyone else take damage by merely claiming a hit
   * (security-baseline.mdc).
   *
   * Ammo is decremented here for every ACCEPTED shot (whether it goes on to
   * hit or miss) for any non-pistol weapon — matches real trigger-pull
   * semantics and the EPIC 6 Story 6.3 AC ("decrements ammo by 1 per
   * confirmed accepted shot"), not only on a landed hit.
   */
  fire(shooterId: string): FireOutcome {
    const shooter = this.players.get(shooterId);
    if (!shooter || !shooter.alive) return { hit: false, dry: false };

    // `weapon`/`stats` are captured here, before any possible auto-switch
    // below, and this shot's own damage/hit outcome is resolved exclusively
    // from these locals — EPIC 13 Story 13.1: auto-switching
    // shooter.equippedWeapon later in this same call can never retroactively
    // change what this shot itself did.
    const weapon = shooter.equippedWeapon;
    const stats = WEAPON_STATS[weapon];
    let autoSwitchedTo: WeaponType | undefined;
    if (!stats.infiniteAmmo) {
      const currentAmmo = shooter.ammo[weapon] ?? 0;
      if (currentAmmo <= 0) {
        // Defensive branch (EPIC 13 Story 13.1): should be effectively
        // unreachable in normal play once the post-decrement auto-switch
        // below redirects away from a weapon the instant it empties — a
        // weapon can only become "equipped and already empty" via a firing
        // sequence that branch already redirects away from. Kept as a
        // no-op-safe safety net rather than special-cased around, per the
        // EPIC 13 spec.
        autoSwitchedTo = this.autoSwitchDown(shooter);
        return { hit: false, dry: true, autoSwitchedTo, weapon };
      }
      shooter.ammo[weapon] = currentAmmo - 1;
      if (shooter.ammo[weapon] === 0) {
        // EPIC 13 Story 13.1: this shot itself still fires and deals damage
        // (resolved below from the `weapon`/`stats` locals captured above)
        // — this only decides what's equipped for the player's NEXT action.
        autoSwitchedTo = this.autoSwitchDown(shooter);
      }
    }

    if (weapon === "grenade_launcher") {
      const trace = buildShotTrace(shooter, weapon);
      return {
        hit: false,
        dry: false,
        autoSwitchedTo,
        weapon,
        shotTrace: trace,
        projectileSpawn: { weapon: "grenade_launcher", trace },
      };
    }

    const result = performHitscan(shooter, this.players.values(), this.geometry());
    if (!result.hitPlayerId || !result.point) {
      return { hit: false, dry: false, autoSwitchedTo, weapon, damageEvents: [], shotTrace: result.trace };
    }

    const target = this.players.get(result.hitPlayerId);
    if (!target || !target.alive) return { hit: false, dry: false, autoSwitchedTo, weapon }; // defensive: target could not exist / already dead

    const hitZone = result.hitZone ?? "body";
    const scaledBase = scaleWeaponDamage(stats.damage, shooter);
    const damage = computeDirectDamage(scaledBase, hitZone);
    const damageEvent = this.applyDamage(shooter, target, damage, "direct", hitZone, result.point);

    return {
      hit: true,
      targetId: target.id,
      damage: damageEvent.damage,
      damageKind: damageEvent.damageKind,
      hitZone: damageEvent.hitZone,
      targetHealth: damageEvent.targetHealth,
      targetArmor: damageEvent.targetArmor,
      point: result.point,
      killed: damageEvent.killed,
      respawnAtMs: damageEvent.respawnAtMs,
      autoSwitchedTo,
      weapon,
      damageEvents: [damageEvent],
      shotTrace: result.trace,
    };
  }

  applyGrenadeProjectileDirect(
    shooterId: string,
    targetId: string,
    hitZone: Exclude<DamageZone, "splash">,
    point: Vector3,
  ): DamageEvent[] {
    const shooter = this.players.get(shooterId);
    const target = this.players.get(targetId);
    if (!shooter || !shooter.alive || !target || !target.alive) return [];
    const damage = computeDirectDamage(
      scaleWeaponDamage(WEAPON_STATS.grenade_launcher.damage, shooter),
      hitZone,
    );
    return [this.applyDamage(shooter, target, damage, "direct", hitZone, point)];
  }

  applyGrenadeSplashImpact(shooterId: string, explosionPoint: Vector3): DamageEvent[] {
    return this.applyGrenadeSplash(shooterId, WEAPON_STATS.grenade_launcher.damage, explosionPoint);
  }

  private applyGrenadeSplash(shooterId: string, baseDamage: number, explosionPoint: Vector3): DamageEvent[] {
    const shooter = this.players.get(shooterId);
    if (!shooter || !shooter.alive) return [];

    const scaledBase = scaleWeaponDamage(baseDamage, shooter);
    const events: DamageEvent[] = [];
    const candidates = findGrenadeSplashCandidates(explosionPoint, shooterId, this.players.values());
    for (const candidate of candidates) {
      const target = this.players.get(candidate.targetId);
      if (!target || !target.alive) continue;
      const damage = computeGrenadeSplashDamage(scaledBase, candidate.distance);
      if (damage <= 0) continue;
      events.push(this.applyDamage(shooter, target, damage, "splash", "splash", explosionPoint));
    }
    return events;
  }

  private applyDamage(
    shooter: PlayerRecord,
    target: PlayerRecord,
    damage: number,
    damageKind: DamageKind,
    hitZone: DamageZone,
    point: Vector3,
    countKill: boolean = true,
  ): DamageEvent {
    // EPIC 24: pet %DR applies to raw damage BEFORE EPIC 7 absorptive armor.
    const afterDr = applyArmorDr(damage, target.petRatings.armorRating);
    // EPIC 7 damage-absorption order remains unchanged under EPIC 18:
    // armor absorbs first, then exact spillover comes off health. Only the
    // incoming `damage` value now varies by hit zone or grenade splash.
    if (target.armor >= afterDr) {
      target.armor -= afterDr;
    } else {
      const spillover = afterDr - target.armor;
      target.armor = 0;
      target.health = Math.max(0, target.health - spillover);
    }

    let killed = false;
    if (target.health <= 0 && target.alive) {
      target.alive = false;
      target.respawnAtMs = Date.now() + COMBAT.respawnDelayMs;
      killed = true;
      if (countKill) shooter.kills += 1;
    }

    return {
      targetId: target.id,
      damage: afterDr,
      damageKind,
      hitZone,
      targetHealth: target.health,
      targetArmor: target.armor,
      point: { ...point },
      killed,
      respawnAtMs: target.respawnAtMs,
    };
  }

  applyEnvironmentalDamage(targetId: string, damage: number, point: Vector3): DamageEvent | null {
    const target = this.players.get(targetId);
    if (!target || !target.alive) return null;
    return this.applyDamage(target, target, damage, "splash", "splash", point, false);
  }

  /**
   * Auto-switch away from a weapon that has just run dry, to the best owned
   * weapon that currently has ammo (or is infinite) — EPIC 13 Story 13.1.
   * Searches WEAPON_ORDER descending in tier from directly below the current
   * weapon's tier down to the pistol (tier 0, infinite ammo, always owned —
   * the guaranteed floor, see EPIC 13 spec Section 2). `WEAPON_ORDER` is
   * ascending by tier, so walking it back-to-front naturally visits
   * candidates in descending-tier order; the first owned, non-empty (or
   * infinite-ammo) candidate found is the "next weapon by damage/tier" the
   * user asked for — never a jump straight to the pistol when a usable
   * mid-tier weapon exists. Mutates `player.equippedWeapon` in place when a
   * switch happens. Returns the weapon actually switched to, or `undefined`
   * if nothing changed (e.g. called on a player already on the pistol, tier
   * 0, with nothing below it to search).
   */
  private autoSwitchDown(player: PlayerRecord): WeaponType | undefined {
    const currentTier = WEAPON_STATS[player.equippedWeapon].tier;
    for (let i = WEAPON_ORDER.length - 1; i >= 0; i--) {
      const candidate = WEAPON_ORDER[i];
      const candidateStats = WEAPON_STATS[candidate];
      if (candidateStats.tier >= currentTier) continue;
      if (!player.ownedWeapons.has(candidate)) continue;
      const hasAmmo = candidateStats.infiniteAmmo || (player.ammo[candidate] ?? 0) > 0;
      if (!hasAmmo) continue;
      player.equippedWeapon = candidate;
      return candidate;
    }
    return undefined;
  }

  /** The equipped weapon's fire cooldown for `id` (EPIC 6), used by index.ts's per-connection fire-rate gate in place of the old fixed COMBAT.fireCooldownMs. Falls back to the pistol's cooldown if the player is unknown (caller should already have checked existence/aliveness before relying on this). */
  getFireCooldownMs(id: string): number {
    const player = this.players.get(id);
    const weapon = player?.equippedWeapon ?? "pistol";
    return WEAPON_STATS[weapon].cooldownMs;
  }

  /**
   * Apply a pickup's effect to player `id`, dispatched by `category`
   * (EPIC 6 "weapon"/"ammo", EPIC 7 "health"/"armor" — same entry point for
   * all four so index.ts's tick loop stays a single call site, per the EPIC
   * 7 spec's "reuse this EPIC's generic pickup-spawn infrastructure" ask).
   * Every branch follows the same EPIC 6 §2 "consume only if useful"
   * pickup-consumption rule: returns `applied: false` (and changes nothing)
   * if the pickup would have no effect, so the caller (index.ts) must NOT
   * consume the world pickup in that case — it stays for someone who can
   * use it.
   *
   * - "weapon"/"ammo": unlock `weapon` if not already owned, then add its
   *   ammoPerPickup to current ammo capped at maxAmmo (one mechanic for
   *   both categories — see shared/src/pickups.ts PickupSpawnPoint doc
   *   comment). Auto-equips on ANY applied pickup — first-time unlock OR an
   *   ammo refill of an already-owned weapon (EPIC 13 Story 13.2,
   *   generalizing the original EPIC 6 "first-time-unlock only" rule) —
   *   whose tier is higher than the currently-equipped weapon's tier AND
   *   which now has ammo > 0 (or is infinite) ("always have the best", EPIC
   *   6 spec; closes the "ran dry, auto-switched to pistol, found ammo
   *   again" gap EPIC 13 Story 13.1 would otherwise leave open).
   * - "health" (EPIC 7 §2): heal COMBAT.healthPickupAmount, capped at
   *   COMBAT.maxHealth; no-op (not applied) if already at max health.
   * - "armor" (EPIC 7 §2): add COMBAT.armorPickupAmount, capped at
   *   COMBAT.maxArmor; no-op (not applied) if already at max armor.
   */
  applyPickup(id: string, category: PickupCategory, weapon?: WeaponType): ApplyPickupResult {
    const player = this.players.get(id);
    if (!player) return { applied: false };

    if (category === "health") {
      if (player.health >= player.maxHealth) return { applied: false };
      player.health = Math.min(player.maxHealth, player.health + COMBAT.healthPickupAmount);
      return { applied: true };
    }

    if (category === "armor") {
      if (player.armor >= COMBAT.maxArmor) return { applied: false };
      player.armor = Math.min(COMBAT.maxArmor, player.armor + COMBAT.armorPickupAmount);
      return { applied: true };
    }

    // "weapon" / "ammo" (EPIC 6, unchanged behavior). Defensive: neither
    // PICKUP_SPAWN_POINTS nor a well-formed caller ever supplies "pistol"
    // (spec: pistol is never a pickup) or an undefined weapon for these two
    // categories, but guard here too rather than trust the caller.
    if (!weapon || weapon === "pistol") return { applied: false };

    const stats = WEAPON_STATS[weapon];
    const alreadyOwned = player.ownedWeapons.has(weapon);
    const currentAmmo = player.ammo[weapon] ?? 0;
    if (alreadyOwned && currentAmmo >= stats.maxAmmo) {
      return { applied: false };
    }

    player.ownedWeapons.add(weapon);
    const newAmmo = Math.min(stats.maxAmmo, currentAmmo + stats.ammoPerPickup);
    player.ammo[weapon] = newAmmo;
    // EPIC 13 Story 13.2: the `!alreadyOwned` gate from EPIC 6 is dropped —
    // any applied pickup (first unlock or refill) auto-equips `weapon` if
    // it strictly outranks what's currently equipped and now actually has
    // ammo. First-time unlock of a higher-tier weapon is still covered
    // (newAmmo is always > 0 there, since ammoPerPickup > 0 for every
    // non-pistol weapon) — this is a strict generalization, not a
    // replacement.
    let autoSwitchedTo: WeaponType | undefined;
    if (stats.tier > WEAPON_STATS[player.equippedWeapon].tier && (stats.infiniteAmmo || newAmmo > 0)) {
      player.equippedWeapon = weapon;
      autoSwitchedTo = weapon;
    }
    return { applied: true, autoSwitchedTo };
  }

  /**
   * Cycle `id`'s equipped weapon forward through OWNED weapons in tier order
   * (EPIC 6 Story 6.2, "E" key) — pistol -> rifle -> grenade launcher ->
   * pistol -> ..., skipping tiers not owned. Returns false (no change
   * applied) if the player is unknown or owns only one weapon (nothing to
   * cycle to — "pressing E with only the pistol owned does nothing" AC), so
   * the caller can skip broadcasting/logging a no-op.
   */
  cycleWeapon(id: string): boolean {
    const player = this.players.get(id);
    if (!player) return false;

    const owned = WEAPON_ORDER.filter((weapon) => player.ownedWeapons.has(weapon));
    if (owned.length <= 1) return false;

    const currentIndex = owned.indexOf(player.equippedWeapon);
    const next = owned[(currentIndex + 1) % owned.length];
    if (next === player.equippedWeapon) return false;
    player.equippedWeapon = next;
    return true;
  }

  /** This player's current loadout, for building a private LoadoutMessage (server/src/index.ts sendLoadout()) — null if the player is unknown (e.g. already disconnected). */
  getLoadout(id: string): LoadoutSnapshot | null {
    const player = this.players.get(id);
    if (!player) return null;

    const stats = WEAPON_STATS[player.equippedWeapon];
    const ammo = stats.infiniteAmmo ? null : (player.ammo[player.equippedWeapon] ?? 0);
    const ownedWeapons = WEAPON_ORDER.filter((weapon) => player.ownedWeapons.has(weapon));
    return { equippedWeapon: player.equippedWeapon, ammo, ownedWeapons };
  }

  /** Id + current position of every currently-alive player — used by index.ts's tick loop to check pickup proximity (server/src/pickupSpawner.ts) without exposing the internal PlayerRecord map. */
  alivePlayerPositions(): Array<{ id: string; position: Vector3 }> {
    const list: Array<{ id: string; position: Vector3 }> = [];
    for (const player of this.players.values()) {
      if (player.alive) list.push({ id: player.id, position: player.position });
    }
    return list;
  }

  /**
   * Check every dead player's respawn timer against `nowMs` (server clock)
   * and respawn any that are due: full health, a fresh spawn position
   * (same pool/collision-safety as spawn()), cleared intent (so a stale
   * held key from before death can't trigger an instant post-respawn jump),
   * and the loadout reset to pistol-only via applyBaselineLoadout() —
   * EPIC 6 Critic non-blocking recommendation, folded in before merge:
   * picked-up weapons/ammo do not persist across death (arena-FFA
   * convention, "ammo scarcity has real stakes"). The caller (index.ts) is
   * responsible for re-sending this player's LoadoutMessage so their own
   * HUD reflects the reset — this method only mutates server state.
   * Returns the set of respawns that happened this call, for the caller to
   * broadcast as RespawnEvent messages.
   */
  processRespawns(nowMs: number): RespawnOutcome[] {
    const outcomes: RespawnOutcome[] = [];
    for (const player of this.players.values()) {
      if (player.alive || player.respawnAtMs === null) continue;
      if (nowMs < player.respawnAtMs) continue;

      player.position = this.pickSpawnPosition();
      player.velocityY = 0;
      player.grounded = true;
      // EPIC 8: a respawn is a fresh ground state, same as a brand-new
      // connection (spawn()) — no lingering mid-air bunny-hop eligibility
      // or speed multiplier should carry across a death.
      player.bunnyHopAvailable = true;
      player.pendingBunnyHopTrigger = false;
      player.airSpeedMultiplier = 1;
      // Keep pet ratings across death; refill to the pet-boosted max HP.
      player.maxHealth = COMBAT.maxHealth + maxHealthBonusFromRatings(player.petRatings.healthRating);
      player.health = player.maxHealth;
      player.alive = true;
      player.respawnAtMs = null;
      player.intent = { moveForward: 0, moveRight: 0, jump: false };
      applyBaselineLoadout(player);

      outcomes.push({ playerId: player.id, position: { ...player.position }, health: player.health });
    }
    return outcomes;
  }

  /**
   * Advance the whole simulation by one fixed tick. dtSeconds is the
   * server's own fixed tick duration — never derived from client-reported
   * timing, so a client cannot speed up its own simulation by sending a
   * fabricated delta.
   */
  step(dtSeconds: number): void {
    for (const player of this.players.values()) {
      this.stepPlayer(player, dtSeconds);
    }
  }

  private stepPlayer(player: PlayerRecord, dt: number): void {
    // Story 4.2 AC: "A player reduced to 0 health stops being able to
    // move ... until respawn" — frozen in place entirely (including
    // gravity) while dead. Harmless visually since dead players' avatars
    // are hidden client-side (client/src/remotePlayers.ts).
    if (!player.alive) return;

    // EPIC 8 Story 8.2 "bunny hop": consume this tick's one-shot jump-edge
    // latch (set by applyInput() on a genuine false->true edge of the
    // client's `jump` field, i.e. an actual fresh Space key-down, never a
    // held key) exactly once, regardless of outcome, so it can never linger
    // into a later tick or accumulate. It only actually triggers the boost
    // when the player is currently airborne AND has not already used one
    // this air-time (bunnyHopAvailable) — this is the server-side gate that
    // makes "at most one boost per air-time" hold even against a raw WS
    // client spamming jump input while airborne (security-baseline.mdc). A
    // press while grounded falls through here with no effect and is instead
    // handled by the unchanged normal-jump trigger further below.
    const bunnyHopTriggered = player.pendingBunnyHopTrigger;
    player.pendingBunnyHopTrigger = false;
    if (bunnyHopTriggered && !player.grounded && player.bunnyHopAvailable) {
      player.bunnyHopAvailable = false;
      // Horizontal: boost the move-speed multiplier for the rest of this
      // air-time (reset to 1 on landing below) rather than a one-off
      // velocity impulse — see BUNNY_HOP doc comment (shared/src/index.ts)
      // for why, given this simulation recomputes horizontal displacement
      // from input intent every tick instead of integrating a persisted
      // horizontal velocity.
      player.airSpeedMultiplier = BUNNY_HOP.speedMultiplier;
      // Vertical: additive "kick" on top of whatever vertical velocity
      // remains from the original jump (EPIC 8 spec Section 2) — not a
      // fresh jump from ground height.
      player.velocityY += MOVEMENT.jumpSpeed * BUNNY_HOP.verticalBoostFraction;
    }

    const { intent } = player;

    // Clamp combined move-intent to unit length so diagonal movement (W+D)
    // cannot exceed maxSpeed — this is the server-side speed clamp.
    let moveForward = intent.moveForward;
    let moveRight = intent.moveRight;
    const magnitude = Math.hypot(moveForward, moveRight);
    if (magnitude > 1) {
      moveForward /= magnitude;
      moveRight /= magnitude;
    }

    // Project local move-intent into world space using the player's yaw.
    // Matches three.js's rotation.y convention (forward = -sin/-cos, right = cos/-sin)
    // so client-side prediction and this authoritative simulation agree visually.
    const forwardX = -Math.sin(player.yaw);
    const forwardZ = -Math.cos(player.yaw);
    const rightX = Math.cos(player.yaw);
    const rightZ = -Math.sin(player.yaw);

    // EPIC 8 Story 8.1 / EPIC 11 Story 11.2: MOVEMENT.maxSpeed is the
    // single shared base-speed constant (currently 5 * 1.33 * 2 = 13.3 m/s,
    // see shared/src/index.ts — do not hardcode the literal here).
    // airSpeedMultiplier is 1 outside an active bunny-hop boost, so this is
    // a no-op change to normal movement — only a boosted air-time actually
    // sees the extra factor (reaching ~17.3 m/s at the current base).
    // EPIC 24: pet speed rating multiplies on top (still subject to world
    // bounds / collision clamps — not a second hard speed ceiling).
    const petSpeed = speedMultiplierFromRatings(player.petRatings.speedRating);
    const dx =
      (forwardX * moveForward + rightX * moveRight) *
      MOVEMENT.maxSpeed *
      player.airSpeedMultiplier *
      petSpeed *
      dt;
    const dz =
      (forwardZ * moveForward + rightZ * moveRight) *
      MOVEMENT.maxSpeed *
      player.airSpeedMultiplier *
      petSpeed *
      dt;

    // Authoritative collision (EPIC 3 Story 3.3, sub-stepped since EPIC 11
    // Story 11.1, height-aware since EPIC 12 Story 12.1): resolve the
    // proposed movement against the exact same ARENA_GEOMETRY the client
    // renders and predicts against, via resolveSteppedMovement() rather than
    // a single resolveHorizontalCollisions call — at EPIC 11's new top speed
    // a single tick's raw displacement can exceed a wall's thickness, so the
    // movement is resolved in several smaller sub-steps (see
    // shared/src/collision.ts doc comment) so a wall hit mid-tick is caught
    // rather than glossed over. This is what actually matters for
    // anti-cheat — no matter what the client's own prediction claims, the
    // position broadcast to every player is clamped clear of every
    // currently-blocking wall/crate here. The coarse WORLD_BOUND clamp is
    // applied to the proposed end point first (unchanged), then sub-stepped
    // collision resolves the path from the player's current position toward
    // it, against boxesBlockingAt(feetY) — the player's feet height (Y) at
    // the START of this tick, before this tick's own vertical integration
    // below — so a crate the player is currently standing on/above does not
    // block them horizontally (EPIC 12 Story 12.1), while every wall and
    // every not-yet-mounted crate still does.
    const feetYAtTickStart = player.position.y;
    const geometry = this.geometry();
    const blockingBoxes = boxesBlockingAt(feetYAtTickStart, geometry);
    const proposedX = this.clampBound(player.position.x + dx);
    const proposedZ = this.clampBound(player.position.z + dz);
    const resolved = resolveSteppedMovement(
      player.position.x,
      player.position.z,
      proposedX - player.position.x,
      proposedZ - player.position.z,
      undefined,
      blockingBoxes,
    );
    player.position.x = resolved.x;
    player.position.z = resolved.z;

    // Vertical: gravity + jump, then a height-aware ground/crate-top clamp
    // (EPIC 12 Story 12.2) — map geometry's crates are now standable
    // surfaces (see collision.ts doc comment), not just flat-ground-height
    // full-height obstacles.
    if (intent.jump && player.grounded) {
      player.velocityY = MOVEMENT.jumpSpeed;
      player.grounded = false;
    }
    player.velocityY -= MOVEMENT.gravity * dt;
    player.position.y += player.velocityY * dt;

    // Ground/crate-top support height at the player's POST-horizontal-
    // resolution (x, z) this tick — the highest of the flat ground plane or
    // any crate whose radius-expanded footprint is under the player right
    // now (0 if none, i.e. the pre-EPIC-12 flat-ground-only behavior).
    const groundHeight = Math.max(MOVEMENT.groundY, crateTopHeightAt(player.position.x, player.position.z, geometry));

    if (player.position.y <= groundHeight) {
      player.position.y = groundHeight;
      player.velocityY = 0;
      player.grounded = true;
      // EPIC 8 Story 8.2: landing is what makes a bunny hop available
      // again ("grounded -> airborne -> [optional one boost] -> grounded
      // resets the flag" per the EPIC spec) and ends the boosted air-time's
      // speed multiplier.
      player.bunnyHopAvailable = true;
      player.airSpeedMultiplier = 1;
    } else {
      // EPIC 12 Story 12.2, the single highest-risk line in this EPIC: once
      // groundHeight can vary spatially (0 vs CRATE_HEIGHT, not just always
      // 0 as before this EPIC), a player standing on a crate who simply
      // walks off its edge (no jump input at all) needs to become airborne
      // purely from losing the support under their feet — without this
      // branch, `grounded` would incorrectly stay true (its last-set value,
      // from a previous tick's landing clamp) after walking off a ledge,
      // letting the player trigger an ungrounded extra jump even though
      // they are visibly falling. Before EPIC 12, `grounded` was only ever
      // set true (this clamp) or false (the jump trigger above) — a single
      // flat ground plane never needed an explicit "still falling, stay
      // ungrounded" branch, since there was no way to be above groundHeight
      // without having just jumped.
      player.grounded = false;
    }
  }

  private clampBound(value: number): number {
    const bound = this.options.worldBound ?? WORLD_BOUND;
    return Math.max(-bound, Math.min(bound, value));
  }

  /**
   * Current kill count for every connected player (EPIC 5 Story 5.2),
   * highest kills first (ties broken by id) — sorted server-side so the
   * client stays a plain renderer of what the server already decided,
   * rather than re-deriving presentation order from raw per-player data
   * itself.
   */
  getScores(): PlayerScore[] {
    const scores: PlayerScore[] = [];
    for (const player of this.players.values()) {
      scores.push({ id: player.id, nickname: player.nickname, kills: player.kills });
    }
    scores.sort((a, b) => b.kills - a.kills || a.nickname.localeCompare(b.nickname) || a.id.localeCompare(b.id));
    return scores;
  }

  toWorldState(): PlayerState[] {
    const states: PlayerState[] = [];
    for (const player of this.players.values()) {
      states.push({
        id: player.id,
        nickname: player.nickname,
        position: { ...player.position },
        yaw: player.yaw,
        health: player.health,
        armor: player.armor,
        equippedWeapon: player.equippedWeapon,
        alive: player.alive,
      });
    }
    return states;
  }
}

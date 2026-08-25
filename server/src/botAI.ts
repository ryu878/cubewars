// Bot AI (EPIC 9 "Bots & Match Modes" Section 3): a simple SEEKING/ENGAGING
// state machine that decides a bot's per-tick input/fire intent, applied
// through the registry's own validated applyInput()/fire() entry points —
// exactly the same authoritative path a human connection's messages take
// (see match.ts's tick(), which calls BotAI.update() BEFORE
// registry.step()). This file only ever DECIDES intent; it never bypasses
// PlayerRegistry's own validation/physics/collision.
//
// Deliberately minimal per the EPIC 9 spec (Section 3 / Risks): pistol only,
// no weapon/health/armor pickups, no bunny hop, no real pathfinding (patrol
// via the existing SPAWN_POINTS waypoint list — shared/src/mapData.ts —
// rather than a second waypoint system). This is a documented scope cut, not
// a bug: if the user later wants smarter bots, that's a follow-up EPIC.

import {
  ARENA_GEOMETRY,
  EYE_HEIGHT,
  PET_TYPES,
  SPAWN_POINTS,
  aggregateEquippedRatings,
  boxBounds,
  randomAvatarColors,
  randomPaletteIndex,
  rayIntersectsAabb,
  type EquippedPetInput,
  type PetType,
  type Ray,
  type MapBox,
  type Vector3,
} from "@cubewars/shared";
import type { PlayerRegistry } from "./playerRegistry.js";
import { isSpawnProtected } from "./combat.js";

/** SEEKING <-> ENGAGING switch distance, world units (EPIC 9 spec Section 3: "e.g. 45 units"). Horizontal (x/z) distance, matching the rest of this codebase's ground-plane proximity checks. */
const DETECTION_RANGE = 45;

/** Horizontal distance at which a patrolling bot considers its current waypoint "reached" and picks a new one. */
const WAYPOINT_ARRIVE_DISTANCE = 3;

/** Upper bound on how long a bot sticks with one waypoint before picking a new one anyway — avoids a bot stalling forever circling a point collision keeps it from exactly reaching. */
const WAYPOINT_TIMEOUT_MS = 8000;

/**
 * Yaw turn rate while ENGAGING a target, radians/sec (EPIC 9 spec Section 3:
 * "interpolate yaw toward it") — fast enough to feel responsive (a full
 * 180-degree turn takes ~0.5s) without snapping instantly like a perfectly
 * omniscient aimbot. Documented Programmer tuning choice, not a spec-fixed
 * number.
 */
const ENGAGE_TURN_RATE_RAD_PER_SEC = 6;

/** Max angular error (radians, ~4.6 degrees) between current yaw and the exact bearing to target before a bot considers itself "aimed enough" to fire — avoids firing while still mid-turn onto a fresh target. */
const AIM_TOLERANCE_RAD = 0.08;

/**
 * EPIC 11 Story 11.4 "bot aim inaccuracy": uniform random offset (radians),
 * applied independently to yaw and pitch, ONLY at the moment a bot actually
 * fires (see the fire branch in updateOne() below) — never to the
 * smooth turn-to-face computation (`nextYaw`) that drives ENGAGING's visual
 * tracking, so the bot still visibly turns to face its target normally, it
 * just doesn't always land the shot. Team-Lead-suggested starting value
 * (~0.05 rad / ~3 degrees, EPIC 11 spec Section 6); kept as-is after a
 * statistical check (scripts/qa-epic11-bot-miss-rate.mjs — see EPIC 11
 * Programmer handoff for the measured numbers) showed a reasonable
 * close-range-hits / long-range-misses curve given PLAYER_HITBOX_RADIUS
 * (0.5, shared/src/combat.ts): at ~10 units the angular half-width of the
 * hitbox (atan(0.5/10) ~= 0.05 rad) is about equal to this jitter, so shots
 * around that range are genuinely 50/50, closer shots mostly land, and
 * shots at the ~45-unit detection-range edge mostly miss.
 */
const AIM_JITTER_RAD = 0.05;

/**
 * EPIC 31 "Randomized Bot Equipment Loadouts": the 4 documented archetypes
 * (spec Section 3.1), uniform-random pick per bot spawn.
 *
 * A -- Bare: no pets, no amulet (today's baseline bot behavior, unchanged).
 * B -- One pet in slot 1 (100% contribution), no amulet.
 * C -- One pet in slot 2 (40% contribution, amulet-gated) + amulet.
 * D -- Two pets, slot 1 (100%) + slot 2 (40%), + amulet.
 */
export type BotLoadoutArchetype = "A" | "B" | "C" | "D";

const BOT_LOADOUT_ARCHETYPES: readonly BotLoadoutArchetype[] = ["A", "B", "C", "D"] as const;

/** One pet slot in a generated bot loadout, ready to feed straight into aggregateEquippedRatings() (shared/src/economy.ts). */
interface BotPetSlot {
  type: PetType;
  baseValue: number;
  equipSlot: 1 | 2;
  /** EPIC 39: random palette index assigned with the loadout (in-memory only). */
  colorIndex: number;
}

export interface BotLoadout {
  archetype: BotLoadoutArchetype;
  pets: BotPetSlot[];
  hasAmulet: boolean;
}

/**
 * Same [1, 200] inclusive band a freshly-hatched HUMAN pet gets
 * (server/src/economy/store.ts randomBaseValue()) so a geared bot is
 * comparable in power to a geared human, not a separate balance curve
 * (EPIC 31 spec Section 3.1). Deliberately duplicated as a one-liner here
 * rather than importing from economy/store.ts: that module is Redis/DB
 * backed and bots must never gain any cross-module coupling into the
 * economy store (see EPIC 31 spec Section 8 risk: "must not accidentally
 * wire bots into the Redis economy store").
 */
function randomBotPetBaseValue(): number {
  return 1 + Math.floor(Math.random() * 200);
}

function randomPetType(): PetType {
  return PET_TYPES[Math.floor(Math.random() * PET_TYPES.length)]!;
}

function randomBotPet(equipSlot: 1 | 2): BotPetSlot {
  return {
    type: randomPetType(),
    baseValue: randomBotPetBaseValue(),
    equipSlot,
    colorIndex: randomPaletteIndex(),
  };
}

/** Generate one bot's fixed-for-its-lifetime loadout (EPIC 31 spec Section 3.1) — pure, no registry/economy access. */
export function generateBotLoadout(): BotLoadout {
  const archetype = BOT_LOADOUT_ARCHETYPES[Math.floor(Math.random() * BOT_LOADOUT_ARCHETYPES.length)]!;
  switch (archetype) {
    case "A":
      return { archetype, pets: [], hasAmulet: false };
    case "B":
      return {
        archetype,
        pets: [randomBotPet(1)],
        hasAmulet: false,
      };
    case "C":
      return {
        archetype,
        pets: [randomBotPet(2)],
        hasAmulet: true,
      };
    case "D":
      return {
        archetype,
        pets: [randomBotPet(1), randomBotPet(2)],
        hasAmulet: true,
      };
  }
}

/**
 * Apply a generated loadout to an already-spawned bot: aggregate ratings via
 * the exact same pure function humans' computeRatings() uses
 * (aggregateEquippedRatings(), shared/src/economy.ts — no new combat math),
 * push them through registry.applyPetRatings() (the identical entry point
 * applyEconomyCombatToPlayer() uses for humans in match.ts), and set the
 * cosmetic visual-tell reveal (registry.setEquipmentVisual()) from the same
 * loadout. Logs one line per bot spawn (EPIC 31 spec acceptance criteria:
 * "server-side log line per bot spawn showing its assigned loadout").
 */
function applyBotLoadout(registry: PlayerRegistry, botId: string, loadout: BotLoadout): void {
  const pets: EquippedPetInput[] = loadout.pets.map((pet) => ({
    type: pet.type,
    baseValue: pet.baseValue,
    equipSlot: pet.equipSlot,
  }));
  const ratings = aggregateEquippedRatings(pets, loadout.hasAmulet);
  registry.applyPetRatings(botId, ratings);
  registry.setEquipmentVisual(
    botId,
    loadout.pets.map((pet) => ({
      slotId: `bot:${botId}:slot${pet.equipSlot}`,
      type: pet.type,
      colorIndex: pet.colorIndex,
    })),
    loadout.hasAmulet,
  );
  // EPIC 33: independently random palette index per body part (in-memory only).
  const avatarColors = randomAvatarColors();
  registry.setAvatarColors(botId, avatarColors);
  const petsLabel = loadout.pets
    .map((pet) => `${pet.type}#${pet.baseValue}@c${pet.colorIndex}`)
    .join(",");
  console.log(
    `[bots] ${botId} loadout: archetype=${loadout.archetype} pets=[${petsLabel}] amulet=${loadout.hasAmulet} ` +
      `colors=h${avatarColors.head}/t${avatarColors.torso}/a${avatarColors.hands}/l${avatarColors.legs}`,
  );
}

export type BotState = "SEEKING" | "ENGAGING";

interface BotRuntime {
  id: string;
  state: BotState;
  waypoint: Vector3;
  waypointDeadlineMs: number;
  /** This bot's own last-accepted-fire timestamp (Date.now()-based) — the bot-side equivalent of server/src/index.ts's per-connection `lastFireAcceptedAt` map, gated against the same `registry.getFireCooldownMs()` a human's fire messages are gated against. Bots never go through the WS message path, so this lives here instead of that map. */
  lastFireAcceptedAt: number;
}

/** Wrap an angle difference into (-PI, PI] so a bot always turns via the shorter path. */
function wrapAngle(delta: number): number {
  const twoPi = Math.PI * 2;
  let wrapped = delta % twoPi;
  if (wrapped > Math.PI) wrapped -= twoPi;
  if (wrapped < -Math.PI) wrapped += twoPi;
  return wrapped;
}

/** Pick a random SPAWN_POINTS waypoint, preferring one different from `exclude` (best-effort — with only a handful of points this can still repeat, which is harmless). */
function pickWaypoint(points: readonly Vector3[], exclude?: Vector3): Vector3 {
  if (points.length <= 1) return points[0] ?? SPAWN_POINTS[0];
  let candidate: Vector3;
  let attempts = 0;
  do {
    candidate = points[Math.floor(Math.random() * points.length)];
    attempts += 1;
  } while (exclude && candidate === exclude && attempts < 8);
  return candidate;
}

/**
 * Wall-only line-of-sight check between two world-space points, reusing the
 * exact same slab-method ray-vs-AABB test + ARENA_GEOMETRY box list
 * server/src/combat.ts's performHitscan() uses for its own map-geometry
 * blocking pass (shared/src/combat.ts rayIntersectsAabb / shared/src/
 * mapData.ts boxBounds) — a target is visible if no wall/crate box
 * intersects the straight line to it before the target is reached. Does not
 * consider other players as occluders, matching combat.ts's own
 * map-geometry pass (blocking-only, never itself a "hit").
 */
function hasLineOfSight(from: Vector3, to: Vector3, geometry: readonly MapBox[]): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) return true;
  const direction: Vector3 = { x: dx / distance, y: dy / distance, z: dz / distance };
  const ray: Ray = { origin: from, direction };
  for (const box of geometry) {
    if (rayIntersectsAabb(ray, boxBounds(box), distance) !== null) return false;
  }
  return true;
}

export class BotAI {
  private bots = new Map<string, BotRuntime>();

  constructor(
    private registry: PlayerRegistry,
    private options: {
      getGeometry?: () => readonly MapBox[];
      getWaypoints?: () => readonly Vector3[];
      canTarget?: (candidateId: string) => boolean;
    } = {},
  ) {}

  /** True if `id` belongs to a bot managed by this instance — used by match.ts's tick loop to exclude bots from pickup consumption (EPIC 9 spec: bots ignore all pickups entirely). */
  isBot(id: string): boolean {
    return this.bots.has(id);
  }

  /**
   * Spawn `count` bots into the registry with readable ids ("Bot 1", "Bot
   * 2", ...) instead of a random UUID prefix (EPIC 9 spec Section 3) — this
   * doubles as the bot's display label everywhere the client already
   * shortens a player id for display (client/src/killFeed.ts `shortId()`:
   * an id this short round-trips unchanged). Reuses PlayerRegistry.spawn(),
   * the exact same spawn-point-picking/collision-safety path a human
   * connection uses — a bot is a regular PlayerRecord from the moment it
   * exists. Returns the ids created.
   */
  spawnBots(count: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = `Bot ${this.bots.size + 1}`;
      this.registry.spawn(id, id, id.toLocaleLowerCase());
      applyBotLoadout(this.registry, id, generateBotLoadout());
      this.bots.set(id, {
        id,
        state: "SEEKING",
        waypoint: pickWaypoint(this.waypoints()),
        waypointDeadlineMs: Date.now() + WAYPOINT_TIMEOUT_MS,
        lastFireAcceptedAt: 0,
      });
      ids.push(id);
    }
    return ids;
  }

  spawnBotAt(id: string, position: Vector3, nickname: string = id): void {
    this.registry.spawnAt(id, position, nickname, nickname.toLocaleLowerCase());
    applyBotLoadout(this.registry, id, generateBotLoadout());
    this.bots.set(id, {
      id,
      state: "SEEKING",
      waypoint: pickWaypoint(this.waypoints()),
      waypointDeadlineMs: Date.now() + WAYPOINT_TIMEOUT_MS,
      lastFireAcceptedAt: 0,
    });
  }

  removeBot(id: string): void {
    if (!this.bots.delete(id)) return;
    this.registry.remove(id);
  }

  clearBots(): void {
    for (const id of [...this.bots.keys()]) {
      this.registry.remove(id);
    }
    this.bots.clear();
  }

  /**
   * Advance every bot's AI by one tick: compute this tick's input intent
   * from the SEEKING/ENGAGING state machine and apply it via
   * registry.applyInput() (the same validated entry point a client's
   * PlayerInputMessage goes through), then fire (via `resolveFire`) once
   * aimed at a target and off cooldown. MUST be called before
   * registry.step() in the caller's tick — see match.ts.
   */
  update(nowMs: number, resolveFire: (shooterId: string) => void): void {
    for (const bot of this.bots.values()) {
      this.updateOne(bot, nowMs, resolveFire);
    }
  }

  private updateOne(bot: BotRuntime, nowMs: number, resolveFire: (shooterId: string) => void): void {
    const self = this.registry.getPlayer(bot.id);
    // Frozen while dead, same as a human (stepPlayer() no-ops for a dead
    // player) — respawn itself is handled generically by
    // registry.processRespawns(), same as a human's respawn.
    if (!self || !self.alive) return;

    const target = this.findTarget(self.id, self.position);

    if (target) {
      bot.state = "ENGAGING";

      const dx = target.position.x - self.position.x;
      const dz = target.position.z - self.position.z;
      // Same forward-vector convention as stepPlayer()/aimDirection():
      // forwardX = -sin(yaw), forwardZ = -cos(yaw). Solve for the yaw whose
      // forward vector points at the target.
      const desiredYaw = Math.atan2(-dx, -dz);
      const yawError = wrapAngle(desiredYaw - self.yaw);
      const maxStep = ENGAGE_TURN_RATE_RAD_PER_SEC * this.tickDtSeconds;
      const step = Math.max(-maxStep, Math.min(maxStep, yawError));
      const nextYaw = self.yaw + step;

      const horizontalDistance = Math.hypot(dx, dz);
      const dy = target.position.y - self.position.y; // eye-height offset is identical on both sides, cancels out
      const pitch = Math.atan2(dy, Math.max(0.001, horizontalDistance));

      // ENGAGING per EPIC 9 spec Section 3: "stop advancing ... (Programmer's
      // call, document it)" — this bot holds its ground and only turns/aims
      // while a target is visible, rather than closing distance. Documented
      // deliberate simplification (avoids bots strafing into walls/crates
      // while aiming, keeps the AI's movement model identical whether
      // SEEKING or ENGAGING: always a straight moveForward/moveRight
      // intent, never a second movement mode).
      this.registry.applyInput(bot.id, {
        moveForward: 0,
        moveRight: 0,
        yaw: nextYaw,
        pitch,
        jump: false,
      });

      const cooldownMs = this.registry.getFireCooldownMs(bot.id);
      const aimed = Math.abs(wrapAngle(desiredYaw - nextYaw)) <= AIM_TOLERANCE_RAD;
      // EPIC 41: do not stamp lastFireAcceptedAt while spawn-protected —
      // registry.fire() would no-op anyway; burning cooldown would be unfair.
      if (
        aimed &&
        !isSpawnProtected(self, nowMs) &&
        nowMs - bot.lastFireAcceptedAt >= cooldownMs
      ) {
        bot.lastFireAcceptedAt = nowMs;
        // EPIC 11 Story 11.4: apply this shot's random aim jitter via the
        // SAME validated applyInput() entry point (never a direct field
        // mutation on the PlayerRecord — see PlayerRegistry.getPlayer() doc
        // comment's read-only convention), immediately before resolveFire()
        // reads the shooter's now-jittered yaw/pitch to build its hitscan
        // ray (server/src/combat.ts performHitscan(), untouched by this
        // EPIC). This intentionally overwrites the smoothly-tracked
        // `nextYaw`/`pitch` this one tick only, for this one shot — next
        // tick's ENGAGING pass recomputes `nextYaw` fresh from the bot's
        // actual position/target as always, so the jitter never accumulates
        // or visibly disrupts the bot's normal turn-to-face tracking.
        const jitteredYaw = nextYaw + (Math.random() * 2 - 1) * AIM_JITTER_RAD;
        const jitteredPitch = pitch + (Math.random() * 2 - 1) * AIM_JITTER_RAD;
        this.registry.applyInput(bot.id, {
          moveForward: 0,
          moveRight: 0,
          yaw: jitteredYaw,
          pitch: jitteredPitch,
          jump: false,
        });
        resolveFire(bot.id);
      }
      return;
    }

    bot.state = "SEEKING";
    const wx = bot.waypoint.x - self.position.x;
    const wz = bot.waypoint.z - self.position.z;
    const distanceToWaypoint = Math.hypot(wx, wz);
    if (distanceToWaypoint <= WAYPOINT_ARRIVE_DISTANCE || nowMs >= bot.waypointDeadlineMs) {
      bot.waypoint = pickWaypoint(this.waypoints(), bot.waypoint);
      bot.waypointDeadlineMs = nowMs + WAYPOINT_TIMEOUT_MS;
    }

    // Patrol: face the waypoint directly and walk straight at it (no
    // pathfinding — SPAWN_POINTS is already spread across both sites/mid/
    // tunnel, see EPIC 9 spec Section 3) — ground-based only, no jump.
    const patrolYaw = Math.atan2(-wx, -wz);
    this.registry.applyInput(bot.id, {
      moveForward: 1,
      moveRight: 0,
      yaw: patrolYaw,
      pitch: 0,
      jump: false,
    });
  }

  /** Nearest alive player (human OR another bot — EPIC 9 spec Section 3 explicitly allows either) within DETECTION_RANGE and with clear wall LOS from `fromId`'s current position — or null if none. */
  private findTarget(fromId: string, fromPosition: Vector3): { id: string; position: Vector3 } | null {
    const fromEye: Vector3 = { x: fromPosition.x, y: fromPosition.y + EYE_HEIGHT, z: fromPosition.z };
    let nearest: { id: string; position: Vector3 } | null = null;
    let nearestDistance = DETECTION_RANGE;

    for (const candidate of this.registry.alivePlayerPositions()) {
      if (candidate.id === fromId) continue;
      if (this.options.canTarget && !this.options.canTarget(candidate.id)) continue;
      const dx = candidate.position.x - fromPosition.x;
      const dz = candidate.position.z - fromPosition.z;
      const distance = Math.hypot(dx, dz);
      if (distance > nearestDistance) continue;

      const candidateEye: Vector3 = {
        x: candidate.position.x,
        y: candidate.position.y + EYE_HEIGHT,
        z: candidate.position.z,
      };
      if (!hasLineOfSight(fromEye, candidateEye, this.geometry())) continue;

      nearest = candidate;
      nearestDistance = distance;
    }
    return nearest;
  }

  /** Fixed tick duration this AI's turn-rate math assumes — set once via setTickDtSeconds() by match.ts at construction time (the same TICK_DT_SECONDS every match tick already uses for registry.step()), never derived from wall-clock timing between calls. */
  private tickDtSeconds = 0.05;

  /** Called once by match.ts right after construction to align this AI's turn-rate math with the match's actual fixed tick duration, instead of hardcoding the 20Hz assumption here too. */
  setTickDtSeconds(dtSeconds: number): void {
    this.tickDtSeconds = dtSeconds;
  }

  private geometry(): readonly MapBox[] {
    return this.options.getGeometry?.() ?? ARENA_GEOMETRY;
  }

  private waypoints(): readonly Vector3[] {
    const points = this.options.getWaypoints?.() ?? SPAWN_POINTS;
    return points.length > 0 ? points : SPAWN_POINTS;
  }
}

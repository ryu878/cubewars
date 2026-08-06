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
  SPAWN_POINTS,
  boxBounds,
  rayIntersectsAabb,
  type Ray,
  type Vector3,
} from "@cubewars/shared";
import type { PlayerRegistry } from "./playerRegistry.js";

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
function pickWaypoint(exclude?: Vector3): Vector3 {
  if (SPAWN_POINTS.length <= 1) return SPAWN_POINTS[0];
  let candidate: Vector3;
  let attempts = 0;
  do {
    candidate = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
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
function hasLineOfSight(from: Vector3, to: Vector3): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dy, dz);
  if (distance < 1e-6) return true;
  const direction: Vector3 = { x: dx / distance, y: dy / distance, z: dz / distance };
  const ray: Ray = { origin: from, direction };
  for (const box of ARENA_GEOMETRY) {
    if (rayIntersectsAabb(ray, boxBounds(box), distance) !== null) return false;
  }
  return true;
}

export class BotAI {
  private bots = new Map<string, BotRuntime>();

  constructor(private registry: PlayerRegistry) {}

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
      this.bots.set(id, {
        id,
        state: "SEEKING",
        waypoint: pickWaypoint(),
        waypointDeadlineMs: Date.now() + WAYPOINT_TIMEOUT_MS,
        lastFireAcceptedAt: 0,
      });
      ids.push(id);
    }
    return ids;
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
      if (aimed && nowMs - bot.lastFireAcceptedAt >= cooldownMs) {
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
      bot.waypoint = pickWaypoint(bot.waypoint);
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
      const dx = candidate.position.x - fromPosition.x;
      const dz = candidate.position.z - fromPosition.z;
      const distance = Math.hypot(dx, dz);
      if (distance > nearestDistance) continue;

      const candidateEye: Vector3 = {
        x: candidate.position.x,
        y: candidate.position.y + EYE_HEIGHT,
        z: candidate.position.z,
      };
      if (!hasLineOfSight(fromEye, candidateEye)) continue;

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
}

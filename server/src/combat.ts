// Authoritative hitscan resolution (EPIC 4 "Shooting & Combat" Story 4.1).
// Deliberately transport-agnostic and free of ws/broadcast concerns — only
// game/simulation logic here (per global-standards.mdc: keep game logic
// separate from transport code). server/src/index.ts turns the result of
// performHitscan() into ServerMessage broadcasts.

import {
  ARENA_GEOMETRY,
  boxBounds,
  rayIntersectsAabb,
  playerHitboxBounds,
  COMBAT,
  DAMAGE_ZONE_HEIGHTS,
  EYE_HEIGHT,
  GRENADE_SPLASH,
  PROJECTILE_SPEEDS,
  type Ray,
  type Vector3,
  type DamageZone,
  type MapBox,
  type ShotTrace,
  type WeaponType,
} from "@cubewars/shared";
import type { PlayerRecord } from "./playerRegistry.js";

export interface HitscanResult {
  hitPlayerId: string | null;
  point: Vector3 | null;
  hitZone: Exclude<DamageZone, "splash"> | null;
  blockedByGeometry: boolean;
  trace: ShotTrace;
}

/**
 * Convert a (yaw, pitch) look direction into a world-space unit vector,
 * using the exact same convention three.js applies for this project's
 * camera rotation order ("YXZ", set via `camera.rotation.set(pitch, yaw, 0)`
 * in client/src/fpsController.ts): at pitch=0 this reduces to
 * (-sin(yaw), 0, -cos(yaw)), matching the forward vector already used for
 * movement projection in playerRegistry.ts's stepPlayer(), so aim direction
 * and movement-forward direction stay visually consistent.
 */
export function aimDirection(yaw: number, pitch: number): Vector3 {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch,
  };
}

export function pointOnRay(ray: Ray, distance: number): Vector3 {
  return {
    x: ray.origin.x + ray.direction.x * distance,
    y: ray.origin.y + ray.direction.y * distance,
    z: ray.origin.z + ray.direction.z * distance,
  };
}

export function buildAimRay(shooter: PlayerRecord): Ray {
  return {
    origin: {
      x: shooter.position.x,
      y: shooter.position.y + EYE_HEIGHT,
      z: shooter.position.z,
    },
    direction: aimDirection(shooter.yaw, shooter.pitch),
  };
}

export function buildShotTrace(shooter: PlayerRecord, weapon: WeaponType, end?: Vector3): ShotTrace {
  const ray = buildAimRay(shooter);
  return {
    origin: ray.origin,
    end: end ?? pointOnRay(ray, COMBAT.hitscanMaxRange),
    speed: PROJECTILE_SPEEDS[weapon],
  };
}

export function classifyHitZone(hitPoint: Vector3, target: PlayerRecord): Exclude<DamageZone, "splash"> {
  const localY = hitPoint.y - target.position.y;
  if (localY >= DAMAGE_ZONE_HEIGHTS.headMinY) return "head";
  if (localY < DAMAGE_ZONE_HEIGHTS.legsMaxY) return "legs";
  return "body";
}

function distancePointToPlayerAabb(point: Vector3, player: PlayerRecord): number {
  const bounds = playerHitboxBounds(player.position);
  const closestX = Math.max(bounds.minX, Math.min(point.x, bounds.maxX));
  const closestY = Math.max(bounds.minY, Math.min(point.y, bounds.maxY));
  const closestZ = Math.max(bounds.minZ, Math.min(point.z, bounds.maxZ));
  return Math.hypot(point.x - closestX, point.y - closestY, point.z - closestZ);
}

export interface SplashCandidate {
  targetId: string;
  distance: number;
}

/** EPIC 36: true while the server clock is still inside the spawn-protection window. */
export function isSpawnProtected(
  player: Pick<PlayerRecord, "spawnProtectedUntilMs">,
  nowMs: number = Date.now(),
): boolean {
  return nowMs < player.spawnProtectedUntilMs;
}

export function findGrenadeSplashCandidates(
  explosionPoint: Vector3,
  shooterId: string,
  allPlayers: Iterable<PlayerRecord>,
  nowMs: number = Date.now(),
): SplashCandidate[] {
  const candidates: SplashCandidate[] = [];
  for (const candidate of allPlayers) {
    if (candidate.id === shooterId || !candidate.alive) continue;
    // EPIC 36: protected players are not splash targets (shots pass through —
    // no 0-damage hit event).
    if (isSpawnProtected(candidate, nowMs)) continue;
    const distance = distancePointToPlayerAabb(explosionPoint, candidate);
    if (distance <= GRENADE_SPLASH.radius) {
      candidates.push({ targetId: candidate.id, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.targetId.localeCompare(b.targetId));
  return candidates;
}

/**
 * Server-authoritative hitscan: builds a ray from the shooter's own
 * server-tracked position/yaw/pitch (never client-supplied — see
 * shared/src/index.ts FireEvent doc comment), then finds the NEAREST
 * intersection among BOTH map geometry (the shared ARENA_GEOMETRY list,
 * blocking-only) and every other alive player's approximate AABB hitbox
 * (shared playerHitboxBounds()). Whichever candidate is closest along the
 * ray wins: if a wall/crate sits closer than any player, the shot is
 * blocked and no player is hit — this is what makes Story 4.1's "a wall
 * blocks a shot at a player standing behind it" acceptance criterion hold,
 * without needing a separate occlusion pass.
 */
export function performHitscan(
  shooter: PlayerRecord,
  allPlayers: Iterable<PlayerRecord>,
  geometry: readonly MapBox[] = ARENA_GEOMETRY,
  nowMs: number = Date.now(),
): HitscanResult {
  const ray = buildAimRay(shooter);

  let nearestDistance: number = COMBAT.hitscanMaxRange;
  let nearestPlayerId: string | null = null;
  let nearestPlayer: PlayerRecord | null = null;
  let blockedByGeometry = false;

  // Map geometry: blocking-only, never itself a "hit" — but it can still be
  // the nearest candidate along the ray, which is what blocks a shot.
  for (const box of geometry) {
    const dist = rayIntersectsAabb(ray, boxBounds(box), nearestDistance);
    if (dist !== null && dist < nearestDistance) {
      nearestDistance = dist;
      nearestPlayerId = null;
      nearestPlayer = null;
      blockedByGeometry = true;
    }
  }

  for (const candidate of allPlayers) {
    if (candidate.id === shooter.id || !candidate.alive) continue;
    // EPIC 36: spawn-protected players are not hittable — ray continues as if
    // they were not there (ghost), so the shooter gets no hit marker/sound.
    if (isSpawnProtected(candidate, nowMs)) continue;
    const bounds = playerHitboxBounds(candidate.position);
    const dist = rayIntersectsAabb(ray, bounds, nearestDistance);
    if (dist !== null && dist < nearestDistance) {
      nearestDistance = dist;
      nearestPlayerId = candidate.id;
      nearestPlayer = candidate;
      blockedByGeometry = false;
    }
  }

  const point = pointOnRay(ray, nearestDistance);
  const trace = buildShotTrace(shooter, shooter.equippedWeapon, point);
  if (nearestPlayerId === null) {
    return {
      hitPlayerId: null,
      point: blockedByGeometry ? point : null,
      hitZone: null,
      blockedByGeometry,
      trace,
    };
  }

  return {
    hitPlayerId: nearestPlayerId,
    point,
    hitZone: nearestPlayer ? classifyHitZone(point, nearestPlayer) : "body",
    blockedByGeometry: false,
    trace,
  };
}

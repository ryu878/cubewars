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
  EYE_HEIGHT,
  type Ray,
  type Vector3,
} from "@cubewars/shared";
import type { PlayerRecord } from "./playerRegistry.js";

export interface HitscanResult {
  hitPlayerId: string | null;
  point: Vector3 | null;
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
): HitscanResult {
  const origin: Vector3 = {
    x: shooter.position.x,
    y: shooter.position.y + EYE_HEIGHT,
    z: shooter.position.z,
  };
  const direction = aimDirection(shooter.yaw, shooter.pitch);
  const ray: Ray = { origin, direction };

  let nearestDistance: number = COMBAT.hitscanMaxRange;
  let nearestPlayerId: string | null = null;

  // Map geometry: blocking-only, never itself a "hit" — but it can still be
  // the nearest candidate along the ray, which is what blocks a shot.
  for (const box of ARENA_GEOMETRY) {
    const dist = rayIntersectsAabb(ray, boxBounds(box), nearestDistance);
    if (dist !== null && dist < nearestDistance) {
      nearestDistance = dist;
      nearestPlayerId = null;
    }
  }

  for (const candidate of allPlayers) {
    if (candidate.id === shooter.id || !candidate.alive) continue;
    const bounds = playerHitboxBounds(candidate.position);
    const dist = rayIntersectsAabb(ray, bounds, nearestDistance);
    if (dist !== null && dist < nearestDistance) {
      nearestDistance = dist;
      nearestPlayerId = candidate.id;
    }
  }

  if (nearestPlayerId === null) {
    return { hitPlayerId: null, point: null };
  }

  const point: Vector3 = {
    x: origin.x + direction.x * nearestDistance,
    y: origin.y + direction.y * nearestDistance,
    z: origin.z + direction.z * nearestDistance,
  };
  return { hitPlayerId: nearestPlayerId, point };
}

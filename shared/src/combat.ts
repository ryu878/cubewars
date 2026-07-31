// Shared combat/hitscan constants and raycast-vs-AABB helper (EPIC 4
// "Shooting & Combat"). Consumed by the server for authoritative hit
// resolution (server/src/combat.ts) and by the client for aim-related
// constants that must agree with server-side validation (eye height, pitch
// clamp) — see individual export doc comments for which side uses what.
//
// Player hitboxes are approximated as axis-aligned bounding boxes matching
// the same capsule dimensions the client renders for other players
// (client/src/remotePlayers.ts) — NOT a true capsule/cylinder intersection
// test. This is a deliberate, documented simplification: EPIC 4's spec
// explicitly allows "simple capsule/AABB approximation" for player hitboxes,
// and the fixed stack rules out a physics engine for hit detection
// (global-standards.mdc: "hand-rolled raycast/AABB, no full physics engine
// by default"). The AABB is the capsule's own tight bounding box (same
// radius, same total feet-to-head height), so the approximation is exact at
// the box corners' worst case only near the capsule's rounded caps/sides —
// acceptable for a casual arena shooter.

import type { Vector3 } from "./types.js";
import type { AabbBounds } from "./mapData.js";

/**
 * Vertical eye offset applied to a player's feet position (position.y) to
 * get the camera/aim origin. Shared so the server's hitscan ray starts from
 * the same height the client actually renders as its own first-person
 * viewpoint (client/src/fpsController.ts) — one definition, not duplicated.
 */
export const EYE_HEIGHT = 1.7;

/**
 * Clamp bound for look pitch (radians), shared so the server's own
 * authoritative pitch tracking (server/src/playerRegistry.ts) clamps
 * identically to the client's mouse-look clamp (client/src/fpsController.ts)
 * — otherwise a client could claim a pitch the server would compute a
 * different aim ray for.
 */
export const MAX_PITCH = Math.PI / 2 - 0.05;

/** Horizontal radius of the capsule used for both rendering (RemotePlayers) and the server's hitscan AABB approximation. */
export const PLAYER_HITBOX_RADIUS = 0.5;

/** Cylinder portion length of the rendered capsule (excludes the two hemisphere caps) — see client/src/remotePlayers.ts CapsuleGeometry usage. */
export const PLAYER_HITBOX_CYLINDER_LENGTH = 1.2;

/** Full feet-to-head height of the hitscan AABB, matching the rendered capsule's total extent (radius + cylinder + radius). */
export const PLAYER_HITBOX_HEIGHT = PLAYER_HITBOX_CYLINDER_LENGTH + 2 * PLAYER_HITBOX_RADIUS;

/**
 * Tunable combat constants — one definition for both server enforcement and
 * any client-side display/prediction. Weapon-specific damage/fire-cooldown/
 * ammo (EPIC 6 "Weapons & Ammo") live in shared/src/weapons.ts's
 * WEAPON_STATS instead of here — this file keeps only what applies
 * regardless of which weapon is equipped.
 */
export const COMBAT = {
  /** Starting/max health, in HP. */
  maxHealth: 100,
  /** Delay between death and automatic respawn, ms. */
  respawnDelayMs: 3000,
  /** Maximum hitscan ray length, in world units. Comfortably exceeds the arena's ~105-unit diagonal (shared/src/mapData.ts ARENA_BOUNDS) so no in-bounds shot is ever truncated early. */
  hitscanMaxRange: 150,
} as const;

export interface Ray {
  /** World-space ray start. */
  origin: Vector3;
  /** Must be a unit vector. */
  direction: Vector3;
}

/**
 * Slab-method ray-vs-AABB intersection test. Returns the distance along the
 * ray to the nearest entry point if the ray hits `bounds` within
 * [0, maxDistance], otherwise null.
 *
 * Used for BOTH map geometry (server/src/combat.ts against the shared
 * ARENA_GEOMETRY boxes, via mapData.ts's boxBounds()) and player hitboxes
 * (via playerHitboxBounds() below) — one implementation for both candidate
 * kinds, consistent with mapData.ts's "do not hand-roll a second copy of
 * collision math" principle.
 */
export function rayIntersectsAabb(ray: Ray, bounds: AabbBounds, maxDistance: number): number | null {
  let tMin = 0;
  let tMax = maxDistance;

  const axes: Array<{ origin: number; dir: number; min: number; max: number }> = [
    { origin: ray.origin.x, dir: ray.direction.x, min: bounds.minX, max: bounds.maxX },
    { origin: ray.origin.y, dir: ray.direction.y, min: bounds.minY, max: bounds.maxY },
    { origin: ray.origin.z, dir: ray.direction.z, min: bounds.minZ, max: bounds.maxZ },
  ];

  for (const { origin, dir, min, max } of axes) {
    if (Math.abs(dir) < 1e-9) {
      // Ray is (near-)parallel to this axis's slab: only a hit if the
      // origin already lies within the slab on this axis.
      if (origin < min || origin > max) return null;
      continue;
    }

    const invDir = 1 / dir;
    let t1 = (min - origin) * invDir;
    let t2 = (max - origin) * invDir;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin;
}

/** Build the AABB hitbox for a player currently standing/airborne with feet at `feetPosition` (i.e. `position.y` as tracked in PlayerRecord/PlayerState). */
export function playerHitboxBounds(feetPosition: Vector3): AabbBounds {
  return {
    minX: feetPosition.x - PLAYER_HITBOX_RADIUS,
    maxX: feetPosition.x + PLAYER_HITBOX_RADIUS,
    minY: feetPosition.y,
    maxY: feetPosition.y + PLAYER_HITBOX_HEIGHT,
    minZ: feetPosition.z - PLAYER_HITBOX_RADIUS,
    maxZ: feetPosition.z + PLAYER_HITBOX_RADIUS,
  };
}

// Shared AABB collision resolution (EPIC 3 Story 3.3) — used by BOTH the
// client's local prediction (client/src/fpsController.ts) and the server's
// authoritative simulation (server/src/playerRegistry.ts), against the
// exact same ARENA_GEOMETRY list. One implementation, not duplicated —
// this is what actually guarantees client feel and server authority never
// disagree about where a wall is.
//
// Deliberately simple, per "prefer simple and reliable architecture"
// (global-standards.mdc) and the EPIC 3 risk note ruling out a physics
// engine for this map: the player is treated as a vertical
// cylinder/point of fixed horizontal radius, and collision is resolved
// purely on the x/z plane (Y — gravity/jump/ground — is untouched by this
// function). That also means every box in ARENA_GEOMETRY, including
// crates, is a *full-height* blocking obstacle: crates are cover you walk
// around, not cover you can vault/climb onto (documented "blocking, not
// climbable" choice for this EPIC — see EPIC 3 handoff). Both outer
// walls and crates are taller (or, for crates, at least as tall) than the
// ~1m max jump height this game's MOVEMENT constants allow, so treating
// them uniformly doesn't create a visibly "wrong" wall-vs-crate feel.

import { ARENA_GEOMETRY, boxBounds, type MapBox } from "./mapData.js";

/** Horizontal collision radius applied to both client prediction and server authority. */
export const PLAYER_COLLISION_RADIUS = 0.4;

/**
 * How many times to sweep all boxes and push the point out of any it still
 * overlaps. One pass resolves a single overlapping box correctly; extra
 * passes let a point pushed out of one box settle correctly if that push
 * lands it inside a second, neighboring box (e.g. near a corner) — without
 * needing a full physics solver.
 */
const RESOLUTION_PASSES = 3;

/**
 * Push (x, z) out of every box in `boxes` (default: the whole arena) that
 * it currently overlaps (box footprint expanded by `radius`), along the
 * axis of least penetration. Returns a point that is guaranteed clear of
 * every box's expanded footprint. Y is not read or modified.
 */
export function resolveHorizontalCollisions(
  x: number,
  z: number,
  radius: number = PLAYER_COLLISION_RADIUS,
  boxes: readonly MapBox[] = ARENA_GEOMETRY,
): { x: number; z: number } {
  let px = x;
  let pz = z;

  for (let pass = 0; pass < RESOLUTION_PASSES; pass++) {
    for (const box of boxes) {
      const bounds = boxBounds(box);
      const minX = bounds.minX - radius;
      const maxX = bounds.maxX + radius;
      const minZ = bounds.minZ - radius;
      const maxZ = bounds.maxZ + radius;

      // Strictly-inside check: a point exactly on the boundary is treated
      // as clear (avoids jitter from resolving a no-op "collision").
      if (px <= minX || px >= maxX || pz <= minZ || pz >= maxZ) {
        continue;
      }

      const pushLeft = px - minX;
      const pushRight = maxX - px;
      const pushDown = pz - minZ;
      const pushUp = maxZ - pz;

      const smallestX = Math.min(pushLeft, pushRight);
      const smallestZ = Math.min(pushDown, pushUp);

      if (smallestX < smallestZ) {
        px = pushLeft < pushRight ? minX : maxX;
      } else {
        pz = pushDown < pushUp ? minZ : maxZ;
      }
    }
  }

  return { x: px, z: pz };
}

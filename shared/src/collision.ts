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
// ~1m max jump height a normal (un-boosted) jump reaches with this game's
// MOVEMENT constants, so treating them uniformly doesn't create a visibly
// "wrong" wall-vs-crate feel. EPIC 8's bunny-hop boost can push a player
// higher than that baseline mid-air, but since this function is Y-agnostic
// (resolves purely on x/z, at ANY height — see above), a boosted hop still
// cannot carry a player over/through a wall or crate: the horizontal
// footprint stays blocked regardless of how high the player currently is.

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
 * EPIC 8 F-001 / backlog "collision corner pop" tightening (originally
 * flagged EPIC 3, `docs/backlog.md`): a defensive final ceiling on how far
 * a single call to this function is ever allowed to move a point, applied
 * after the resolution loop below regardless of how many boxes/passes were
 * involved. This is intentionally a generous, speed-independent constant
 * rather than the game's actual current per-tick movement cap (importing
 * MOVEMENT/BUNNY_HOP from ./index.js here would create a circular import,
 * since index.ts itself re-exports this file) — comfortably above the
 * largest legitimate single-call straight-into-a-flat-wall correction this
 * function is ever actually asked to resolve. Since EPIC 11 Story 11.1,
 * every tick-movement caller (server stepPlayer(), client fpsController.ts)
 * goes through resolveSteppedMovement() below, which never feeds this
 * function a proposed displacement larger than maxStepDistance (default
 * 0.4m, see DEFAULT_MAX_STEP_DISTANCE) regardless of the game's current top
 * speed — so 0.6 stays a comfortable, speed-independent ceiling at 13.3/
 * ~17.3 m/s (EPIC 11) exactly as it was at the older 6.65/8.645 m/s (EPIC
 * 8) values; it does not need re-tuning every time MOVEMENT.maxSpeed
 * changes. Ordinary high-speed flat-wall collision is never affected by
 * this ceiling, while still bounding truly pathological multi-box
 * cascades. See resolveHorizontalCollisions()'s doc comment for the
 * primary fix (accurate circular corner resolution), which is what
 * actually addresses the dominant source of corner-pop overshoot; this
 * constant is a backstop, not the main mechanism.
 */
const MAX_SINGLE_CALL_RESOLUTION_DISTANCE = 0.6;

/**
 * Push (x, z) out of every box in `boxes` (default: the whole arena) that
 * it currently overlaps (box footprint expanded by `radius`), returning a
 * point clear of every box's radius-expanded footprint. Y is not read or
 * modified.
 *
 * EPIC 8 F-001 (`docs/tasks/epic-08-critic-review.md`) / backlog "collision
 * corner pop" (originally EPIC 3 F-NB-1, `docs/backlog.md`): near a box's
 * true corner, the correct expanded (Minkowski) boundary around a
 * circular-radius player is a quarter-circle arc, not a square corner. The
 * previous version of this function always treated the expanded footprint
 * as a square (uniformly padding every edge by `radius`) and always
 * resolved via a single-axis snap (push straight out along whichever axis
 * had the smaller penetration) even when the point was actually in that
 * squared-off corner region. Two problems followed: (1) the square corner
 * over-covers the true circular boundary, so a point that was never really
 * touching the player-sized circle around that corner could still be
 * flagged as overlapping and get pushed for no reason; (2) when a real push
 * *was* needed near a corner, snapping fully along a single axis can land
 * far from the true nearest valid point, moving the player farther in one
 * tick than the actual movement that tick ever covered — the measured
 * "corner pop" overshoot (see `scripts/regression-collision-overshoot.ts`).
 *
 * Fix: for each box, first find the closest point on the box's true
 * (unexpanded) surface via axis clamping. If the point being resolved is
 * outside that true surface on at least one axis, the clamped point is the
 * exact nearest boundary point (a face point if only one axis needed
 * clamping, the exact corner vertex if both did) — resolve with the real
 * circular check against that point (push out to `radius` along the
 * straight line from it, or do nothing at all if the true circular
 * boundary isn't actually overlapped). Only when the point is genuinely
 * inside the box's true solid extent on both axes (deep penetration, no
 * well-defined single nearest surface point via clamping) does this fall
 * back to the original least-penetration single-axis push — unchanged from
 * before, and the common case for straight-on wall/crate collision away
 * from any corner, so ordinary flat-wall collision feel is unaffected.
 *
 * A final generous, speed-independent distance ceiling
 * (MAX_SINGLE_CALL_RESOLUTION_DISTANCE above) still applies on top as a
 * defensive backstop. Two true walls meeting at a genuine sharp physical
 * corner (e.g. the arena's outer boundary corners, where two wall boxes
 * physically join) can still produce a non-collinear, larger-than-nominal
 * single-tick correction at the highest current movement speed (boosted
 * bunny hop) — this residual is an inherent limitation of resolving
 * collision from an already-tunneled-past-the-corner position rather than
 * stopping motion at first contact (true continuous/swept collision
 * detection), which is out of scope here (would be a rewrite, not a
 * tightening). See the regression script for the measured numbers.
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

      // Closest point on the box's true (unexpanded) surface, found by
      // clamping each axis independently.
      const closestX = Math.min(Math.max(px, bounds.minX), bounds.maxX);
      const closestZ = Math.min(Math.max(pz, bounds.minZ), bounds.maxZ);

      if (closestX !== px || closestZ !== pz) {
        // At least one axis was clamped: the point is outside the box's
        // true surface (a face point if one axis was clamped, the exact
        // corner vertex if both were) — resolve with the real circular
        // check instead of an axis snap. See doc comment above.
        const dx = px - closestX;
        const dz = pz - closestZ;
        const dist = Math.hypot(dx, dz);
        if (dist >= radius) {
          // Square-footprint pre-check false positive near a corner: the
          // true circular boundary isn't actually overlapped here.
          continue;
        }
        if (dist > 1e-9) {
          const scale = radius / dist;
          px = closestX + dx * scale;
          pz = closestZ + dz * scale;
        }
        // else: degenerate (sitting exactly on the surface point, no
        // well-defined push direction) — leave position as-is.
        continue;
      }

      // Both axes already within the box's true solid extent (deep
      // penetration, no single nearest surface point via clamping): fall
      // back to the original least-penetration single-axis push.
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

  // Defensive backstop (see MAX_SINGLE_CALL_RESOLUTION_DISTANCE doc
  // comment above): bound the total displacement this call ever applies,
  // regardless of how many boxes/passes were involved.
  const totalDx = px - x;
  const totalDz = pz - z;
  const totalDisplacement = Math.hypot(totalDx, totalDz);
  if (totalDisplacement > MAX_SINGLE_CALL_RESOLUTION_DISTANCE) {
    const scale = MAX_SINGLE_CALL_RESOLUTION_DISTANCE / totalDisplacement;
    px = x + totalDx * scale;
    pz = z + totalDz * scale;
  }

  return { x: px, z: pz };
}

/**
 * Default sub-step distance cap for resolveSteppedMovement() below (EPIC 11
 * Story 11.1). Matches PLAYER_COLLISION_RADIUS (0.4) — comfortably under the
 * map's thinnest wall (1 unit, shared/src/mapData.ts), giving a real safety
 * margin rather than cutting it close, while still keeping the sub-step
 * count small (and therefore cheap) at every speed this game currently
 * tunes for. See resolveSteppedMovement()'s doc comment for why a single
 * fixed constant, rather than a per-call default tied to current MOVEMENT
 * values, is the right shape here (this file cannot import ./index.js —
 * circular import, same reasoning as MAX_SINGLE_CALL_RESOLUTION_DISTANCE
 * above).
 */
const DEFAULT_MAX_STEP_DISTANCE = PLAYER_COLLISION_RADIUS;

/**
 * EPIC 11 Story 11.1 "substep collision safety": resolve a single tick's
 * proposed horizontal movement (`deltaX`, `deltaZ` from `startX`, `startZ`)
 * in several smaller sub-steps instead of one single `resolveHorizontalCollisions`
 * call, so a fast-moving player can never cross a thin wall in one tick
 * without collision catching it.
 *
 * Why this is needed: `resolveHorizontalCollisions` only ever looks at the
 * PROPOSED END point of a move, not the path swept to get there — it was
 * designed and tuned (EPIC 3, tightened EPIC 8 for corner-pop) around
 * per-tick displacements that stay well under a wall's thickness. At EPIC 11's
 * new top speed, a single tick's raw displacement can exceed a wall's 1-unit
 * thickness (see EPIC 11 spec Section 3), so evaluating collision only at the
 * final point risks resolving the player onto the far side of a wall it
 * should have stopped at. Splitting the same total displacement into several
 * smaller sub-steps, each individually small relative to wall thickness, and
 * resolving collision after EVERY sub-step (feeding each result forward as
 * the next sub-step's start) keeps every intermediate position honest: a
 * sub-step that would tunnel into/through a wall gets caught and stopped by
 * `resolveHorizontalCollisions` right there, and the remaining sub-steps for
 * this tick simply don't get to happen (the player stays put, exactly as
 * hitting a wall mid-stride should feel).
 *
 * This does not replace `resolveHorizontalCollisions` — it is a thin
 * wrapper that calls it multiple times per tick. Both the server's
 * authoritative `stepPlayer()` (server/src/playerRegistry.ts) and the
 * client's local prediction (client/src/fpsController.ts) call this SAME
 * helper (never resolveHorizontalCollisions directly for a full tick's
 * movement) so both stay on one shared, single implementation of "how a
 * tick's movement is resolved" — the same discipline as MOVEMENT/
 * ARENA_GEOMETRY elsewhere in this codebase.
 *
 * @param maxStepDistance Upper bound on how far any single sub-step is
 *   allowed to move the point before being resolved against collision.
 *   Defaults to DEFAULT_MAX_STEP_DISTANCE (0.4, matches
 *   PLAYER_COLLISION_RADIUS) — a deliberately round, comfortably-safe
 *   margin under the map's thinnest wall (1 unit). The number of sub-steps
 *   is `Math.ceil(totalDistance / maxStepDistance)`, minimum 1, so an
 *   ordinary walking-speed tick (well under maxStepDistance) costs exactly
 *   the same single `resolveHorizontalCollisions` call as before this
 *   function existed — sub-stepping is only ever paid for when the
 *   proposed movement is actually large enough to need it.
 */
export function resolveSteppedMovement(
  startX: number,
  startZ: number,
  deltaX: number,
  deltaZ: number,
  radius: number = PLAYER_COLLISION_RADIUS,
  boxes: readonly MapBox[] = ARENA_GEOMETRY,
  maxStepDistance: number = DEFAULT_MAX_STEP_DISTANCE,
): { x: number; z: number } {
  const totalDistance = Math.hypot(deltaX, deltaZ);

  // No proposed movement at all (or a degenerate/non-finite delta) — nothing
  // to sub-step, but still resolve once so a caller passing a starting point
  // that's already overlapping something (shouldn't normally happen, but
  // defensive) gets pushed clear, matching resolveHorizontalCollisions'
  // own single-call behavior.
  if (!(totalDistance > 0)) {
    return resolveHorizontalCollisions(startX, startZ, radius, boxes);
  }

  const stepCount = Math.max(1, Math.ceil(totalDistance / maxStepDistance));
  const stepDx = deltaX / stepCount;
  const stepDz = deltaZ / stepCount;

  let px = startX;
  let pz = startZ;
  for (let i = 0; i < stepCount; i++) {
    const proposedX = px + stepDx;
    const proposedZ = pz + stepDz;
    const resolved = resolveHorizontalCollisions(proposedX, proposedZ, radius, boxes);
    px = resolved.x;
    pz = resolved.z;
  }

  return { x: px, z: pz };
}

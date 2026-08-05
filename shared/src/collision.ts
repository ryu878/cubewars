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
// cylinder/point of fixed horizontal radius, and resolveHorizontalCollisions
// itself resolves purely on the x/z plane (Y — gravity/jump/ground — is not
// read or modified by that function).
//
// EPIC 12 "Jumpable Crates" update: walls (kind: "wall") are still always
// full-height blocking obstacles — never climbable, regardless of jump
// height. Crates (kind: "crate"), however, are now HEIGHT-AWARE: a crate
// only blocks horizontal movement while the player's feet are below its top
// surface (see boxesBlockingAt() below); once a player's feet rise above a
// crate's top (raised jump apex, see MOVEMENT.jumpSpeed doc comment,
// shared/src/index.ts), that crate stops blocking them and instead supports
// them from below (see crateTopHeightAt() below) — crates are climbable
// platforms, not just full-height cover. This reverses the EPIC 3-era
// "crates are full-height blocking, not climbable" simplification, which
// was only valid while max jump height (1.0m) was strictly below
// CRATE_HEIGHT (1.2m); EPIC 12 raised jump height specifically so this
// height-aware behavior would be reachable in practice.
//
// resolveHorizontalCollisions() itself remains Y-agnostic (it has no Y
// parameter) — height-awareness lives one level up, in which `boxes` list a
// caller passes in for a given tick (filtered by boxesBlockingAt() at the
// player's current feet height), not inside this function's own box-overlap
// math.

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

/**
 * EPIC 12 "Jumpable Crates" Story 12.1: filter `boxes` (default:
 * ARENA_GEOMETRY) down to only the boxes that block horizontal movement at a
 * given feet height `feetY`.
 *
 * - Walls (`kind: "wall"`) always block, at any height — they are never
 *   climbable, regardless of jump height (see this file's top-of-file
 *   comment).
 * - Crates (`kind: "crate"`) only block while the player's feet are
 *   strictly below that crate's own top surface (`feetY < boxBounds(box).maxY`).
 *   Once a player's feet are at or above a crate's top (standing on it, or
 *   higher, e.g. mid-jump above it), that specific crate no longer blocks
 *   horizontal movement — this is what lets a player drift over a crate's
 *   footprint once airborne above it, and walk freely once standing on top.
 *
 * At `feetY = 0` (ground level, the common case), every crate's top
 * (CRATE_HEIGHT = 1.2 > 0) still blocks, so the returned list is identical
 * to `boxes` itself — no behavior change for a player who never leaves the
 * ground, matching the pre-EPIC-12 behavior exactly.
 *
 * Callers (server `stepPlayer()`, client `fpsController.ts` `update()`) pass
 * the result of this function as the `boxes` argument to
 * `resolveSteppedMovement()`/`resolveHorizontalCollisions()` for a given
 * tick, using the player's feet height (`position.y`) at the START of that
 * tick (before this tick's own vertical integration) — this function itself
 * does not read or store any per-tick state.
 */
export function boxesBlockingAt(feetY: number, boxes: readonly MapBox[] = ARENA_GEOMETRY): MapBox[] {
  return boxes.filter((box) => box.kind === "wall" || feetY < boxBounds(box).maxY);
}

/**
 * EPIC 12 "Jumpable Crates" Story 12.2: the height of the highest crate top
 * surface standing under world point `(x, z)`, or `0` if `(x, z)` is not
 * over any crate.
 *
 * Only `kind: "crate"` boxes in `boxes` (default: ARENA_GEOMETRY) are
 * considered — walls are never standable surfaces (a player physically
 * cannot reach wall-top height, see MOVEMENT.jumpSpeed doc comment,
 * shared/src/index.ts), so this function does not need to (and does not)
 * look at them.
 *
 * A crate "supports" `(x, z)` if that point falls within the crate's XZ
 * footprint EXPANDED by `radius` (default: PLAYER_COLLISION_RADIUS) on every
 * side — the same "expand the box's true bounds by the player's collision
 * radius" pattern `resolveHorizontalCollisions` already uses for its own
 * push-out math. This is a deliberate consistency choice, not an arbitrary
 * generosity: it treats the player as the same collision circle whether a
 * crate is currently blocking them sideways (boxesBlockingAt above) or
 * supporting them from below, so a player whose center point has drifted a
 * few centimeters past the crate's raw edge — but whose body circle still
 * overlaps the top surface — does not feel like it falls through a phantom
 * gap right at the edge.
 *
 * If more than one crate's expanded footprint contains `(x, z)` (not
 * currently possible on the real ARENA_GEOMETRY — no two crates' radius-
 * expanded footprints overlap — but this function does not assume that),
 * the HIGHEST top surface among them wins.
 *
 * Callers combine this with MOVEMENT.groundY themselves:
 * `const groundHeight = Math.max(MOVEMENT.groundY, crateTopHeightAt(x, z));`
 * — this function deliberately does NOT import MOVEMENT itself, to avoid a
 * circular import (index.ts re-exports this file — same reasoning already
 * documented above for MAX_SINGLE_CALL_RESOLUTION_DISTANCE /
 * DEFAULT_MAX_STEP_DISTANCE).
 */
export function crateTopHeightAt(
  x: number,
  z: number,
  boxes: readonly MapBox[] = ARENA_GEOMETRY,
  radius: number = PLAYER_COLLISION_RADIUS,
): number {
  let highest = 0;
  for (const box of boxes) {
    if (box.kind !== "crate") continue;
    const bounds = boxBounds(box);
    const minX = bounds.minX - radius;
    const maxX = bounds.maxX + radius;
    const minZ = bounds.minZ - radius;
    const maxZ = bounds.maxZ + radius;
    // Strictly-inside check, deliberately matching resolveHorizontalCollisions'
    // own "a point exactly on the boundary is treated as clear" convention
    // (see its doc comment above): a player resting exactly at a crate's
    // radius-expanded SIDE boundary (blocked horizontally, per
    // boxesBlockingAt above, but not yet past the edge) must NOT register as
    // "supported from below" here, or it would incorrectly snap up onto the
    // crate's top while still just standing at ground level against its
    // side — verified against exactly this edge case by
    // scripts/regression-crate-mount.ts case (a).
    if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;
    if (bounds.maxY > highest) {
      highest = bounds.maxY;
    }
  }
  return highest;
}

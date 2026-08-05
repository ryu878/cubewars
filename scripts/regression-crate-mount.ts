// EPIC 12 "Jumpable Crates" Story 12.3 regression/evidence script: drives a
// minimal, deterministic tick loop against the REAL shared constants/helpers
// (MOVEMENT, boxesBlockingAt, crateTopHeightAt, resolveSteppedMovement,
// BROADCAST_TICK_HZ, ARENA_GEOMETRY) that mirrors the exact per-tick
// vertical/horizontal step order Story 12.2 specifies for both
// server/src/playerRegistry.ts stepPlayer() and
// client/src/fpsController.ts update() — a second, verification-only copy of
// that tick math, same pattern the EPIC 8/11 regression scripts already use
// (scripts/regression-collision-overshoot.ts,
// scripts/regression-bot-aim-miss-rate.ts) rather than importing either
// caller's private method directly.
//
// IMPORTANT measured finding (read before changing the mount technique
// below): at this game's real numbers (MOVEMENT.maxSpeed = 13.3 m/s,
// MOVEMENT.jumpSpeed = 7.5 m/s, gravity = 18 m/s^2), the time a jumping
// player's feet stay above CRATE_HEIGHT (1.2m) is ~0.40s (root of
// jumpSpeed*t - 0.5*gravity*t^2 = CRATE_HEIGHT, both roots). At 13.3 m/s
// that is ~5.3m of horizontal travel — MORE than any crate's full
// radius-expanded footprint (<=2.8m). This means a player who holds the
// forward key for the ENTIRE jump arc (a literal, uninterrupted "hold W and
// jump") always sails clean over any crate on this map — never lands on
// top. The technique that DOES work, and the one this script measures and
// asserts on: approach until blocked at the crate's side (exactly Story
// 12.1's ground-level "cover" behavior), jump, and RELEASE forward
// mid-flight (a normal, non-frame-perfect human action — see the measured
// release-timing windows below, ~150-250ms wide depending on crate size,
// not a single-tick window). This matches how "hop onto a ledge" already
// tends to work in an FPS with no persisted air momentum (this game
// recomputes horizontal displacement fresh from input intent every tick,
// see BUNNY_HOP doc comment in shared/src/index.ts) — releasing forward
// mid-air simply stops horizontal drift, it does not need to "catch" a
// ledge via any special mantle logic.
//
// Covers, against real crate ids from the real ARENA_GEOMETRY (one 2x2 crate
// - crate_a1 - and one 1.5x1.5 crate - crate_mid1, per Story 12.3's minimum
// coverage requirement):
//   (a) Ground-level approach without jumping stays blocked at the crate's
//       radius-expanded side.
//   (b) A running-jump approach (approach + jump + release-forward
//       mid-flight, per the finding above) lands the simulated player
//       standing on top (position.y == CRATE_HEIGHT), searched across a
//       range of forward-release timings to measure the real (not
//       frame-perfect) working window.
//   (c) Walking off the mounted crate's edge (forward re-engaged, no
//       further jump) falls back to position.y == 0 via a smooth decreasing
//       sequence, not a snap.
//   (d) A jump-input tick immediately after leaving support (still mid-fall)
//       does NOT apply MOVEMENT.jumpSpeed — the deterministic check for the
//       `else { grounded = false }` fix in Story 12.2.
//
// Run: npx tsx scripts/regression-crate-mount.ts
// (or `npm run regression:crate-mount` from the repo root)
//
// Exit code is non-zero if any of the four coverage cases fails, for any of
// the tested crates.

import {
  ARENA_GEOMETRY,
  BROADCAST_TICK_HZ,
  MOVEMENT,
  PLAYER_COLLISION_RADIUS,
  boxBounds,
  boxesBlockingAt,
  crateTopHeightAt,
  resolveSteppedMovement,
  type MapBox,
} from "@cubewars/shared";

const TICK_DT_SECONDS = 1 / BROADCAST_TICK_HZ;
const CRATE_TOP_EPSILON = 1e-6;

// Crate ids under test: one 2x2 (Site A cover) and one 1.5x1.5 (mid-lane
// cover), per Story 12.3's minimum coverage requirement.
const TESTED_CRATE_IDS = ["crate_a1", "crate_mid1"];

/** Minimal simulated player state — mirrors the fields both real callers
 * (server PlayerRecord, client FpsController) actually read/mutate for this
 * subset of the tick logic. */
interface SimPlayer {
  x: number;
  z: number;
  y: number;
  velocityY: number;
  grounded: boolean;
}

function freshPlayer(x: number, z: number): SimPlayer {
  return { x, z, y: MOVEMENT.groundY, velocityY: 0, grounded: true };
}

function clonePlayer(p: SimPlayer): SimPlayer {
  return { ...p };
}

/**
 * One simulated tick, mirroring stepPlayer()/fpsController.ts update()'s
 * shared order EXACTLY (this is the "second, verification-only copy" the
 * top-of-file comment above refers to):
 *   1. boxesBlockingAt(feetY at tick start) -> resolveSteppedMovement()
 *   2. jump trigger (only if grounded) + gravity integration
 *   3. groundHeight = max(groundY, crateTopHeightAt(post-horizontal x, z))
 *   4. clamp to groundHeight (grounded = true) OR else grounded = false
 */
function tick(p: SimPlayer, moveDx: number, moveDz: number, jumpInput: boolean): void {
  const feetYAtTickStart = p.y;
  const blockingBoxes = boxesBlockingAt(feetYAtTickStart);
  const resolved = resolveSteppedMovement(
    p.x,
    p.z,
    moveDx * TICK_DT_SECONDS,
    moveDz * TICK_DT_SECONDS,
    undefined,
    blockingBoxes,
  );
  p.x = resolved.x;
  p.z = resolved.z;

  if (jumpInput && p.grounded) {
    p.velocityY = MOVEMENT.jumpSpeed;
    p.grounded = false;
  }
  p.velocityY -= MOVEMENT.gravity * TICK_DT_SECONDS;
  p.y += p.velocityY * TICK_DT_SECONDS;

  const groundHeight = Math.max(MOVEMENT.groundY, crateTopHeightAt(p.x, p.z));
  if (p.y <= groundHeight) {
    p.y = groundHeight;
    p.velocityY = 0;
    p.grounded = true;
  } else {
    p.grounded = false;
  }
}

function findCrate(id: string): MapBox {
  const crate = ARENA_GEOMETRY.find((b) => b.id === id);
  if (!crate || crate.kind !== "crate") {
    throw new Error(`expected a crate box with id "${id}" in ARENA_GEOMETRY`);
  }
  return crate;
}

interface CaseResult {
  label: string;
  pass: boolean;
  detail: string;
}

/**
 * Run a player forward (+x) at MOVEMENT.maxSpeed, no jump input, until it
 * settles pinned against `blockingCrateBoxes`-filtered geometry (case (a)'s
 * "stays blocked" behavior) — used both as case (a) itself and as the
 * starting state for case (b)'s jump attempts (a real running approach, not
 * a teleport to the edge).
 */
function approachAndSettle(startX: number, z: number, ticks: number): SimPlayer {
  const p = freshPlayer(startX, z);
  for (let t = 0; t < ticks; t++) {
    tick(p, MOVEMENT.maxSpeed, 0, false);
  }
  return p;
}

function runCrateSuite(crateId: string): { crateId: string; results: CaseResult[] } {
  const crate = findCrate(crateId);
  const bounds = boxBounds(crate);
  const results: CaseResult[] = [];

  // Approach along +x, aligned in z with the crate's own center — a
  // straight-on running approach/jump, matching Story 12.2's "normal
  // running jump timed at/near a crate's edge" mount flow.
  const approachZ = crate.center.z;
  const blockedEdgeX = bounds.minX - PLAYER_COLLISION_RADIUS; // radius-expanded boundary at ground level
  const APPROACH_START_X = blockedEdgeX - 6; // well clear, outside any resolution radius
  const APPROACH_SETTLE_TICKS = 100; // comfortably more than enough ticks to cross 6m at maxSpeed and settle against the blocked edge

  // --- Case (a): ground-level approach without jumping stays blocked ---
  let maxXReachedDuringApproach = APPROACH_START_X;
  {
    const p = freshPlayer(APPROACH_START_X, approachZ);
    for (let t = 0; t < APPROACH_SETTLE_TICKS; t++) {
      tick(p, MOVEMENT.maxSpeed, 0, false);
      if (p.x > maxXReachedDuringApproach) maxXReachedDuringApproach = p.x;
    }
    const neverEnteredFootprint = maxXReachedDuringApproach < bounds.minX - 1e-9;
    const restedNearBlockedEdge = Math.abs(p.x - blockedEdgeX) < 1e-2;
    const stayedGroundLevel = p.y === MOVEMENT.groundY;
    const pass = neverEnteredFootprint && restedNearBlockedEdge && stayedGroundLevel;
    results.push({
      label: "(a) ground-level approach stays blocked (no jump)",
      pass,
      detail: `after ${APPROACH_SETTLE_TICKS} ticks, settled at x=${p.x.toFixed(4)} (blocked edge=${blockedEdgeX.toFixed(4)}, crate raw minX=${bounds.minX.toFixed(4)}), max x reached=${maxXReachedDuringApproach.toFixed(4)}, y=${p.y.toFixed(4)}`,
    });
  }

  // --- Case (b): running jump lands the player standing on top ---
  // Real running approach (same as case (a)) settles the player pinned
  // against the crate's blocked edge, exactly as a player walking/running
  // into a crate at ground level would. From that rest position: jump, hold
  // forward for `holdTicksAfterJump` additional ticks (including the jump
  // tick itself), then release forward for the rest of the flight. Sweep
  // `holdTicksAfterJump` to measure the real (not frame-perfect) working
  // window — see the top-of-file comment for why forward MUST be released
  // at some point mid-flight at this game's real speed/jump numbers.
  interface MountAttempt {
    holdTicksAfterJump: number;
    landedOnTop: boolean;
    landedX: number;
    landedZ: number;
    landedY: number;
    ticksToLand: number;
    finalPlayer: SimPlayer;
  }

  function attemptMount(holdTicksAfterJump: number): MountAttempt {
    const p = clonePlayer(approachAndSettle(APPROACH_START_X, approachZ, APPROACH_SETTLE_TICKS));
    const MAX_TICKS = 60; // total flight time is ~0.83s (~17 ticks) at these numbers; generous ceiling
    let ticksToLand = -1;
    let t = 0;
    for (; t < MAX_TICKS; t++) {
      const jumpNow = t === 0; // press jump on the very first tick of this attempt (already pinned/grounded at the edge)
      const holdForward = t <= holdTicksAfterJump;
      tick(p, holdForward ? MOVEMENT.maxSpeed : 0, 0, jumpNow);
      if (t > 1 && p.grounded) {
        ticksToLand = t + 1;
        break;
      }
    }
    const onTop = crateTopHeightAt(p.x, p.z) > 0 && Math.abs(p.y - bounds.maxY) < CRATE_TOP_EPSILON;
    return {
      holdTicksAfterJump,
      landedOnTop: onTop,
      landedX: p.x,
      landedZ: p.z,
      landedY: p.y,
      ticksToLand,
      finalPlayer: p,
    };
  }

  const HOLD_TICKS_RANGE = Array.from({ length: 21 }, (_, i) => i); // 0..20 ticks (0 .. 1.0s) of held forward after the jump tick
  const attempts = HOLD_TICKS_RANGE.map(attemptMount);
  const successes = attempts.filter((a) => a.landedOnTop);
  const bestAttempt = successes[Math.floor(successes.length / 2)] ?? successes[0];

  {
    const pass = successes.length > 0;
    const windowTicks = successes.length;
    const windowSeconds = windowTicks * TICK_DT_SECONDS;
    const windowDesc =
      successes.length > 0
        ? `working "hold forward after jump" window: ${successes[0].holdTicksAfterJump}-${successes[successes.length - 1].holdTicksAfterJump} ticks after the jump tick (${windowTicks} ticks wide = ${windowSeconds.toFixed(2)}s of real timing margin, not frame-perfect)`
        : "no tested forward-release timing landed on top";
    const chosen = bestAttempt;
    results.push({
      label: "(b) running jump lands standing on top (position.y == CRATE_HEIGHT)",
      pass,
      detail:
        `${windowDesc}; representative success: holdTicksAfterJump=${chosen?.holdTicksAfterJump}, ` +
        `landed at (x=${chosen?.landedX.toFixed(3)}, z=${chosen?.landedZ.toFixed(3)}, y=${chosen?.landedY.toFixed(4)}) ` +
        `after ${chosen?.ticksToLand} ticks (crate top = ${bounds.maxY})`,
    });
  }

  if (!bestAttempt) {
    // Cannot proceed to (c)/(d) without a successful mount for this crate.
    results.push({ label: "(c) walk off edge falls back to y == 0 (smooth)", pass: false, detail: "skipped: no successful mount from case (b)" });
    results.push({ label: "(d) jump input while falling grants no extra jump", pass: false, detail: "skipped: no successful mount from case (b)" });
    return { crateId, results };
  }

  // --- Case (c): walking off the mounted crate's edge falls back to y==0,
  // via a smooth (multi-tick, monotonic-while-falling) sequence ---
  const pOnTop = clonePlayer(bestAttempt.finalPlayer);
  const fallSequence: { tick: number; y: number; grounded: boolean }[] = [];
  let leftSupportTickIndex = -1;
  let landedBackAtGroundTickIndex = -1;
  const MAX_WALKOFF_TICKS = 200;
  for (let t = 0; t < MAX_WALKOFF_TICKS; t++) {
    const wasGrounded = pOnTop.grounded;
    tick(pOnTop, MOVEMENT.maxSpeed, 0, false); // re-engage forward, walk off the far edge
    fallSequence.push({ tick: t, y: pOnTop.y, grounded: pOnTop.grounded });
    if (wasGrounded && !pOnTop.grounded && leftSupportTickIndex === -1) {
      leftSupportTickIndex = t;
    }
    if (leftSupportTickIndex !== -1 && pOnTop.grounded && pOnTop.y === MOVEMENT.groundY && landedBackAtGroundTickIndex === -1) {
      landedBackAtGroundTickIndex = t;
      break;
    }
  }

  {
    const leftSupport = leftSupportTickIndex !== -1;
    const landedAtGround = landedBackAtGroundTickIndex !== -1;
    const fallTickSpan = leftSupport && landedAtGround ? landedBackAtGroundTickIndex - leftSupportTickIndex : -1;
    // "Smooth" = took multiple ticks (not an instant one-tick teleport) and
    // y was monotonically non-increasing while airborne during the fall.
    const fallSlice = leftSupport && landedAtGround ? fallSequence.slice(leftSupportTickIndex, landedBackAtGroundTickIndex + 1) : [];
    let monotonic = true;
    for (let i = 1; i < fallSlice.length; i++) {
      if (fallSlice[i].y > fallSlice[i - 1].y + 1e-9) monotonic = false;
    }
    const pass = leftSupport && landedAtGround && fallTickSpan >= 2 && monotonic;
    results.push({
      label: "(c) walk off edge falls back to y == 0 (smooth)",
      pass,
      detail: `left support at tick ${leftSupportTickIndex}, landed at ground (y=0) at tick ${landedBackAtGroundTickIndex} (span=${fallTickSpan} ticks, monotonic=${monotonic})`,
    });
  }

  // --- Case (d): a jump-input tick immediately after leaving support
  // (still mid-fall) must NOT apply MOVEMENT.jumpSpeed ---
  {
    if (leftSupportTickIndex === -1) {
      results.push({ label: "(d) jump input while falling grants no extra jump", pass: false, detail: "skipped: player never left support in case (c)" });
    } else {
      // Re-simulate the mount + walk-off fresh (case (c)'s pOnTop was
      // consumed/mutated by its own loop above) so this case has its own
      // clean, deterministic run up to the same "just left support" point,
      // then on the tick immediately after leaving support, inject a jump
      // input and confirm it has no effect (still falling under gravity,
      // grounded stays false, no jumpSpeed re-application).
      const fresh = clonePlayer(attemptMount(bestAttempt.holdTicksAfterJump).finalPlayer);
      let leftSupportAt = -1;
      for (let t = 0; t < MAX_WALKOFF_TICKS; t++) {
        const wasGrounded = fresh.grounded;
        tick(fresh, MOVEMENT.maxSpeed, 0, false);
        if (wasGrounded && !fresh.grounded && leftSupportAt === -1) {
          leftSupportAt = t;
          break;
        }
      }
      if (leftSupportAt === -1) {
        results.push({ label: "(d) jump input while falling grants no extra jump", pass: false, detail: "could not reproduce leaving support" });
      } else {
        const velocityBeforeJumpTick = fresh.velocityY;
        const groundedBefore = fresh.grounded;
        const yBefore = fresh.y;
        tick(fresh, MOVEMENT.maxSpeed, 0, true); // jump input while still falling (grounded === false)
        const expectedVelocityIfNoJumpGranted = velocityBeforeJumpTick - MOVEMENT.gravity * TICK_DT_SECONDS;
        const jumpSpeedWasNotApplied = Math.abs(fresh.velocityY - expectedVelocityIfNoJumpGranted) < 1e-9;
        const stillFalling = !groundedBefore && fresh.y < yBefore + 1e-9 && !fresh.grounded;
        const pass = jumpSpeedWasNotApplied && stillFalling;
        results.push({
          label: "(d) jump input while falling grants no extra jump",
          pass,
          detail: `at tick after leaving support (grounded=false): velocityY before jump-input tick=${velocityBeforeJumpTick.toFixed(4)}, after=${fresh.velocityY.toFixed(4)} (expected, no jump granted: ${expectedVelocityIfNoJumpGranted.toFixed(4)}; MOVEMENT.jumpSpeed=${MOVEMENT.jumpSpeed} was NOT applied), grounded stayed=${fresh.grounded}`,
        });
      }
    }
  }

  return { crateId, results };
}

function main(): void {
  const apexHeight = (MOVEMENT.jumpSpeed * MOVEMENT.jumpSpeed) / (2 * MOVEMENT.gravity);
  console.log(
    `EPIC 12 Story 12.3 crate-mount regression — real ARENA_GEOMETRY, TICK_DT_SECONDS=${TICK_DT_SECONDS}s, MOVEMENT.maxSpeed=${MOVEMENT.maxSpeed}, MOVEMENT.jumpSpeed=${MOVEMENT.jumpSpeed} (apex=${apexHeight.toFixed(4)}m), PLAYER_COLLISION_RADIUS=${PLAYER_COLLISION_RADIUS}\n`,
  );

  let anyFailed = false;
  for (const crateId of TESTED_CRATE_IDS) {
    const crate = findCrate(crateId);
    const bounds = boxBounds(crate);
    console.log(`--- Crate "${crateId}" (${crate.size.x}x${crate.size.z}, top=${bounds.maxY}) ---`);
    const { results } = runCrateSuite(crateId);
    for (const r of results) {
      if (!r.pass) anyFailed = true;
      console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.label}\n        ${r.detail}`);
    }
    console.log("");
  }

  console.log(
    anyFailed
      ? "FAIL: one or more crate-mount regression cases failed (see above)."
      : "PASS: all crate-mount regression cases passed for every tested crate.",
  );
  process.exit(anyFailed ? 1 : 0);
}

main();

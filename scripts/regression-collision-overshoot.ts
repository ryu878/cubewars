// EPIC 8 F-001 regression script (`docs/tasks/epic-08-critic-review.md`) for
// the collision "corner pop" issue (originally EPIC 3 F-NB-1,
// `docs/backlog.md`): brute-force-sweeps every box corner in the real
// production `ARENA_GEOMETRY` and, at the game's relevant horizontal move
// speeds (pre-EPIC-8 baseline, EPIC 8's base + boosted bunny hop, and
// EPIC 11's new base + boosted bunny hop), measures the worst single-tick
// "overshoot" that the real `resolveHorizontalCollisions()`
// (shared/src/collision.ts) produces at the server's real broadcast tick dt.
//
// EPIC 11 Story 11.1/Task 5 extension: the EPIC 8-era speeds are measured
// exactly as before, unchanged, still calling `resolveHorizontalCollisions()`
// directly (single-step, no sub-stepping) — this is what quantifies the
// residual corner-pop overshoot that motivated EPIC 11's substep fix in the
// first place. The new EPIC 11 speeds (13.3 m/s base, ~17.3 m/s boosted
// bunny hop — the user's "2x to start" ask, corrected down from an earlier
// 5x during this EPIC, see EPIC 11 spec Section 2) are measured BOTH ways:
// once through the same raw single-step `resolveHorizontalCollisions()`
// call (to show what naively scaling the old approach to the new speed
// would have produced), and once through the real `resolveSteppedMovement()`
// helper (shared/src/collision.ts, EPIC 11 Story 11.1) that the game
// actually ships with at these speeds — this second measurement is the real
// safety evidence for EPIC 11's acceptance criteria. The substep helper
// ships regardless of the exact multiplier, as a proactive safety margin
// for future speed increases (EPIC 11 spec Section 9 risk note), not just a
// reaction to 2x specifically.
//
// Methodology (matches how Tester/Critic reproduced this since EPIC 3):
// pick a starting point P0 that `resolveHorizontalCollisions` itself
// already reports as clear ("resolved" state, i.e. a legitimate position a
// player could actually be resting at), propose a straight-line move of
// exactly `speed * TICK_DT_SECONDS` (the nominal, unobstructed distance a
// single tick's movement is meant to cover) in every sampled direction, run
// it through the real collision resolver, and compare the ACTUAL resulting
// displacement from P0 against that nominal cap. Any excess is overshoot —
// the resolver moving the player farther in one tick than the raw proposed
// movement itself ever covered.
//
// Run: npx tsx scripts/regression-collision-overshoot.ts
// (or `npm run regression:collision-overshoot` from the repo root)
//
// Exit code is non-zero if any speed's worst-case overshoot exceeds the
// ABSOLUTE_OVERSHOOT_FAIL_THRESHOLD_M sanity ceiling below, so this can be
// wired into CI later without further changes.

import {
  ARENA_GEOMETRY,
  boxBounds,
  resolveHorizontalCollisions,
  resolveSteppedMovement,
  PLAYER_COLLISION_RADIUS,
} from "@cubewars/shared";

// Real server tick rate (server/src/index.ts: TICK_DT_SECONDS = 1 /
// BROADCAST_TICK_HZ). Duplicated here as a literal rather than imported
// from server/src/index.ts, which is a runnable entrypoint, not a reusable
// module (importing it would start the server) — BROADCAST_TICK_HZ = 20 is
// itself the shared source of truth this is derived from.
const TICK_DT_SECONDS = 1 / 20;

type ResolveMode = "single-step" | "stepped";

interface SpeedConfig {
  label: string;
  speed: number;
  /**
   * "single-step": measured through the raw resolveHorizontalCollisions()
   * call (one resolve per proposed tick displacement) — this is what every
   * speed in this game actually used before EPIC 11 Story 11.1, and is kept
   * here at the EPIC-8-era speeds as the historical F-001 regression
   * baseline. At the two new EPIC 11 speeds it's ALSO measured this way
   * (gates=false — see below) purely to make the magnitude of the problem
   * this EPIC fixes visible in the output, not because the game actually
   * ships that path at these speeds.
   * "stepped": measured through resolveSteppedMovement() — the helper the
   * game actually calls at every speed since EPIC 11 Story 11.1 (both
   * server/src/playerRegistry.ts stepPlayer() and client/src/fpsController.ts).
   */
  mode: ResolveMode;
  /**
   * Whether this row's worst-case overshoot is checked against
   * ABSOLUTE_OVERSHOOT_FAIL_THRESHOLD_M for the script's overall pass/fail
   * exit code. False only for the two "naive single-step at EPIC 11 speed"
   * informational rows below, which are EXPECTED to blow past the threshold
   * (that expected failure is the whole point of Story 11.1 — see the doc
   * comment at the top of this file) and must not flip the script's exit
   * code just for existing.
   */
  gates: boolean;
}

const SPEEDS_MPS: SpeedConfig[] = [
  { label: "baseline (pre-EPIC-8)", speed: 5, mode: "single-step", gates: true },
  { label: "EPIC-8 base (6.65)", speed: 6.65, mode: "single-step", gates: true },
  { label: "EPIC-8 boosted bunny hop (6.65 * 1.3)", speed: 6.65 * 1.3, mode: "single-step", gates: true },
  {
    label: "EPIC-11 base (13.3) naive single-step [informational]",
    speed: 5 * 1.33 * 2,
    mode: "single-step",
    gates: false,
  },
  {
    label: "EPIC-11 boosted (~17.3) naive single-step [informational]",
    speed: 5 * 1.33 * 2 * 1.3,
    mode: "single-step",
    gates: false,
  },
  {
    label: "EPIC-11 base (13.3) resolveSteppedMovement [shipped]",
    speed: 5 * 1.33 * 2,
    mode: "stepped",
    gates: true,
  },
  {
    label: "EPIC-11 boosted (~17.3) resolveSteppedMovement [shipped]",
    speed: 5 * 1.33 * 2 * 1.3,
    mode: "stepped",
    gates: true,
  },
];

// Sanity ceiling: if worst-case absolute overshoot at any GATING speed/mode
// exceeds this, something has clearly regressed (script exits non-zero). Set
// comfortably above the current measured worst case at the highest gating
// speed (see the F-001 handoff, and the EPIC 11 Programmer handoff, for the
// exact measured numbers) so this only fires on a real regression, not
// routine map-geometry tweaks. Also comfortably under a wall's 1-unit
// thickness (shared/src/mapData.ts) — the actual safety property this
// script exists to catch a regression of.
const ABSOLUTE_OVERSHOOT_FAIL_THRESHOLD_M = 0.35;

// Brute-force sweep parameters: every box corner (radius-expanded) in the
// real arena is used as a search anchor, with a local grid of candidate
// starting points around it and a full 360-degree sweep of proposed
// movement directions from each valid one.
const GRID_RADIUS_M = 0.6;
const GRID_STEP_M = 0.04;
const ANGLE_STEP_DEG = 1;

interface Point {
  x: number;
  z: number;
}

function isResolved(p: Point): boolean {
  const r = resolveHorizontalCollisions(p.x, p.z);
  return Math.abs(r.x - p.x) < 1e-9 && Math.abs(r.z - p.z) < 1e-9;
}

function collectCornerAnchors(): Point[] {
  const anchors: Point[] = [];
  for (const box of ARENA_GEOMETRY) {
    const b = boxBounds(box);
    const minX = b.minX - PLAYER_COLLISION_RADIUS;
    const maxX = b.maxX + PLAYER_COLLISION_RADIUS;
    const minZ = b.minZ - PLAYER_COLLISION_RADIUS;
    const maxZ = b.maxZ + PLAYER_COLLISION_RADIUS;
    anchors.push({ x: minX, z: minZ }, { x: minX, z: maxZ }, { x: maxX, z: minZ }, { x: maxX, z: maxZ });
  }
  return anchors;
}

interface WorstCase {
  overshootM: number;
  overshootPct: number;
  p0: Point;
  directionDeg: number;
}

/**
 * Resolve a proposed tick displacement (`dx`, `dz`) from `p0` per `mode` —
 * either the raw single-step resolveHorizontalCollisions() call (EPIC 8-era
 * behavior, and the "naive" informational rows at the new EPIC 11 speeds),
 * or the real resolveSteppedMovement() helper the game actually ships with
 * since EPIC 11 Story 11.1.
 */
function resolveTickMove(mode: ResolveMode, p0: Point, dx: number, dz: number): Point {
  if (mode === "stepped") {
    return resolveSteppedMovement(p0.x, p0.z, dx, dz);
  }
  return resolveHorizontalCollisions(p0.x + dx, p0.z + dz);
}

function findWorstOvershoot(speed: number, mode: ResolveMode, anchors: Point[]): WorstCase {
  const nominalCapM = speed * TICK_DT_SECONDS;
  let worst: WorstCase = { overshootM: -Infinity, overshootPct: -Infinity, p0: { x: 0, z: 0 }, directionDeg: 0 };

  for (const anchor of anchors) {
    for (let ox = -GRID_RADIUS_M; ox <= GRID_RADIUS_M; ox += GRID_STEP_M) {
      for (let oz = -GRID_RADIUS_M; oz <= GRID_RADIUS_M; oz += GRID_STEP_M) {
        const p0: Point = { x: anchor.x + ox, z: anchor.z + oz };
        if (!isResolved(p0)) continue;

        for (let deg = 0; deg < 360; deg += ANGLE_STEP_DEG) {
          const rad = (deg * Math.PI) / 180;
          const dx = Math.cos(rad) * nominalCapM;
          const dz = Math.sin(rad) * nominalCapM;
          const resolved = resolveTickMove(mode, p0, dx, dz);
          const tickDisplacementM = Math.hypot(resolved.x - p0.x, resolved.z - p0.z);
          const overshootM = tickDisplacementM - nominalCapM;
          if (overshootM > worst.overshootM) {
            worst = {
              overshootM,
              overshootPct: (overshootM / nominalCapM) * 100,
              p0,
              directionDeg: deg,
            };
          }
        }
      }
    }
  }

  return worst;
}

function main(): void {
  const anchors = collectCornerAnchors();
  console.log(
    `Sweeping ${anchors.length} box-corner anchors (grid radius ${GRID_RADIUS_M}m, step ${GRID_STEP_M}m, angle step ${ANGLE_STEP_DEG} deg) against the real ARENA_GEOMETRY at TICK_DT_SECONDS=${TICK_DT_SECONDS}s...\n`,
  );

  let anyGatingFailed = false;
  const rows: string[] = [];

  for (const { label, speed, mode, gates } of SPEEDS_MPS) {
    const nominalCapM = speed * TICK_DT_SECONDS;
    const worst = findWorstOvershoot(speed, mode, anchors);
    const overThreshold = worst.overshootM > ABSOLUTE_OVERSHOOT_FAIL_THRESHOLD_M;
    const failed = gates && overThreshold;
    anyGatingFailed = anyGatingFailed || failed;

    const status = gates ? (failed ? "FAIL" : "ok") : overThreshold ? "over-threshold (expected, non-gating)" : "ok";

    rows.push(
      `${label.padEnd(56)} mode=${mode.padEnd(11)} speed=${speed.toFixed(3)} m/s  nominalCap=${nominalCapM.toFixed(4)}m  ` +
        `worstOvershoot=${worst.overshootM.toFixed(4)}m (${worst.overshootPct.toFixed(1)}%)  ` +
        `${status}  @ p0=(${worst.p0.x.toFixed(2)},${worst.p0.z.toFixed(2)}) dir=${worst.directionDeg}deg`,
    );
  }

  console.log(rows.join("\n"));
  console.log(
    `\n${anyGatingFailed ? "FAIL" : "PASS"}: worst-case absolute overshoot ${anyGatingFailed ? "exceeds" : "stays within"} the ${ABSOLUTE_OVERSHOOT_FAIL_THRESHOLD_M}m sanity ceiling at every gating speed/mode (the naive single-step rows at EPIC 11 speeds are informational only and do not gate this result — see SpeedConfig.gates doc comment).`,
  );

  process.exit(anyGatingFailed ? 1 : 0);
}

main();

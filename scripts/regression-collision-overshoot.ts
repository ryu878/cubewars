// EPIC 8 F-001 regression script (`docs/tasks/epic-08-critic-review.md`) for
// the collision "corner pop" issue (originally EPIC 3 F-NB-1,
// `docs/backlog.md`): brute-force-sweeps every box corner in the real
// production `ARENA_GEOMETRY` and, at the game's three relevant horizontal
// move speeds (pre-EPIC-8 baseline, EPIC 8's new base, and boosted bunny
// hop), measures the worst single-tick "overshoot" that the real
// `resolveHorizontalCollisions()` (shared/src/collision.ts) produces at the
// server's real broadcast tick dt.
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

import { ARENA_GEOMETRY, boxBounds, resolveHorizontalCollisions, PLAYER_COLLISION_RADIUS } from "@cubewars/shared";

// Real server tick rate (server/src/index.ts: TICK_DT_SECONDS = 1 /
// BROADCAST_TICK_HZ). Duplicated here as a literal rather than imported
// from server/src/index.ts, which is a runnable entrypoint, not a reusable
// module (importing it would start the server) — BROADCAST_TICK_HZ = 20 is
// itself the shared source of truth this is derived from.
const TICK_DT_SECONDS = 1 / 20;

const SPEEDS_MPS = [
  { label: "baseline (pre-EPIC-8)", speed: 5 },
  { label: "new base (EPIC 8)", speed: 6.65 },
  { label: "boosted (EPIC 8 bunny hop, 6.65 * 1.3)", speed: 6.65 * 1.3 },
];

// Sanity ceiling: if worst-case absolute overshoot at ANY speed exceeds
// this, something has clearly regressed (script exits non-zero). Set
// comfortably above the current measured worst case at the highest speed
// (see the F-001 handoff for the exact measured numbers) so this only
// fires on a real regression, not routine map-geometry tweaks.
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

function findWorstOvershoot(speed: number, anchors: Point[]): WorstCase {
  const nominalCapM = speed * TICK_DT_SECONDS;
  let worst: WorstCase = { overshootM: -Infinity, overshootPct: -Infinity, p0: { x: 0, z: 0 }, directionDeg: 0 };

  for (const anchor of anchors) {
    for (let ox = -GRID_RADIUS_M; ox <= GRID_RADIUS_M; ox += GRID_STEP_M) {
      for (let oz = -GRID_RADIUS_M; oz <= GRID_RADIUS_M; oz += GRID_STEP_M) {
        const p0: Point = { x: anchor.x + ox, z: anchor.z + oz };
        if (!isResolved(p0)) continue;

        for (let deg = 0; deg < 360; deg += ANGLE_STEP_DEG) {
          const rad = (deg * Math.PI) / 180;
          const proposedX = p0.x + Math.cos(rad) * nominalCapM;
          const proposedZ = p0.z + Math.sin(rad) * nominalCapM;
          const resolved = resolveHorizontalCollisions(proposedX, proposedZ);
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
    `Sweeping ${anchors.length} box-corner anchors (grid radius ${GRID_RADIUS_M}m, step ${GRID_STEP_M}m, angle step ${ANGLE_STEP_DEG} deg) against the real ARENA_GEOMETRY / resolveHorizontalCollisions() at TICK_DT_SECONDS=${TICK_DT_SECONDS}s...\n`,
  );

  let anyFailed = false;
  const rows: string[] = [];

  for (const { label, speed } of SPEEDS_MPS) {
    const nominalCapM = speed * TICK_DT_SECONDS;
    const worst = findWorstOvershoot(speed, anchors);
    const failed = worst.overshootM > ABSOLUTE_OVERSHOOT_FAIL_THRESHOLD_M;
    anyFailed = anyFailed || failed;

    rows.push(
      `${label.padEnd(36)} speed=${speed.toFixed(3)} m/s  nominalCap=${nominalCapM.toFixed(4)}m  ` +
        `worstOvershoot=${worst.overshootM.toFixed(4)}m (${worst.overshootPct.toFixed(1)}%)  ` +
        `${failed ? "FAIL" : "ok"}  @ p0=(${worst.p0.x.toFixed(2)},${worst.p0.z.toFixed(2)}) dir=${worst.directionDeg}deg`,
    );
  }

  console.log(rows.join("\n"));
  console.log(
    `\n${anyFailed ? "FAIL" : "PASS"}: worst-case absolute overshoot ${anyFailed ? "exceeds" : "stays within"} the ${ABSOLUTE_OVERSHOOT_FAIL_THRESHOLD_M}m sanity ceiling at every speed.`,
  );

  process.exit(anyFailed ? 1 : 0);
}

main();

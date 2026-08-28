// EPIC 58: shared player-player separation helper smoke tests.

import assert from "node:assert/strict";
import {
  PLAYER_COLLISION_RADIUS,
  resolveAllPlayerSeparations,
  resolvePlayerOverlap,
} from "@cubewars/shared";

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function main(): void {
  const minDist = PLAYER_COLLISION_RADIUS * 2;

  const pair = [
    { x: 0, z: 0, alive: true },
    { x: 0.3, z: 0, alive: true },
  ];
  resolveAllPlayerSeparations(pair);
  assert.ok(dist(pair[0]!, pair[1]!) >= minDist - 1e-6, "overlapping pair separated");

  const withDead = [
    { x: 0, z: 0, alive: true },
    { x: 0.1, z: 0, alive: false },
  ];
  const beforeX = withDead[0]!.x;
  resolveAllPlayerSeparations(withDead);
  assert.equal(withDead[0]!.x, beforeX, "dead players do not participate");

  const stacked = [
    { x: 0, z: 0, alive: true },
    { x: 0.2, z: 0, alive: true },
    { x: -0.2, z: 0, alive: true },
  ];
  for (let pass = 0; pass < 3; pass++) {
    resolveAllPlayerSeparations(stacked);
  }
  assert.ok(dist(stacked[0]!, stacked[1]!) >= minDist - 1e-5);
  assert.ok(dist(stacked[0]!, stacked[2]!) >= minDist - 1e-5);

  const single = resolvePlayerOverlap(0.35, 0, [{ x: 0, z: 0 }]);
  assert.ok(Math.hypot(single.x, single.z) >= minDist - 1e-6, "client overlap pushes local player out");

  console.log("EPIC 58 player collision regression OK");
}

main();

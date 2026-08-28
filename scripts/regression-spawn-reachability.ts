// Regression: catalog spawn points must be reachable (no sealed-room respawns).

import assert from "node:assert/strict";
import { listMaps, isSpawnReachable } from "@cubewars/shared";

for (const map of listMaps()) {
  for (const spawn of map.spawnPoints) {
    assert.equal(
      isSpawnReachable(spawn.x, spawn.z, map.geometry, map.bounds),
      true,
      `${map.id}: spawn (${spawn.x}, ${spawn.z}) is inside a sealed pocket`,
    );
  }
}

console.log("regression-spawn-reachability: OK");

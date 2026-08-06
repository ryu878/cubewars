import assert from "node:assert/strict";
import { LEADERBOARD_LIMIT, boxBounds, type MapBox } from "@cubewars/shared";
import { EndlessWorld } from "../server/src/endlessWorld.js";
import { Match } from "../server/src/match.js";
import { MatchManager, PUBLIC_MATCH_ID } from "../server/src/matchManager.js";

function pointBlocked(geometry: readonly MapBox[], x: number, z: number): boolean {
  return geometry.some((box) => {
    const bounds = boxBounds(box);
    return x > bounds.minX - 0.45 && x < bounds.maxX + 0.45 && z > bounds.minZ - 0.45 && z < bounds.maxZ + 0.45;
  });
}

function hasMazePath(geometry: readonly MapBox[], targetZ: number): boolean {
  const xs = Array.from({ length: 41 }, (_, index) => -20 + index);
  const zs = Array.from({ length: Math.abs(targetZ) + 1 }, (_, index) => -index);
  const start = { x: 0, z: 0 };
  const queue = [start];
  const visited = new Set([`${start.x}:${start.z}`]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.z <= targetZ) return true;

    const neighbors = [
      { x: current.x + 1, z: current.z },
      { x: current.x - 1, z: current.z },
      { x: current.x, z: current.z + 1 },
      { x: current.x, z: current.z - 1 },
    ];

    for (const next of neighbors) {
      if (!xs.includes(next.x) || !zs.includes(next.z)) continue;
      const key = `${next.x}:${next.z}`;
      if (visited.has(key) || pointBlocked(geometry, next.x, next.z)) continue;
      visited.add(key);
      queue.push(next);
    }
  }

  return false;
}

const world = new EndlessWorld();
const initialGeometryCount = world.getGeometry().length;
const initialPickupCount = world.getPickups().length;
const initialVersion = world.getVersion();

assert.ok(initialGeometryCount > 0, "endless world should generate starting geometry");
assert.ok(initialPickupCount > 0, "endless world should generate starting pickups");

world.update(1, { x: 0, y: 0, z: -520 });
assert.ok(world.getGeometry().length > initialGeometryCount, "endless world should grow ahead of progress");
assert.ok(world.getPickups().length > initialPickupCount, "endless world should add pickups ahead of progress");
assert.ok(world.takeBotSpawns(3, -120).length > 0, "endless world should provide bot spawns ahead of the player");
assert.ok(world.getVersion() > initialVersion, "endless world version should change when generated content changes");
assert.ok(
  world.getGeometry().some((box) => Math.abs(box.center.x) <= 8 && box.size.z > 4),
  "endless world should include center maze divider walls",
);
assert.ok(hasMazePath(world.getGeometry(), -900), "endless maze should keep a walkable path through generated chunks");

const rollingWorld = new EndlessWorld();
rollingWorld.update(1, { x: 0, y: 0, z: -500 });
const rollingVersion = rollingWorld.getVersion();
rollingWorld.update(1, { x: 0, y: 0, z: -540 });
assert.ok(
  rollingWorld.getVersion() > rollingVersion,
  "endless world version should change when chunks roll even if object count is stable",
);
assert.ok(rollingWorld.getGeometry().length > 0, "rolling endless world should keep playable geometry");

const longRunWorld = new EndlessWorld();
for (let z = -120; z >= -5000; z -= 40) {
  longRunWorld.update(1, { x: 0, y: 0, z });
  const geometry = longRunWorld.getGeometry();
  assert.ok(geometry.length > 0, `long endless run should keep geometry at z=${z}`);

  const farthestGeneratedZ = Math.min(...geometry.map((box) => box.center.z - box.size.z / 2));
  assert.ok(
    farthestGeneratedZ <= z - 360,
    `long endless run should keep generated map ahead at z=${z}; farthest=${farthestGeneratedZ}`,
  );

  for (let sampleZ = z + 40; sampleZ >= z - 320; sampleZ -= 40) {
    const hasRenderedSlice = geometry.some((box) => {
      const bounds = boxBounds(box);
      return sampleZ >= bounds.minZ && sampleZ <= bounds.maxZ;
    });
    assert.ok(hasRenderedSlice, `long endless run should not leave an empty geometry slice at z=${sampleZ}`);
  }
}

const manager = new MatchManager();
manager.recordEndlessProgress("Runner", 5, 0.42);
manager.recordEndlessProgress("Runner", 2, 0.12);
manager.recordEndlessProgress("Distance", 5, 0.8);

for (let i = 0; i < 25; i++) {
  manager.recordEndlessProgress(`Player${i}`, i, i / 10);
}

const entries = manager.listEndlessLeaderboard();
assert.equal(entries.length, LEADERBOARD_LIMIT, "endless leaderboard should be capped to top 20");
assert.equal(entries[0].nickname, "Player24", "highest bot kill count should sort first");

const focusedManager = new MatchManager();
focusedManager.recordEndlessProgress("Runner", 5, 0.42);
focusedManager.recordEndlessProgress("Runner", 2, 0.12);
focusedManager.recordEndlessProgress("Distance", 5, 0.8);
const focusedEntries = focusedManager.listEndlessLeaderboard();
const runner = focusedEntries.find((entry) => entry.nickname === "Runner");
assert.ok(runner, "best Runner entry should still exist");
assert.equal(runner.botKills, 5, "endless leaderboard should keep the best bot-kill result per nickname");
assert.equal(runner.distanceKm, 0.42, "endless leaderboard should keep the best distance per nickname");
assert.equal(focusedEntries[0].nickname, "Distance", "distance should break equal bot-kill ties");

const sent: string[] = [];
const fakeSocket = {
  OPEN: 1,
  readyState: 1,
  send(payload: string): void {
    sent.push(payload);
  },
};
const match = new Match({ id: "endless:test", mode: "endless" });
match.addHuman("human", fakeSocket as never, "Runner", "runner");
const internalMatch = match as unknown as {
  endlessWorld: EndlessWorld;
  endlessBotKills: number;
  botAI: { spawnBotAt(id: string, position: { x: number; y: number; z: number }, nickname: string): void };
  restartEndlessRunIfDead(nowMs: number): void;
};

internalMatch.endlessWorld.update(1, { x: 0, y: 0, z: -520 });
internalMatch.botAI.spawnBotAt("old-bot", { x: 0, y: 0, z: -80 }, "Bot 1");
internalMatch.endlessBotKills = 3;
const expandedGeometryCount = internalMatch.endlessWorld.getGeometry().length;
const human = match.registry.getPlayer("human");
assert.ok(human, "human should exist in endless match");
human.alive = false;
human.respawnAtMs = Date.now() + 3000;

internalMatch.restartEndlessRunIfDead(Date.now());
const restartedHuman = match.registry.getPlayer("human");

assert.ok(restartedHuman?.alive, "endless death should immediately restart the run");
assert.equal(match.registry.has("old-bot"), false, "endless reset should remove old bots");
assert.ok(
  internalMatch.endlessWorld.getGeometry().length < expandedGeometryCount,
  "endless reset should replace the far-progress maze with the starting maze",
);
assert.equal(internalMatch.endlessWorld.state().distanceMeters, 0, "endless reset should restart distance");
assert.equal(internalMatch.endlessBotKills, 0, "endless reset should restart current-run bot kills");

manager.destroyMatch(PUBLIC_MATCH_ID);
focusedManager.destroyMatch(PUBLIC_MATCH_ID);
match.destroy();
console.log("[endless] PASS");

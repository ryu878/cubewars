import assert from "node:assert/strict";
import { LEADERBOARD_LIMIT } from "@cubewars/shared";
import { EndlessWorld } from "../server/src/endlessWorld.js";
import { MatchManager, PUBLIC_MATCH_ID } from "../server/src/matchManager.js";

const world = new EndlessWorld();
const initialGeometryCount = world.getGeometry().length;
const initialPickupCount = world.getPickups().length;

assert.ok(initialGeometryCount > 0, "endless world should generate starting geometry");
assert.ok(initialPickupCount > 0, "endless world should generate starting pickups");

world.update(1, { x: 0, y: 0, z: -520 });
assert.ok(world.getGeometry().length > initialGeometryCount, "endless world should grow ahead of progress");
assert.ok(world.getPickups().length > initialPickupCount, "endless world should add pickups ahead of progress");
assert.ok(world.takeBotSpawns(3, -120).length > 0, "endless world should provide bot spawns ahead of the player");

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

manager.destroyMatch(PUBLIC_MATCH_ID);
focusedManager.destroyMatch(PUBLIC_MATCH_ID);
console.log("[endless] PASS");

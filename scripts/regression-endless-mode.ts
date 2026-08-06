import assert from "node:assert/strict";
import { LEADERBOARD_LIMIT } from "@cubewars/shared";
import { EndlessWorld } from "../server/src/endlessWorld.js";
import { Match } from "../server/src/match.js";
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
  resetEndlessRunBeforeRespawn(nowMs: number): void;
};

internalMatch.endlessWorld.update(1, { x: 0, y: 0, z: -520 });
internalMatch.botAI.spawnBotAt("old-bot", { x: 0, y: 0, z: -80 }, "Bot 1");
internalMatch.endlessBotKills = 3;
const expandedGeometryCount = internalMatch.endlessWorld.getGeometry().length;
const human = match.registry.getPlayer("human");
assert.ok(human, "human should exist in endless match");
human.alive = false;
human.respawnAtMs = Date.now() - 1;

internalMatch.resetEndlessRunBeforeRespawn(Date.now());
const respawns = match.registry.processRespawns(Date.now());

assert.equal(respawns.length, 1, "endless reset should allow the human to respawn");
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

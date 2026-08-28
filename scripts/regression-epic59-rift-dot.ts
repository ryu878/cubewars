// EPIC 59: server rift DoT — grounded human+bot in rift take damage; airborne skips; endless skips.

import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { getMap, isPointInRift } from "@cubewars/shared";
import { Match } from "../server/src/match.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

function fakeSocket(): WebSocket {
  return { readyState: 1, OPEN: 1, send: () => {} } as unknown as WebSocket;
}

function riftMid(mapId: "base") {
  const rift = getMap(mapId).rift!;
  const a = rift.polyline[0]!;
  const b = rift.polyline[1]!;
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, rift };
}

function applyRiftDot(match: Match): void {
  (match as unknown as { applyRiftHazardDamage: () => void }).applyRiftHazardDamage();
}

async function main(): Promise<void> {
  const store = await openTestEconomyStore();
  const mid = riftMid("base");
  assert.equal(isPointInRift(mid.x, mid.z, mid.rift), true, "midpoint must be inside rift");

  const match = new Match({ id: "epic59-dot", mode: "bots", mapId: "base", economy: store });
  await match.addHuman("human-r59", fakeSocket(), "R59Human", "r59human");

  const human = match.registry.getPlayer("human-r59");
  const bot = match.registry.getPlayer("Bot 1");
  assert.ok(human && bot, "human and Bot 1 must exist");

  human.position.x = mid.x;
  human.position.z = mid.z;
  human.position.y = 0;
  human.grounded = true;
  human.armor = 40;
  human.health = 100;
  human.spawnProtectedUntilMs = 0;

  bot.position.x = mid.x;
  bot.position.z = mid.z;
  bot.position.y = 0;
  bot.grounded = true;
  bot.armor = 30;
  bot.health = 100;
  bot.spawnProtectedUntilMs = 0;

  applyRiftDot(match);
  assert.ok(human.armor < 40 || human.health < 100, "human must take rift damage (armor first)");
  assert.ok(bot.armor < 30 || bot.health < 100, "bot must take rift damage (armor first)");

  const hpBeforeJump = human.health;
  const armorBeforeJump = human.armor;
  human.grounded = false;
  applyRiftDot(match);
  assert.equal(human.health, hpBeforeJump, "airborne human must skip rift DoT");
  assert.equal(human.armor, armorBeforeJump, "airborne human armor unchanged");

  const endless = new Match({ id: "epic59-endless", mode: "endless", economy: store });
  await endless.addHuman("human-e", fakeSocket(), "R59End", "r59end");
  const endlessHuman = endless.registry.getPlayer("human-e");
  assert.ok(endlessHuman);
  endlessHuman.position.x = mid.x;
  endlessHuman.position.z = mid.z;
  endlessHuman.grounded = true;
  endlessHuman.health = 100;
  endlessHuman.spawnProtectedUntilMs = 0;
  applyRiftDot(endless);
  assert.equal(endlessHuman.health, 100, "endless mode must not apply catalog rift DoT");

  await store.close();
  console.log("regression-epic59-rift-dot: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

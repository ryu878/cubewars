// EPIC 35 regression: Deathmatch vs Sandbox economy pools are fully isolated,
// and legacy unscoped Redis keys migrate into the deathmatch pool on first read.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import { GOLD_DROP_MAX, GOLD_DROP_MIN } from "@cubewars/shared";
import { EconomyStore } from "../server/src/economy/index.js";
import { Match } from "../server/src/match.js";
import { ensureRedisRunning, openTestEconomyStore } from "./economy-test-helpers.js";
import { resolveRedisUrl } from "../server/src/economy/index.js";

function fakeSocket(sent: string[]): WebSocket {
  return {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => {
      sent.push(data);
    },
  } as unknown as WebSocket;
}

async function main(): Promise<void> {
  const store = await openTestEconomyStore();

  // --- Isolation: gold/items in sandbox never appear in deathmatch reads. ---
  await store.addGold("SplitRunner", 100, "deathmatch");
  await store.addGold("SplitRunner", 50, "sandbox");
  await store.grantEgg("SplitRunner", Date.now(), 60_000, "sandbox");

  const dm = await store.getFullProfile("SplitRunner", "deathmatch");
  const sb = await store.getFullProfile("SplitRunner", "sandbox");
  assert.equal(dm.gold, 100, "deathmatch gold must stay 100");
  assert.equal(sb.gold, 50, "sandbox gold must stay 50");
  assert.equal(dm.eggs.length, 0, "deathmatch must not see sandbox eggs");
  assert.equal(sb.eggs.length, 1, "sandbox must keep its egg");

  // Spending/mutating sandbox must not touch deathmatch.
  await store.addGold("SplitRunner", 7, "sandbox");
  assert.equal((await store.getFullProfile("SplitRunner", "deathmatch")).gold, 100);
  assert.equal((await store.getFullProfile("SplitRunner", "sandbox")).gold, 57);

  // --- Match routing: sandbox bot kill feeds sandbox only. ---
  const botsMatch = new Match({ id: "split-economy-bots", mode: "bots", economy: store });
  const grantKillGold = (
    botsMatch as unknown as {
      grantKillGold: (shooterId: string, victimId: string) => Promise<void>;
    }
  ).grantKillGold.bind(botsMatch);

  const sent: string[] = [];
  await botsMatch.addHuman("human-a", fakeSocket(sent), "SplitRunner", "splitrunner");
  const dmBefore = (await store.getFullProfile("SplitRunner", "deathmatch")).gold;
  const sbBefore = (await store.getFullProfile("SplitRunner", "sandbox")).gold;

  await grantKillGold("human-a", "Bot 1");

  const dmAfterBot = (await store.getFullProfile("SplitRunner", "deathmatch")).gold;
  const sbAfterBot = (await store.getFullProfile("SplitRunner", "sandbox")).gold;
  assert.equal(dmAfterBot, dmBefore, "sandbox bot kill must not change deathmatch gold");
  assert.ok(
    sbAfterBot > sbBefore,
    `sandbox bot kill must mint sandbox gold (before=${sbBefore} after=${sbAfterBot})`,
  );
  const sandboxGain = sbAfterBot - sbBefore;
  assert.ok(
    sandboxGain >= GOLD_DROP_MIN && sandboxGain <= GOLD_DROP_MAX * 2,
    `sandbox gain ${sandboxGain} outside expected band`,
  );

  // --- Deathmatch (public) still rejects bot-like non-human victims (EPIC 32). ---
  const publicMatch = new Match({
    id: "split-economy-public",
    mode: "public",
    economy: store,
  });
  const grantPublic = (
    publicMatch as unknown as {
      grantKillGold: (shooterId: string, victimId: string) => Promise<void>;
    }
  ).grantKillGold.bind(publicMatch);
  const sentP: string[] = [];
  await publicMatch.addHuman("human-p", fakeSocket(sentP), "DmOnly", "dmonly");
  const dmOnlyBefore = (await store.getOrCreateProfile("DmOnly", "deathmatch")).gold;
  await grantPublic("human-p", "not-a-real-victim");
  assert.equal(
    (await store.getOrCreateProfile("DmOnly", "deathmatch")).gold,
    dmOnlyBefore,
    "public/deathmatch non-human victim must mint zero",
  );
  assert.equal(
    (await store.getOrCreateProfile("DmOnly", "sandbox")).gold,
    0,
    "deathmatch path must not write sandbox for that nickname",
  );

  await store.flushNamespace();
  await store.close();

  // --- Migration: legacy unscoped key → deathmatch on first read. ---
  const url = resolveRedisUrl();
  await ensureRedisRunning(url);
  const prefix = `cw:test:${randomUUID()}`;
  const { connectRedis } = await import("../server/src/economy/redis.js");
  const { redis } = await connectRedis({ url, keyPrefix: prefix });
  const legacyPayload = JSON.stringify({
    v: 1,
    id: 42,
    nicknameKey: "legacyplayer",
    nickname: "LegacyPlayer",
    gold: 777,
    createdAt: 1,
    updatedAt: 1,
    nextPetId: 1,
    nextEggId: 1,
    nextGemId: 1,
    nextAmuletId: 1,
    nextStimId: 1,
    nextRepairKitId: 1,
    pets: [],
    eggs: [],
    stimulators: [],
    gems: [],
    amulets: [],
    shardCount: 0,
    shardSlotAnchor: null,
    repairKits: [],
    career: { kills: 0, deaths: 0, updatedAt: 1 },
    endless: { botKills: 0, distanceKm: 0, updatedAt: 1 },
  });
  await redis.set(`${prefix}:economy:v1:legacyplayer`, legacyPayload);
  await redis.quit();

  const migrated = await EconomyStore.open({
    redisUrl: url,
    keyPrefix: prefix,
    skipSqliteImport: true,
  });
  const profile = await migrated.getOrCreateProfile("LegacyPlayer", "deathmatch");
  assert.equal(profile.gold, 777, "legacy gold must migrate into deathmatch");
  assert.equal(
    (await migrated.getOrCreateProfile("LegacyPlayer", "sandbox")).gold,
    0,
    "sandbox must start empty after legacy migration",
  );

  // Idempotent: second open/read still sees deathmatch data, no double-apply.
  const again = await migrated.getFullProfile("LegacyPlayer", "deathmatch");
  assert.equal(again.gold, 777);

  await migrated.flushNamespace();
  await migrated.close();

  console.log("[split-economy] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

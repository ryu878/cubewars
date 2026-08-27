// EPIC 57: sandbox bot amulet → shard; DM bot no reward; human shard path;
// repairKit chance constant; no bot Redis profiles.

import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { DROP_CHANCE, ECONOMY_CAPS } from "@cubewars/shared";
import { Match } from "../server/src/match.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

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
  assert.equal(DROP_CHANCE.repairKit, 0.002, "repairKit must be 0.002");

  const store = await openTestEconomyStore();

  // --- Sandbox amulet-bot → shard ---
  const botsMatch = new Match({ id: "epic57-bots", mode: "bots", economy: store });
  const grantBots = (
    botsMatch as unknown as {
      grantKillGold: (shooterId: string, victimId: string) => Promise<void>;
    }
  ).grantKillGold.bind(botsMatch);

  const sent: string[] = [];
  await botsMatch.addHuman("human-s", fakeSocket(sent), "Epic57Killer", "epic57killer");
  const bot = botsMatch.registry.getPlayer("Bot 1");
  assert.ok(bot, "Bot 1 must exist in bots match");
  bot.hasAmulet = true;

  const shardsBefore = (await store.getFullProfile("Epic57Killer", "sandbox")).shardCount;
  await grantBots("human-s", "Bot 1");
  const afterAmuletBot = await store.getFullProfile("Epic57Killer", "sandbox");
  assert.equal(
    afterAmuletBot.shardCount,
    shardsBefore + 1,
    "sandbox amulet-bot kill must grant one shard",
  );
  // Never invent amulet item from bot.
  assert.equal(afterAmuletBot.amulets.length, 0, "bot kill must not invent amulet copies");

  // Once-per-bot: second kill of same bot must not grant another shard.
  await grantBots("human-s", "Bot 1");
  assert.equal(
    (await store.getFullProfile("Epic57Killer", "sandbox")).shardCount,
    shardsBefore + 1,
    "second kill of same bot must not grant another shard",
  );

  // Non-amulet bot → no shard from amulet path.
  const bot2 = botsMatch.registry.getPlayer("Bot 2");
  assert.ok(bot2, "Bot 2 must exist");
  bot2.hasAmulet = false;
  const shardsMid = (await store.getFullProfile("Epic57Killer", "sandbox")).shardCount;
  await grantBots("human-s", "Bot 2");
  assert.equal(
    (await store.getFullProfile("Epic57Killer", "sandbox")).shardCount,
    shardsMid,
    "non-amulet bot must not grant shard",
  );

  // --- Deathmatch bot → no reward ---
  const publicMatch = new Match({
    id: "epic57-public",
    mode: "public",
    economy: store,
  });
  const grantPublic = (
    publicMatch as unknown as {
      grantKillGold: (shooterId: string, victimId: string) => Promise<void>;
    }
  ).grantKillGold.bind(publicMatch);
  const sentDm: string[] = [];
  await publicMatch.addHuman("human-d", fakeSocket(sentDm), "Epic57DmKiller", "epic57dmkiller");
  const dmGoldBefore = (await store.getFullProfile("Epic57DmKiller", "deathmatch")).gold;
  const dmShardsBefore = (await store.getFullProfile("Epic57DmKiller", "deathmatch")).shardCount;
  await grantPublic("human-d", "ghost-bot");
  assert.equal(
    (await store.getFullProfile("Epic57DmKiller", "deathmatch")).gold,
    dmGoldBefore,
    "DM bot kill must not mint gold",
  );
  assert.equal(
    (await store.getFullProfile("Epic57DmKiller", "deathmatch")).shardCount,
    dmShardsBefore,
    "DM bot kill must not grant shards",
  );

  // --- Human-with-amulet shard path still works (deathmatch) ---
  await publicMatch.addHuman("human-v", fakeSocket([]), "Epic57Victim", "epic57victim");
  await store.grantAmulet("Epic57Victim", 8, Date.now(), "deathmatch");
  const humanShardsBefore = (await store.getFullProfile("Epic57DmKiller", "deathmatch")).shardCount;
  await grantPublic("human-d", "human-v");
  assert.equal(
    (await store.getFullProfile("Epic57DmKiller", "deathmatch")).shardCount,
    humanShardsBefore + 1,
    "human amulet victim must still grant shard",
  );

  // --- Killer at amulet cap still gets shards from sandbox bot ---
  const capMatch = new Match({ id: "epic57-cap", mode: "bots", economy: store });
  const grantCap = (
    capMatch as unknown as {
      grantKillGold: (shooterId: string, victimId: string) => Promise<void>;
    }
  ).grantKillGold.bind(capMatch);
  await capMatch.addHuman("human-c", fakeSocket([]), "Epic57CapKiller", "epic57capkiller");
  for (let i = 0; i < ECONOMY_CAPS.amulets; i++) {
    await store.grantAmulet("Epic57CapKiller", 10, Date.now(), "sandbox");
  }
  assert.equal(
    (await store.getFullProfile("Epic57CapKiller", "sandbox")).amulets.length,
    ECONOMY_CAPS.amulets,
  );
  const capBot = capMatch.registry.getPlayer("Bot 1");
  assert.ok(capBot);
  capBot.hasAmulet = true;
  const capShardsBefore = (await store.getFullProfile("Epic57CapKiller", "sandbox")).shardCount;
  await grantCap("human-c", "Bot 1");
  assert.equal(
    (await store.getFullProfile("Epic57CapKiller", "sandbox")).shardCount,
    capShardsBefore + 1,
    "amulet-cap killer must still receive shards from sandbox amulet-bot",
  );

  await store.flushNamespace();
  await store.close();
  console.log("[epic57-bot-shards] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

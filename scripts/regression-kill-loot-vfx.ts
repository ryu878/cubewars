// EPIC 44 regression: economy_kill_loot_fx emission rules.
// - Deathmatch bot victim → no fx message (EPIC 32 unchanged).
// - Rewarding kill with forced drops → fx kinds match actual grants.
// - Substituted overflow item → gold kind only (not the failed item kind).

import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import type { EconomyKillLootFxMessage, KillLootFxKind, ServerMessage } from "@cubewars/shared";
import { Match } from "../server/src/match.js";
import type { KillItemDropsResult } from "../server/src/economy/store.js";
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

function parseSent(sent: string[]): ServerMessage[] {
  return sent.map((raw) => JSON.parse(raw) as ServerMessage);
}

function lootFxMessages(sent: string[]): EconomyKillLootFxMessage[] {
  return parseSent(sent).filter(
    (m): m is EconomyKillLootFxMessage => m.type === "economy_kill_loot_fx",
  );
}

function kindsOf(fx: EconomyKillLootFxMessage): KillLootFxKind[] {
  return fx.grants.map((g) => g.kind);
}

async function main(): Promise<void> {
  const store = await openTestEconomyStore();

  // --- Case 1: DM bot victim → no economy_kill_loot_fx. ---
  const publicMatch = new Match({
    id: "epic44-dm-bot",
    mode: "public",
    economy: store,
  });
  const grantPublic = (
    publicMatch as unknown as {
      grantKillGold: (shooterId: string, victimId: string) => Promise<void>;
    }
  ).grantKillGold.bind(publicMatch);

  const sentPublic: string[] = [];
  await publicMatch.addHuman("human-a", fakeSocket(sentPublic), "KillerA", "killera");
  sentPublic.length = 0;
  await grantPublic("human-a", "ghost-bot");
  assert.equal(
    lootFxMessages(sentPublic).length,
    0,
    "deathmatch bot victim must not emit economy_kill_loot_fx",
  );

  // --- Case 2: rewarding human kill with forced drops → kinds match. ---
  const sentB: string[] = [];
  await publicMatch.addHuman("human-b", fakeSocket(sentB), "VictimB", "victimb");

  const forcedDrops: KillItemDropsResult = {
    egg: {
      id: 1,
      profileId: 1,
      hatchDeadlineMs: Date.now() + 60_000,
      slotAnchor: 0,
      createdAt: Date.now(),
    },
    stimulator: true,
    gem: null,
    shard: false,
    amulet: null,
    repairKit: true,
    substitutedGold: 0,
    substitutedKinds: [],
  };

  const originalResolve = store.resolveKillDrops.bind(store);
  store.resolveKillDrops = (async () => forcedDrops) as typeof store.resolveKillDrops;

  sentPublic.length = 0;
  sentB.length = 0;
  await grantPublic("human-a", "human-b");

  const fxAll = [...lootFxMessages(sentPublic), ...lootFxMessages(sentB)];
  assert.ok(fxAll.length >= 1, "rewarding kill must broadcast economy_kill_loot_fx");
  // Broadcast reaches every human socket in the match.
  assert.equal(
    lootFxMessages(sentPublic).length,
    1,
    "killer socket must receive loot fx",
  );
  assert.equal(
    lootFxMessages(sentB).length,
    1,
    "victim socket must receive loot fx (match broadcast)",
  );

  const fx = lootFxMessages(sentPublic)[0]!;
  assert.equal(fx.killerId, "human-a");
  assert.equal(fx.victimId, "human-b");
  assert.ok(fx.victimPosition && typeof fx.victimPosition.x === "number");
  assert.ok(fx.killerPosition && typeof fx.killerPosition.x === "number");

  const kinds = kindsOf(fx);
  assert.ok(kinds.includes("gold"), "primary gold must appear as gold kind");
  assert.ok(kinds.includes("egg"), "forced egg grant must appear");
  assert.ok(kinds.includes("stimulator"), "forced stimulator grant must appear");
  assert.ok(kinds.includes("repair_kit"), "forced repair kit grant must appear");
  assert.ok(!kinds.includes("gem"), "ungranted gem must not appear");
  assert.ok(!kinds.includes("shard"), "ungranted shard must not appear");
  assert.ok(!kinds.includes("amulet"), "ungranted amulet must not appear");
  assert.equal(
    kinds.filter((k) => k === "gold").length,
    1,
    "gold kind must appear at most once even with multiple gold sources",
  );

  // --- Case 3: substituted item → gold only for that substitute. ---
  const substitutedDrops: KillItemDropsResult = {
    egg: null,
    stimulator: false,
    gem: null,
    shard: false,
    amulet: null,
    repairKit: false,
    substitutedGold: 7,
    substitutedKinds: ["egg"],
  };
  store.resolveKillDrops = (async () => substitutedDrops) as typeof store.resolveKillDrops;

  sentPublic.length = 0;
  sentB.length = 0;
  await grantPublic("human-a", "human-b");

  const subFx = lootFxMessages(sentPublic)[0];
  assert.ok(subFx, "substituted-gold kill must still emit loot fx (gold)");
  const subKinds = kindsOf(subFx);
  assert.ok(subKinds.includes("gold"), "substituted gold must show as gold kind");
  assert.ok(!subKinds.includes("egg"), "failed/substituted egg must NOT appear as egg kind");
  assert.deepEqual(
    subKinds.filter((k) => k !== "gold"),
    [],
    "only gold should appear when all item rolls substituted",
  );

  store.resolveKillDrops = originalResolve;

  await store.flushNamespace();
  await store.close();

  console.log("[kill-loot-vfx] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

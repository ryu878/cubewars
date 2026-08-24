// EPIC 26/27 regression: career K/D + endless personal bests survive Redis reopen;
// kill-drop overflow substitutes gold when a rolled item cannot be granted.

import assert from "node:assert/strict";
import {
  ECONOMY_CAPS,
  GOLD_DROP_MAX,
  GOLD_DROP_MIN,
  STIMULATOR_SOFT_CAP,
} from "@cubewars/shared";
import { EconomyStore } from "../server/src/economy/index.js";
import { MatchManager } from "../server/src/matchManager.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

async function main(): Promise<void> {
  const store = await openTestEconomyStore();
  const redisUrl = store.redisUrl;
  const keyPrefix = store.keyPrefix;

  // --- Career K/D write-through ---
  const kd1 = await store.incrementCareerKillDeath("Ace", "Victim");
  assert.equal(kd1.attacker.kills, 1);
  assert.equal(kd1.attacker.deaths, 0);
  assert.equal(kd1.victim.kills, 0);
  assert.equal(kd1.victim.deaths, 1);

  await store.incrementCareerKillDeath("Ace", "Victim");
  await store.incrementCareerKillDeath("Ace", "Other");
  const board = await store.listCareerLeaderboard();
  assert.equal(board[0]!.nickname, "Ace");
  assert.equal(board[0]!.kills, 3);
  assert.equal(board[0]!.deaths, 0);
  const victimRow = board.find((e) => e.nickname === "Victim");
  assert.ok(victimRow);
  assert.equal(victimRow!.deaths, 2);

  // --- Endless personal bests ---
  const endless1 = await store.upsertEndlessBest("Runner", 5, 1.25);
  assert.equal(endless1.botKills, 5);
  assert.equal(endless1.distanceKm, 1.25);
  const endless2 = await store.upsertEndlessBest("Runner", 4, 2.0);
  assert.equal(endless2.botKills, 5, "bot kills must keep max");
  assert.equal(endless2.distanceKm, 2.0, "distance must keep max");
  await store.upsertEndlessBest("Runner", 10, 0.5);
  const endlessBoard = await store.listEndlessLeaderboard();
  assert.equal(endlessBoard[0]!.nickname, "Runner");
  assert.equal(endlessBoard[0]!.botKills, 10);
  assert.equal(endlessBoard[0]!.distanceKm, 2.0);

  const goldBeforeClose = (await store.getOrCreateProfile("Ace")).gold;
  await store.addGold("Ace", 42);
  assert.equal(
    await store.getGold((await store.getOrCreateProfile("Ace")).nicknameKey),
    goldBeforeClose + 42,
  );

  await store.close();

  // --- Reopen with new Redis connection: values equal ---
  const reopened = await EconomyStore.open({
    redisUrl,
    keyPrefix,
    skipSqliteImport: true,
  });
  const careerAfter = await reopened.listCareerLeaderboard();
  const ace = careerAfter.find((e) => e.nickname === "Ace");
  assert.ok(ace, "Ace career must survive reopen");
  assert.equal(ace!.kills, 3);
  assert.equal(ace!.deaths, 0);
  const endlessAfter = await reopened.listEndlessLeaderboard();
  assert.equal(endlessAfter[0]!.botKills, 10);
  assert.equal(endlessAfter[0]!.distanceKm, 2.0);
  assert.equal((await reopened.getOrCreateProfile("Ace")).gold, goldBeforeClose + 42);

  await reopened.incrementCareerKillDeath("Ace", "Victim");
  assert.equal((await reopened.listCareerLeaderboard()).find((e) => e.nickname === "Ace")!.kills, 4);

  const mgr = new MatchManager({ economy: reopened });
  await mgr.hydrateFromEconomy();
  const hydrated = mgr.listLeaderboard();
  assert.ok(hydrated.some((e) => e.nickname === "Ace" && e.kills === 4));
  const hydratedEndless = mgr.listEndlessLeaderboard();
  assert.ok(hydratedEndless.some((e) => e.nickname === "Runner" && e.botKills === 10));
  for (const summary of mgr.listPublicMatches()) {
    mgr.destroyMatch(summary.id);
  }

  // --- Overflow → gold when egg grant blocked ---
  const eggFarmer = await reopened.getOrCreateProfile("EggFarmer");
  const now = Date.now();
  while ((await reopened.listEggs(eggFarmer.id)).length < ECONOMY_CAPS.eggs) {
    await reopened.grantEgg("EggFarmer", now, 1);
  }
  assert.equal((await reopened.listEggs(eggFarmer.id)).length, ECONOMY_CAPS.eggs);
  const goldBeforeSub = await reopened.getGold(eggFarmer.nicknameKey);
  const SUBSTITUTE = 137;
  assert.ok(SUBSTITUTE >= GOLD_DROP_MIN && SUBSTITUTE <= GOLD_DROP_MAX);
  const drops = await reopened.resolveKillDrops(
    "EggFarmer",
    true,
    {
      egg: 0,
      stimulator: 1,
      gem: 1,
      amulet: 1,
      repairKit: 1,
      substituteGold: SUBSTITUTE,
    },
    now,
  );
  assert.equal(drops.egg, null, "egg must not grant at cap");
  assert.equal(drops.substitutedGold, SUBSTITUTE);
  assert.deepEqual(drops.substitutedKinds, ["egg"]);
  assert.equal(await reopened.getGold(eggFarmer.nicknameKey), goldBeforeSub + SUBSTITUTE);

  await reopened.getOrCreateProfile("StimFarmer");
  while (
    (await reopened.countStimulators((await reopened.getOrCreateProfile("StimFarmer")).id)) <
    STIMULATOR_SOFT_CAP
  ) {
    await reopened.grantStimulator("StimFarmer", now);
  }
  const stimGoldBefore = await reopened.getGold(
    (await reopened.getOrCreateProfile("StimFarmer")).nicknameKey,
  );
  const stimDrops = await reopened.resolveKillDrops(
    "StimFarmer",
    true,
    {
      egg: 1,
      stimulator: 0,
      gem: 1,
      amulet: 1,
      repairKit: 1,
      substituteGold: SUBSTITUTE,
    },
    now,
  );
  assert.equal(stimDrops.stimulator, false);
  assert.equal(stimDrops.substitutedGold, SUBSTITUTE);
  assert.deepEqual(stimDrops.substitutedKinds, ["stimulator"]);
  assert.equal(
    await reopened.getGold((await reopened.getOrCreateProfile("StimFarmer")).nicknameKey),
    stimGoldBefore + SUBSTITUTE,
  );

  const noChanceRolls = {
    egg: 1,
    stimulator: 1,
    gem: 1,
    amulet: 1,
    repairKit: 1,
    substituteGold: SUBSTITUTE,
  } as const;
  await reopened.getOrCreateProfile("ShardCapKiller");
  while (
    (await reopened.getShardCount((await reopened.getOrCreateProfile("ShardCapKiller")).id)) <
    ECONOMY_CAPS.shards
  ) {
    await reopened.addShard("ShardCapKiller", 1, now);
  }
  assert.equal(
    await reopened.getShardCount((await reopened.getOrCreateProfile("ShardCapKiller")).id),
    ECONOMY_CAPS.shards,
  );
  await reopened.grantAmulet("AmuletVictimA", 10, now);
  await reopened.grantAmulet("AmuletVictimB", 10, now);

  const matchShardGrants = new Set<string>();
  const resolveShardKill = async (victimNick: string) => {
    const victimKey = (await reopened.getOrCreateProfile(victimNick)).nicknameKey;
    const alreadyGrantedShard = matchShardGrants.has(victimKey);
    const dropsResult = await reopened.resolveKillDrops(
      "ShardCapKiller",
      true,
      noChanceRolls,
      now,
      { nickname: victimNick, alreadyGrantedShard },
    );
    if (dropsResult.shard || dropsResult.substitutedKinds.includes("shard")) {
      matchShardGrants.add(victimKey);
    }
    return dropsResult;
  };

  const goldBeforeShardFarm = await reopened.getGold(
    (await reopened.getOrCreateProfile("ShardCapKiller")).nicknameKey,
  );
  const firstA = await resolveShardKill("AmuletVictimA");
  assert.equal(firstA.shard, false, "shard must not grant at shard cap");
  assert.deepEqual(firstA.substitutedKinds, ["shard"]);
  assert.equal(firstA.substitutedGold, SUBSTITUTE);
  assert.equal(
    await reopened.getGold((await reopened.getOrCreateProfile("ShardCapKiller")).nicknameKey),
    goldBeforeShardFarm + SUBSTITUTE,
  );

  const secondA = await resolveShardKill("AmuletVictimA");
  assert.equal(secondA.shard, false);
  assert.equal(
    secondA.substitutedKinds.includes("shard"),
    false,
    "second kill of same victim must not shard-substitute after opportunity consumed",
  );
  assert.equal(secondA.substitutedGold, 0);
  assert.equal(
    await reopened.getGold((await reopened.getOrCreateProfile("ShardCapKiller")).nicknameKey),
    goldBeforeShardFarm + SUBSTITUTE,
    "no second shard-substitute gold from same victim",
  );

  const firstB = await resolveShardKill("AmuletVictimB");
  assert.equal(firstB.shard, false);
  assert.deepEqual(firstB.substitutedKinds, ["shard"]);
  assert.equal(firstB.substitutedGold, SUBSTITUTE);
  assert.equal(
    await reopened.getGold((await reopened.getOrCreateProfile("ShardCapKiller")).nicknameKey),
    goldBeforeShardFarm + SUBSTITUTE * 2,
    "different amulet victim remains eligible once",
  );

  await reopened.flushNamespace();
  await reopened.close();

  console.log("[economy-persistence] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

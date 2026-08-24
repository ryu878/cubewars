// EPIC 26 regression: career K/D + endless personal bests survive DB reopen;
// kill-drop overflow substitutes gold when a rolled item cannot be granted.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ECONOMY_CAPS,
  GOLD_DROP_MAX,
  GOLD_DROP_MIN,
  STIMULATOR_SOFT_CAP,
} from "@cubewars/shared";
import { EconomyStore } from "../server/src/economy/index.js";
import { MatchManager } from "../server/src/matchManager.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cubewars-economy-persist-"));
const dbPath = path.join(tmpDir, "economy.sqlite");

const store = EconomyStore.open(dbPath);

// --- Career K/D write-through ---
const kd1 = store.incrementCareerKillDeath("Ace", "Victim");
assert.equal(kd1.attacker.kills, 1);
assert.equal(kd1.attacker.deaths, 0);
assert.equal(kd1.victim.kills, 0);
assert.equal(kd1.victim.deaths, 1);

store.incrementCareerKillDeath("Ace", "Victim");
store.incrementCareerKillDeath("Ace", "Other");
const board = store.listCareerLeaderboard();
assert.equal(board[0]!.nickname, "Ace");
assert.equal(board[0]!.kills, 3);
assert.equal(board[0]!.deaths, 0);
const victimRow = board.find((e) => e.nickname === "Victim");
assert.ok(victimRow);
assert.equal(victimRow!.deaths, 2);

// --- Endless personal bests ---
const endless1 = store.upsertEndlessBest("Runner", 5, 1.25);
assert.equal(endless1.botKills, 5);
assert.equal(endless1.distanceKm, 1.25);
const endless2 = store.upsertEndlessBest("Runner", 4, 2.0);
assert.equal(endless2.botKills, 5, "bot kills must keep max");
assert.equal(endless2.distanceKm, 2.0, "distance must keep max");
store.upsertEndlessBest("Runner", 10, 0.5);
const endlessBoard = store.listEndlessLeaderboard();
assert.equal(endlessBoard[0]!.nickname, "Runner");
assert.equal(endlessBoard[0]!.botKills, 10);
assert.equal(endlessBoard[0]!.distanceKm, 2.0);

const goldBeforeClose = store.getOrCreateProfile("Ace").gold;
store.addGold("Ace", 42);
assert.equal(store.getGold(store.getOrCreateProfile("Ace").nicknameKey), goldBeforeClose + 42);

store.close();

// --- Reopen: values equal ---
const reopened = EconomyStore.open(dbPath);
const careerAfter = reopened.listCareerLeaderboard();
const ace = careerAfter.find((e) => e.nickname === "Ace");
assert.ok(ace, "Ace career must survive reopen");
assert.equal(ace!.kills, 3);
assert.equal(ace!.deaths, 0);
const endlessAfter = reopened.listEndlessLeaderboard();
assert.equal(endlessAfter[0]!.botKills, 10);
assert.equal(endlessAfter[0]!.distanceKm, 2.0);
assert.equal(reopened.getOrCreateProfile("Ace").gold, goldBeforeClose + 42);

// Killing after reopen continues to add (not reset).
reopened.incrementCareerKillDeath("Ace", "Victim");
assert.equal(reopened.listCareerLeaderboard().find((e) => e.nickname === "Ace")!.kills, 4);

// MatchManager hydrate from store.
const mgr = new MatchManager({ economy: reopened });
const hydrated = mgr.listLeaderboard();
assert.ok(hydrated.some((e) => e.nickname === "Ace" && e.kills === 4));
const hydratedEndless = mgr.listEndlessLeaderboard();
assert.ok(hydratedEndless.some((e) => e.nickname === "Runner" && e.botKills === 10));
// Tear down tick loops so the process can exit.
for (const summary of mgr.listPublicMatches()) {
  mgr.destroyMatch(summary.id);
}

// --- Overflow → gold when egg grant blocked ---
const eggFarmer = reopened.getOrCreateProfile("EggFarmer");
const now = Date.now();
while (reopened.listEggs(eggFarmer.id).length < ECONOMY_CAPS.eggs) {
  reopened.grantEgg("EggFarmer", now, 1);
}
assert.equal(reopened.listEggs(eggFarmer.id).length, ECONOMY_CAPS.eggs);
const goldBeforeSub = reopened.getGold(eggFarmer.nicknameKey);
const SUBSTITUTE = 137;
assert.ok(SUBSTITUTE >= GOLD_DROP_MIN && SUBSTITUTE <= GOLD_DROP_MAX);
const drops = reopened.resolveKillDrops(
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
assert.equal(reopened.getGold(eggFarmer.nicknameKey), goldBeforeSub + SUBSTITUTE);

// Stim soft-cap: chance hits but grant blocked → substitute gold.
reopened.getOrCreateProfile("StimFarmer");
while (reopened.countStimulators(reopened.getOrCreateProfile("StimFarmer").id) < STIMULATOR_SOFT_CAP) {
  reopened.grantStimulator("StimFarmer", now);
}
const stimGoldBefore = reopened.getGold(reopened.getOrCreateProfile("StimFarmer").nicknameKey);
const stimDrops = reopened.resolveKillDrops(
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
  reopened.getGold(reopened.getOrCreateProfile("StimFarmer").nicknameKey),
  stimGoldBefore + SUBSTITUTE,
);

reopened.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("[economy-persistence] PASS");

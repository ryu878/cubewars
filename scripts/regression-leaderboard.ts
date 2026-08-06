// EPIC 21 regression: nickname leaderboard aggregates kills/deaths, sorts
// top players first, and caps the public list at 20 entries.

import assert from "node:assert/strict";
import { LEADERBOARD_LIMIT } from "@cubewars/shared";
import { MatchManager, PUBLIC_MATCH_ID } from "../server/src/matchManager.js";

const manager = new MatchManager();

for (let i = 0; i < 25; i++) {
  const nickname = `Player${String(i).padStart(2, "0")}`;
  for (let kill = 0; kill < i; kill++) {
    manager.recordKill(nickname, `Victim${i}-${kill}`);
  }
}

for (let i = 0; i < 30; i++) {
  manager.recordKill("TieLowDeaths", `TieVictimA${i}`);
  manager.recordKill("TieHighDeaths", `TieVictimB${i}`);
}
manager.recordKill("OtherA", "TieHighDeaths");
manager.recordKill("OtherB", "TieHighDeaths");

const entries = manager.listLeaderboard();
assert.equal(entries.length, LEADERBOARD_LIMIT, "leaderboard should be capped to top 20");
assert.equal(entries[0].nickname, "TieLowDeaths", "highest kill count and fewer deaths should sort first");
assert.equal(entries[0].kills, 30);

const tieLow = entries.findIndex((entry) => entry.nickname === "TieLowDeaths");
const tieHigh = entries.findIndex((entry) => entry.nickname === "TieHighDeaths");
assert.ok(tieLow >= 0 && tieHigh >= 0, "tie entries should be present");
assert.ok(tieLow < tieHigh, "with equal kills, fewer deaths should sort higher");

for (let i = 1; i < entries.length; i++) {
  const prev = entries[i - 1];
  const next = entries[i];
  assert.ok(
    prev.kills > next.kills ||
      (prev.kills === next.kills && prev.deaths <= next.deaths) ||
      (prev.kills === next.kills && prev.deaths === next.deaths && prev.nickname.localeCompare(next.nickname) <= 0),
    `leaderboard sort order broken at ${prev.nickname} -> ${next.nickname}`,
  );
}

manager.destroyMatch(PUBLIC_MATCH_ID);
console.log("[leaderboard] PASS");

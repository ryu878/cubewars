// EPIC 23 regression: economy gold grants stay in [GOLD_DROP_MIN, GOLD_DROP_MAX],
// persist across DB reopen, and never go negative.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GOLD_DROP_MAX, GOLD_DROP_MIN } from "@cubewars/shared";
import { EconomyStore } from "../server/src/economy/index.js";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cubewars-economy-"));
const dbPath = path.join(tmpDir, "economy.sqlite");

function assertInDropRange(amount: number): void {
  assert.ok(
    amount >= GOLD_DROP_MIN && amount <= GOLD_DROP_MAX,
    `gold grant ${amount} outside [${GOLD_DROP_MIN}, ${GOLD_DROP_MAX}]`,
  );
}

const store = EconomyStore.open(dbPath);
const profile = store.getOrCreateProfile("GoldRunner");
assert.equal(profile.gold, 0, "new profile starts at 0 gold");
assert.equal(store.getGold(profile.nicknameKey), 0);

const grants: number[] = [];
for (let i = 0; i < 40; i++) {
  const before = store.getGold(profile.nicknameKey);
  // Mirror match.ts inclusive band: randomInt(min, max+1).
  const gained = GOLD_DROP_MIN + Math.floor(Math.random() * (GOLD_DROP_MAX - GOLD_DROP_MIN + 1));
  assertInDropRange(gained);
  const updated = store.addGold(profile.nickname, gained);
  grants.push(gained);
  assert.equal(updated.gold, before + gained, "addGold must increase by exact grant");
  assert.ok(updated.gold >= 0, "gold must never be negative after grant");
}

const totalGranted = grants.reduce((sum, n) => sum + n, 0);
assert.equal(store.getGold(profile.nicknameKey), totalGranted);

assert.throws(() => store.addGold(profile.nickname, -1), /non-negative/);
assert.throws(() => store.addGold(profile.nickname, Number.NaN), /non-negative/);
assert.equal(store.getGold(profile.nicknameKey), totalGranted, "rejected addGold must not change balance");

store.close();

const reopened = EconomyStore.open(dbPath);
const restored = reopened.getProfile(profile.nicknameKey);
assert.ok(restored, "profile must exist after reopen");
assert.equal(restored.gold, totalGranted, "gold must persist across DB reopen");
assert.equal(reopened.getOrCreateProfile("GoldRunner").gold, totalGranted);

reopened.close();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log("[economy-gold] PASS");

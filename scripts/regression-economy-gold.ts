// EPIC 23/27 regression: economy gold grants stay in [GOLD_DROP_MIN, GOLD_DROP_MAX],
// persist across Redis reopen (new connection), and never go negative.

import assert from "node:assert/strict";
import { GOLD_DROP_MAX, GOLD_DROP_MIN } from "@cubewars/shared";
import { EconomyStore } from "../server/src/economy/index.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

function assertInDropRange(amount: number): void {
  assert.ok(
    amount >= GOLD_DROP_MIN && amount <= GOLD_DROP_MAX,
    `gold grant ${amount} outside [${GOLD_DROP_MIN}, ${GOLD_DROP_MAX}]`,
  );
}

async function main(): Promise<void> {
  const store = await openTestEconomyStore();
  const prefix = store.keyPrefix;
  const redisUrl = store.redisUrl;

  const profile = await store.getOrCreateProfile("GoldRunner");
  assert.equal(profile.gold, 0, "new profile starts at 0 gold");
  assert.equal(await store.getGold(profile.nicknameKey), 0);

  const grants: number[] = [];
  for (let i = 0; i < 40; i++) {
    const before = await store.getGold(profile.nicknameKey);
    const gained = GOLD_DROP_MIN + Math.floor(Math.random() * (GOLD_DROP_MAX - GOLD_DROP_MIN + 1));
    assertInDropRange(gained);
    const updated = await store.addGold(profile.nickname, gained);
    grants.push(gained);
    assert.equal(updated.gold, before + gained, "addGold must increase by exact grant");
    assert.ok(updated.gold >= 0, "gold must never be negative after grant");
  }

  const totalGranted = grants.reduce((sum, n) => sum + n, 0);
  assert.equal(await store.getGold(profile.nicknameKey), totalGranted);

  await assert.rejects(() => store.addGold(profile.nickname, -1), /non-negative/);
  await assert.rejects(() => store.addGold(profile.nickname, Number.NaN), /non-negative/);
  assert.equal(await store.getGold(profile.nicknameKey), totalGranted, "rejected addGold must not change balance");

  await store.close();

  // New Redis connection (same namespace) — proves data survived process reopen.
  const reopened = await EconomyStore.open({
    redisUrl,
    keyPrefix: prefix,
    skipSqliteImport: true,
  });
  const restored = await reopened.getProfile(profile.nicknameKey);
  assert.ok(restored, "profile must exist after reopen");
  assert.equal(restored.gold, totalGranted, "gold must persist across Redis reopen");
  assert.equal((await reopened.getOrCreateProfile("GoldRunner")).gold, totalGranted);

  await reopened.flushNamespace();
  await reopened.close();

  console.log("[economy-gold] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// EPIC 32 regression: killing a bot victim grants NO economy reward at all
// (no gold, no items, no economy_gold_update/economy_profile send, no
// "gold minted" log line) — only a human-victim kill feeds the economy.
// Drives the real Match.grantKillGold() gating logic directly (not just
// EconomyStore.addGold()), via a fake WebSocket so no real network/client is
// needed.

import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { GOLD_DROP_MAX, GOLD_DROP_MIN } from "@cubewars/shared";
import { Match } from "../server/src/match.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

/** Minimal fake `ws` socket: readyState/OPEN match so match.ts's `socket.readyState === socket.OPEN` send-gates pass, and every sent frame is recorded for assertions. */
function fakeSocket(sent: string[]): WebSocket {
  return {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => {
      sent.push(data);
    },
  } as unknown as WebSocket;
}

/** Capture console.log lines emitted during `fn()` without silencing them for the rest of the process (restored in a finally). */
async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
    original(...args);
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

async function main(): Promise<void> {
  const store = await openTestEconomyStore();

  const match = new Match({ id: "bot-kill-no-reward-test", mode: "bots", economy: store });
  // Access the private reward-gating method directly — this regression's whole
  // point is to exercise Match.grantKillGold()'s gating, not just the
  // underlying EconomyStore primitives (those are covered by
  // regression-economy-gold.ts already).
  const grantKillGold = (match as unknown as {
    grantKillGold: (shooterId: string, victimId: string) => Promise<void>;
  }).grantKillGold.bind(match);

  const sentA: string[] = [];
  await match.addHuman("human-a", fakeSocket(sentA), "KillerA", "killera");

  const killerKey = (await store.getOrCreateProfile("KillerA")).nicknameKey;
  const goldBeforeBotKill = await store.getGold(killerKey);

  // --- Case 1: human kills a bot victim ("Bot 1", spawned automatically by
  // mode "bots") -> zero gold, zero items, zero economy sends, no "gold
  // minted" log line, and an explicit "no reward" log line instead. ---
  sentA.length = 0;
  const botKillLogs = await captureLogs(() => grantKillGold("human-a", "Bot 1"));

  const goldAfterBotKill = await store.getGold(killerKey);
  assert.equal(goldAfterBotKill, goldBeforeBotKill, "bot-victim kill must not mint any gold");
  assert.equal(sentA.length, 0, "bot-victim kill must not send any economy message to the killer");
  assert.ok(
    !botKillLogs.some((l) => l.includes("[economy] gold minted")),
    "bot-victim kill must not log a gold-minted line",
  );
  assert.ok(
    !botKillLogs.some((l) => l.includes("[economy] kill item drops")),
    "bot-victim kill must not log an item-drops line",
  );
  assert.ok(
    botKillLogs.some((l) => l.includes("[economy] kill vs bot victim -> no reward")),
    "bot-victim kill must log an explicit no-reward line (no silent no-op)",
  );

  // --- Case 2: human kills a human victim -> unchanged behavior (gold minted
  // in range, economy_gold_update sent, "gold minted" log line present). ---
  const sentB: string[] = [];
  await match.addHuman("human-b", fakeSocket(sentB), "VictimB", "victimb");

  sentA.length = 0;
  const humanKillLogs = await captureLogs(() => grantKillGold("human-a", "human-b"));

  const goldAfterHumanKill = await store.getGold(killerKey);
  const totalGained = goldAfterHumanKill - goldAfterBotKill;
  assert.ok(
    totalGained >= GOLD_DROP_MIN && totalGained <= GOLD_DROP_MAX * 2,
    // Upper bound is generous (2x GOLD_DROP_MAX) because an item-drop
    // overflow can add substitutedGold on top of the primary roll; the
    // primary roll alone is always within [GOLD_DROP_MIN, GOLD_DROP_MAX].
    `human-victim kill must mint gold, got ${totalGained}`,
  );
  assert.ok(
    humanKillLogs.some((l) => l.includes("[economy] gold minted")),
    "human-victim kill must log a gold-minted line",
  );
  const goldUpdateMsg = sentA
    .map((raw) => JSON.parse(raw) as { type: string; gold?: number; gained?: number })
    .find((m) => m.type === "economy_gold_update");
  assert.ok(goldUpdateMsg, "human-victim kill must send economy_gold_update to the killer");
  assert.equal(goldUpdateMsg!.gold, goldAfterHumanKill, "economy_gold_update.gold must match store balance");
  assert.equal(goldUpdateMsg!.gained, totalGained, "economy_gold_update.gained must match total minted");

  await store.flushNamespace();
  await store.close();

  console.log("[bot-kill-no-reward] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

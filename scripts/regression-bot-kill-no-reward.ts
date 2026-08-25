// EPIC 32 + EPIC 35 regression:
// - Deathmatch (public): bot / non-human victims grant NO economy reward.
// - Sandbox (bots mode): bot-victim kills DO reward, but only into the sandbox pool.
// Drives Match.grantKillGold() directly via a fake WebSocket.

import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { GOLD_DROP_MAX, GOLD_DROP_MIN } from "@cubewars/shared";
import { Match } from "../server/src/match.js";
import { openTestEconomyStore } from "./economy-test-helpers.js";

/** Minimal fake `ws` socket: readyState/OPEN match so match.ts's send-gates pass. */
function fakeSocket(sent: string[]): WebSocket {
  return {
    readyState: 1,
    OPEN: 1,
    send: (data: string) => {
      sent.push(data);
    },
  } as unknown as WebSocket;
}

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

  // --- Case 1: public/deathmatch — non-human victim → zero reward (EPIC 32). ---
  const publicMatch = new Match({
    id: "bot-kill-no-reward-public",
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
  const killerKey = (await store.getOrCreateProfile("KillerA", "deathmatch")).nicknameKey;
  const goldBefore = await store.getGold(killerKey, "deathmatch");

  sentPublic.length = 0;
  const noHumanLogs = await captureLogs(() => grantPublic("human-a", "ghost-bot"));

  assert.equal(
    await store.getGold(killerKey, "deathmatch"),
    goldBefore,
    "deathmatch non-human victim must not mint gold",
  );
  assert.equal(sentPublic.length, 0, "deathmatch non-human victim must not send economy messages");
  assert.ok(
    noHumanLogs.some((l) => l.includes("[economy] kill vs bot victim -> no reward")),
    "deathmatch non-human victim must log an explicit no-reward line",
  );

  // Human-vs-human in public still mints into deathmatch.
  const sentB: string[] = [];
  await publicMatch.addHuman("human-b", fakeSocket(sentB), "VictimB", "victimb");
  sentPublic.length = 0;
  const humanKillLogs = await captureLogs(() => grantPublic("human-a", "human-b"));
  const goldAfterHuman = await store.getGold(killerKey, "deathmatch");
  const totalGained = goldAfterHuman - goldBefore;
  assert.ok(
    totalGained >= GOLD_DROP_MIN && totalGained <= GOLD_DROP_MAX * 2,
    `human-victim deathmatch kill must mint gold, got ${totalGained}`,
  );
  assert.ok(
    humanKillLogs.some((l) => l.includes("[economy] gold minted") && l.includes("scope=deathmatch")),
    "human-victim kill must log gold-minted with deathmatch scope",
  );
  assert.equal(
    (await store.getGold(killerKey, "sandbox")),
    0,
    "deathmatch human kill must not write sandbox gold",
  );

  // --- Case 2: bots/sandbox — bot victim rewards sandbox only (EPIC 35). ---
  const botsMatch = new Match({
    id: "bot-kill-sandbox-reward",
    mode: "bots",
    economy: store,
  });
  const grantBots = (
    botsMatch as unknown as {
      grantKillGold: (shooterId: string, victimId: string) => Promise<void>;
    }
  ).grantKillGold.bind(botsMatch);

  const sentSandbox: string[] = [];
  await botsMatch.addHuman("human-s", fakeSocket(sentSandbox), "SandboxKiller", "sandboxkiller");
  const sbKey = (await store.getOrCreateProfile("SandboxKiller", "sandbox")).nicknameKey;
  const sbBefore = await store.getGold(sbKey, "sandbox");
  const dmBefore = await store.getGold(sbKey, "deathmatch");

  sentSandbox.length = 0;
  const botKillLogs = await captureLogs(() => grantBots("human-s", "Bot 1"));
  const sbAfter = await store.getGold(sbKey, "sandbox");
  const dmAfter = await store.getGold(sbKey, "deathmatch");

  assert.ok(sbAfter > sbBefore, "sandbox bot-victim kill must mint sandbox gold");
  assert.equal(dmAfter, dmBefore, "sandbox bot-victim kill must not change deathmatch gold");
  assert.ok(
    botKillLogs.some((l) => l.includes("[economy] gold minted") && l.includes("scope=sandbox")),
    "sandbox bot kill must log gold-minted with sandbox scope",
  );
  assert.ok(
    !botKillLogs.some((l) => l.includes("kill vs bot victim -> no reward")),
    "sandbox bot kill must not use the deathmatch no-reward path",
  );

  await store.flushNamespace();
  await store.close();

  console.log("[bot-kill-no-reward] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// EPIC 37 regression: the competitive leaderboard is fed ONLY by "public"-mode
// kills. A "bots"-mode kill (practice match vs AI) must NOT call
// `onKillRecorded` (and therefore must not touch
// `EconomyStore.incrementCareerKillDeath()` / the leaderboard at all) — this
// covers both the human's inflated kill count and the bogus "Bot N"
// leaderboard entry bug. "public"-mode kills must still call it exactly as
// before (no regression). "endless"-mode kills were already correctly
// excluded and must remain so, untouched by this change.
//
// Drives `Match.broadcastDamageEvents()` (private) directly with a synthetic
// `killed: true` DamageEvent — this exercises the real kill-resolution
// mode-gating branch in server/src/match.ts without needing a full
// hitscan/raycast setup (that combat math is already covered by
// regression-locational-splash-damage.ts and friends).

import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import type { DamageEvent } from "../server/src/playerRegistry.js";
import { Match } from "../server/src/match.js";

/** Minimal fake `ws` socket: readyState/OPEN match so match.ts's `socket.readyState === socket.OPEN` send-gates pass; sent frames are discarded (not under test here). */
function fakeSocket(): WebSocket {
  return {
    readyState: 1,
    OPEN: 1,
    send: () => {},
  } as unknown as WebSocket;
}

function fakeDamageEvent(targetId: string, targetHealth = 0): DamageEvent {
  return {
    targetId,
    damage: 999,
    damageKind: "direct",
    hitZone: "body",
    targetHealth,
    targetArmor: 0,
    point: { x: 0, y: 0, z: 0 },
    killed: true,
    respawnAtMs: null,
  };
}

/** Access the private `broadcastDamageEvents` method directly, same reflection pattern as regression-bot-kill-no-reward.ts's `grantKillGold` access. */
function getBroadcastDamageEvents(
  match: Match,
): (shooterId: string, damageEvents: DamageEvent[]) => void {
  return (
    match as unknown as {
      broadcastDamageEvents: (shooterId: string, damageEvents: DamageEvent[]) => void;
    }
  ).broadcastDamageEvents.bind(match);
}

async function main(): Promise<void> {
  // --- Case 1: "bots" mode — human kills a bot victim -> onKillRecorded must
  // NOT be called at all (no leaderboard row for the human, no bogus "Bot N"
  // entry). ---
  {
    const recorded: Array<[string, string]> = [];
    const match = new Match({
      id: "leaderboard-excludes-bots-test-bots",
      mode: "bots",
      onKillRecorded: (attacker, victim) => recorded.push([attacker, victim]),
    });
    await match.addHuman("human-a", fakeSocket(), "KillerBots", "killerbots");
    const broadcastDamageEvents = getBroadcastDamageEvents(match);

    broadcastDamageEvents("human-a", [fakeDamageEvent("Bot 1")]);

    assert.equal(
      recorded.length,
      0,
      "a bots-mode kill must not call onKillRecorded (leaderboard must be untouched)",
    );
  }

  // --- Case 2: "public" mode — human kills a human victim -> onKillRecorded
  // must still fire exactly as before this change (no regression). ---
  {
    const recorded: Array<[string, string]> = [];
    const match = new Match({
      id: "leaderboard-excludes-bots-test-public",
      mode: "public",
      onKillRecorded: (attacker, victim) => recorded.push([attacker, victim]),
    });
    await match.addHuman("human-a", fakeSocket(), "KillerPublic", "killerpublic");
    await match.addHuman("human-b", fakeSocket(), "VictimPublic", "victimpublic");
    const broadcastDamageEvents = getBroadcastDamageEvents(match);

    broadcastDamageEvents("human-a", [fakeDamageEvent("human-b")]);

    assert.deepEqual(
      recorded,
      [["KillerPublic", "VictimPublic"]],
      "a public-mode kill must call onKillRecorded with (attackerNickname, victimNickname) unchanged",
    );
  }

  // --- Case 3: "endless" mode — human kills a bot victim -> onKillRecorded
  // must still NOT be called (already correct pre-EPIC-37, must remain
  // untouched), and endless's own progress tracking still runs. ---
  {
    const recorded: Array<[string, string]> = [];
    const match = new Match({
      id: "leaderboard-excludes-bots-test-endless",
      mode: "endless",
      onKillRecorded: (attacker, victim) => recorded.push([attacker, victim]),
    });
    await match.addHuman("human-a", fakeSocket(), "KillerEndless", "killerendless");
    // Spawn a real endless bot so the kill-resolution endless branch
    // (isBot / removeBot / endlessBotKills) is exercised, not just the
    // onKillRecorded gate.
    const botId = "leaderboard-excludes-bots-test-endless:Bot 1";
    match.botAI!.spawnBotAt(botId, { x: 0, y: 0, z: -80 }, "Bot 1");
    const botKillsBefore = (
      match as unknown as { endlessBotKills: number }
    ).endlessBotKills;
    const broadcastDamageEvents = getBroadcastDamageEvents(match);

    broadcastDamageEvents("human-a", [fakeDamageEvent(botId)]);

    assert.equal(
      recorded.length,
      0,
      "an endless-mode kill must not call onKillRecorded (unchanged pre-existing behavior)",
    );
    assert.equal(
      (match as unknown as { endlessBotKills: number }).endlessBotKills,
      botKillsBefore + 1,
      "endless bot-kill progress tracking must still increment (unchanged)",
    );
    assert.equal(
      match.botAI!.isBot(botId),
      false,
      "endless kill must still remove the bot via botAI.removeBot (unchanged)",
    );
  }

  console.log("[leaderboard-excludes-bots] PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

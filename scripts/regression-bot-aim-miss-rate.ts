// EPIC 11 Story 11.4 regression/evidence script: statistically verifies that
// bots (server/src/botAI.ts ENGAGING state) now demonstrably miss shots at
// realistic engagement range, rather than "aimbot precise" (the user's
// explicit complaint this Story addresses), while still hitting reasonably
// often up close.
//
// Uses the real PlayerRegistry + BotAI classes directly (no WS/HTTP layer
// needed for this) — a bot and a stationary "target" player are placed at a
// fixed distance apart, in the mid-lane corridor (shared/src/mapData.ts,
// clear straight line-of-sight, no crates/walls in the way at z=0), and the
// bot AI is ticked repeatedly. Every accepted fire is inspected via the same
// registry.fire() outcome the bot's own resolveFire() callback receives, so
// this exercises the exact production fire path (registry.fire() ->
// performHitscan(), shared/src/combat.ts / server/src/combat.ts) —
// completely unmodified by EPIC 11 Story 11.4, only botAI.ts's aim jitter
// upstream of it changed.
//
// Run: npx tsx scripts/regression-bot-aim-miss-rate.ts
// (or `npm run regression:bot-aim-miss-rate` from the repo root)

import { PlayerRegistry } from "../server/src/playerRegistry.js";
import { BotAI } from "../server/src/botAI.js";

const TICK_DT_SECONDS = 1 / 20;
// Fire cooldown for the bot's baseline pistol (shared/src/weapons.ts) —
// ticking well past it every attempt loop below so each attempt gets a
// fresh chance to fire once aimed.
const TICKS_PER_ATTEMPT = 40; // 2s of ticks at 20Hz, comfortably longer than the pistol's cooldown

interface DistanceResult {
  distance: number;
  attempts: number;
  hits: number;
  misses: number;
  fired: number;
}

function runAtDistance(distance: number, attempts: number): DistanceResult {
  const registry = new PlayerRegistry();
  const botAI = new BotAI(registry);
  botAI.setTickDtSeconds(TICK_DT_SECONDS);

  const [botId] = botAI.spawnBots(1);
  const targetId = "test-target";
  registry.spawn(targetId);

  // Place both in the mid-lane corridor (x in [-20,20], z=0 — clear of the
  // crate cover, which only spans z in [-2.25,-0.75] and [0.75,2.25]), so
  // there's guaranteed clear line-of-sight at every tested distance.
  const bot = registry.getPlayer(botId)!;
  const target = registry.getPlayer(targetId)!;
  // EPIC 36: clear spawn protection so aim-miss statistics measure aim jitter,
  // not the post-spawn invincibility window.
  bot.spawnProtectedUntilMs = 0;
  target.spawnProtectedUntilMs = 0;
  bot.position.x = -distance / 2;
  bot.position.z = 0;
  target.position.x = distance / 2;
  target.position.z = 0;

  let hits = 0;
  let fired = 0;

  for (let attempt = 0; attempt < attempts; attempt++) {
    // Reset target health/position every attempt so a kill/respawn mid-run
    // doesn't change the geometry being tested, and so ammo/cooldown state
    // for the bot behaves like a fresh engagement each time.
    target.health = 100;
    target.alive = true;
    target.spawnProtectedUntilMs = 0;
    target.position.x = distance / 2;
    target.position.z = 0;
    bot.position.x = -distance / 2;
    bot.position.z = 0;

    let firedThisAttempt = false;
    for (let tick = 0; tick < TICKS_PER_ATTEMPT && !firedThisAttempt; tick++) {
      const nowMs = attempt * 10_000 + tick * (TICK_DT_SECONDS * 1000); // spaced far apart so per-bot cooldown never spans attempts
      botAI.update(nowMs, (shooterId) => {
        const outcome = registry.fire(shooterId);
        if (outcome.hit) {
          hits += 1;
        }
        firedThisAttempt = true;
      });
      registry.step(TICK_DT_SECONDS);
    }
    if (firedThisAttempt) fired += 1;
  }

  return { distance, attempts, hits, misses: fired - hits, fired };
}

function main(): void {
  const attemptsPerDistance = 200;
  const distances = [3, 10, 20, 30];

  console.log(
    `Firing a bot at a stationary target ${attemptsPerDistance} times per distance, mid-lane corridor, clear LOS...\n`,
  );

  const rows: string[] = [];
  for (const distance of distances) {
    const result = runAtDistance(distance, attemptsPerDistance);
    const hitRatePct = result.fired > 0 ? (result.hits / result.fired) * 100 : 0;
    rows.push(
      `distance=${String(distance).padStart(3)}m  fired=${result.fired}/${result.attempts}  hits=${result.hits}  misses=${result.misses}  hitRate=${hitRatePct.toFixed(1)}%`,
    );
  }

  console.log(rows.join("\n"));

  // Sanity checks matching Story 11.4's acceptance criteria: close-range
  // shots mostly land, longer-range shots demonstrably miss sometimes (not
  // literally 100% hit rate at any tested distance beyond point-blank).
  const near = runAtDistance(3, attemptsPerDistance);
  const far = runAtDistance(30, attemptsPerDistance);
  const nearHitRate = near.fired > 0 ? near.hits / near.fired : 0;
  const farHitRate = far.fired > 0 ? far.hits / far.fired : 0;

  let anyFailed = false;
  if (nearHitRate < 0.6) {
    console.log(`\nFAIL: close-range (3m) hit rate ${(nearHitRate * 100).toFixed(1)}% is below the 60% fairness floor.`);
    anyFailed = true;
  }
  if (farHitRate > 0.9) {
    console.log(`\nFAIL: long-range (30m) hit rate ${(farHitRate * 100).toFixed(1)}% shows no meaningful miss rate.`);
    anyFailed = true;
  }
  if (!anyFailed) {
    console.log(
      `\nPASS: close-range hit rate ${(nearHitRate * 100).toFixed(1)}% stays reasonably high, long-range hit rate ${(farHitRate * 100).toFixed(1)}% shows a real miss rate.`,
    );
  }

  process.exit(anyFailed ? 1 : 0);
}

main();

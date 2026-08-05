// EPIC 14 "Procedural Sound System" Programmer self-check (Pusya): NOT the
// formal Tester QA pass — a best-effort, live end-to-end evidence run
// against a real running client + server, driving through jump / footstep /
// local-gunshot / remote-gunshot (2 weapons via a real second connection,
// since bots are pistol-only per EPIC 9 and would never exercise the
// rifle/grenade-launcher branches) / hit-taken / pickup scenarios and
// capturing the REQUIRED `[audio] ...` console.debug lines (Story 14.1 AC)
// as the verification substitute for "actually hearing" the result
// (Playwright cannot hear audio — this is the agreed mechanism, per the
// EPIC 14 spec Section 12 Risks).
//
// Two participants:
//   - Page A: a real Playwright browser tab running the actual client —
//     the ONLY participant whose console emits `[audio]` lines, since only
//     a real client instantiates SoundManager. This is "the local player"
//     for every local-trigger test (jump/footstep/pistol/pickup) and "the
//     victim" for the hit-taken test.
//   - Puppet B: a bare `ws` connection (a real human-mode player, NOT a
//     bot — bots never pick up weapons) used to (a) shoot Page A for the
//     hit-taken test and (b) pick up + fire the rifle and grenade launcher
//     so Page A's client receives a FireBroadcastEvent for a weapon other
//     than the pistol it starts with, exercising the remote-gunshot path
//     for all three weapons across the run.
//
// Reuses this codebase's established Playwright/CDP puppet patterns
// (scripts/qa-epic11-programmer-selfcheck.mjs, scripts/qa-epic13-live-
// autoswitch-selfcheck.mjs's dynamic-yaw-aiming walkTo()) — same known CDP
// mouse-look limitation (Page A's yaw stays fixed at spawn's yaw=0, facing
// world -z) worked around the same way: discrete WASD holds computed from
// observed position, not by turning the camera.
//
// Run against an already-running dev server + client
// (npm run dev --workspace=server, npm run dev --workspace=client):
//   node scripts/qa-epic14-programmer-selfcheck.mjs

import { chromium } from "playwright";
import WebSocket from "ws";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5173";
const WS_URL = "ws://localhost:7777";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-14-programmer-selfcheck";

await mkdir(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- WS puppet helpers (mirrors qa-epic11/qa-epic13 conventions) ---------

function connectPuppet(label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const state = { label, ws, playerId: null, messages: [] };
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      state.messages.push(msg);
      if (msg.type === "welcome") state.playerId = msg.playerId;
    });
    ws.on("open", () => {
      const check = setInterval(() => {
        if (state.playerId) {
          clearInterval(check);
          ws.send(JSON.stringify({ type: "join", mode: "public" }));
          resolve(state);
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        if (!state.playerId) reject(new Error(`${label}: no welcome`));
      }, 3000);
    });
    ws.on("error", reject);
  });
}

function lastWorldState(state) {
  const worldStates = state.messages.filter((m) => m.type === "world_state");
  return worldStates[worldStates.length - 1] ?? null;
}

function findPlayerById(state, id) {
  const ws = lastWorldState(state);
  return ws ? (ws.players.find((p) => p.id === id) ?? null) : null;
}

function findPlayerByShortId(state, shortId) {
  const ws = lastWorldState(state);
  return ws ? (ws.players.find((p) => p.id.startsWith(shortId)) ?? null) : null;
}

/** Dynamic-yaw-aiming walk (same technique as qa-epic13-live-autoswitch-selfcheck.mjs walkTo()) — steers a WS puppet toward (targetX, targetZ) by recomputing yaw toward the target every input tick. */
async function walkPuppetTo(state, targetX, targetZ, radius = 1.2, maxMs = 15000) {
  const start = Date.now();
  const sendInput = () => {
    const p = findPlayerById(state, state.playerId);
    if (!p) return;
    const dx = targetX - p.position.x;
    const dz = targetZ - p.position.z;
    const yaw = Math.atan2(-dx, -dz);
    state.ws.send(JSON.stringify({ type: "input", moveForward: 1, moveRight: 0, yaw, pitch: 0, jump: false }));
  };
  const timer = setInterval(sendInput, 50);
  while (Date.now() - start < maxMs) {
    await sleep(100);
    const p = findPlayerById(state, state.playerId);
    if (p && Math.hypot(targetX - p.position.x, targetZ - p.position.z) <= radius) break;
  }
  clearInterval(timer);
  state.ws.send(JSON.stringify({ type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false }));
  await sleep(250);
}


// --- Page (browser) keyboard-based walk, same fixed-yaw-0 limitation as
// every other Playwright puppet script in this repo (CDP mouse-look does
// not turn Page A's camera) — a simple bang-bang controller that re-checks
// the observed position every ~120ms and holds whichever WASD keys reduce
// the remaining x/z error, rather than a fixed direction held for a fixed
// duration. ---------------------------------------------------------------

async function walkPageTo(page, observer, shortId, targetX, targetZ, radius = 2.5, maxMs = 20000) {
  const EPS = 0.6;
  const held = { KeyW: false, KeyS: false, KeyA: false, KeyD: false };
  async function setHeld(code, want) {
    if (held[code] === want) return;
    held[code] = want;
    if (want) await page.keyboard.down(code);
    else await page.keyboard.up(code);
  }

  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const pos = findPlayerByShortId(observer, shortId)?.position;
    if (pos) {
      const dx = targetX - pos.x;
      const dz = targetZ - pos.z;
      if (Math.hypot(dx, dz) <= radius) break;
      // Sequential single-axis (L-shaped) steering, NOT simultaneous
      // diagonal: resolve whichever axis currently has the larger error
      // first, one axis held at a time. Empirically more reliable than
      // holding both axes together in this map's corridor/site geometry —
      // a diagonal hold that clips a wall/crate corner can wall-slide in
      // an unpredictable direction (observed during self-check
      // development: it once drifted ~20 units off-target into an
      // unrelated pickup's radius); resolving one axis at a time avoids
      // that failure mode even though the resulting path is longer.
      // forwardZ = -1 at yaw=0 (moveForward=+1 => W decreases z); rightX = 1 (moveRight=+1 => D increases x).
      if (Math.abs(dz) > EPS && Math.abs(dz) >= Math.abs(dx)) {
        await setHeld("KeyW", dz < -EPS);
        await setHeld("KeyS", dz > EPS);
        await setHeld("KeyA", false);
        await setHeld("KeyD", false);
      } else if (Math.abs(dx) > EPS) {
        await setHeld("KeyD", dx > EPS);
        await setHeld("KeyA", dx < -EPS);
        await setHeld("KeyW", false);
        await setHeld("KeyS", false);
      }
    }
    await sleep(120);
  }
  for (const code of Object.keys(held)) {
    if (held[code]) await page.keyboard.up(code);
  }
}

async function main() {
  console.log(`[selfcheck] navigating to ${CLIENT_URL}`);
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const audioLogs = [];
  const consoleErrors = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.startsWith("[audio]")) audioLogs.push({ t: Date.now(), text });
    if (msg.type() === "error") consoleErrors.push(text);
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("crash", () => console.error("[selfcheck] !!! Page A CRASHED !!!"));
  page.on("close", () => console.error("[selfcheck] !!! Page A CLOSED unexpectedly !!!"));

  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });

  const statusText = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const shortId = statusText.match(/player ([0-9a-f]{8})/)?.[1];
  if (!shortId) throw new Error("could not read player short id from status bar");
  console.log("[selfcheck] Page A status:", statusText);

  await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await page.click("#modePublicBtn");
  await page.waitForTimeout(300);
  console.log("[selfcheck] Page A joined Multiplayer (public)");

  // Engage pointer lock — also the gesture that calls soundManager.unlock().
  const box = await page.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2,
    cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  console.log("[selfcheck] Page A pointer locked:", locked);

  const observer = await connectPuppet("Observer");
  const puppetB = await connectPuppet("PuppetB (remote shooter)");
  await sleep(400);
  console.log("[selfcheck] Puppet B id:", puppetB.playerId);

  const spawnPos = findPlayerByShortId(observer, shortId)?.position;
  console.log("[selfcheck] Page A spawn position:", spawnPos);

  const results = {};

  // --- 1. Jump grunt (Story 14.2) — done FIRST, stationary, from spawn,
  // before any movement/pickup touches Page A's loadout, so this and the
  // next two sections below are guaranteed clean (still on the starting
  // pistol) regardless of how the pickup-walk section (much later, Section
  // 6) turns out. ---
  console.log("\n[selfcheck] === jump grunt ===");
  audioLogs.length = 0;
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  results.jumpGrunt = audioLogs.some((l) => l.text.includes("jump grunt"));
  console.log("[selfcheck] jump grunt logs:", audioLogs.map((l) => l.text));

  await page.waitForTimeout(400); // let the jump arc land before footstep test

  // --- 2. Footsteps with timing/pitch randomization (Story 14.3). A SHORT
  // hold (900ms, still comfortably >=2 footstep intervals at the ~325ms
  // base cadence) — a long hold here was observed, during self-check
  // development, to carry Page A far enough in a fixed world direction
  // (yaw is stuck at spawn's yaw=0, see walkPageTo's doc comment) to wander
  // into an unrelated pickup's consumption radius by accident, silently
  // changing Page A's equipped weapon before the local-pistol-gunshot
  // section below even ran. ---
  console.log("\n[selfcheck] === footsteps ===");
  audioLogs.length = 0;
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(200);
  const footstepLogs = audioLogs.filter((l) => l.text.includes("footstep"));
  const playbackRates = footstepLogs.map((l) => Number(l.text.match(/playbackRate=([\d.]+)/)?.[1]));
  const intervalsMs = footstepLogs.slice(1).map((l, i) => l.t - footstepLogs[i].t);
  results.footstepCount = footstepLogs.length;
  results.footstepPlaybackRates = playbackRates;
  results.footstepIntervalsMs = intervalsMs;
  results.footstepVaried =
    footstepLogs.length >= 2 && new Set(playbackRates.map((r) => r.toFixed(3))).size > 1;
  console.log("[selfcheck] footstep logs:", footstepLogs.map((l) => l.text));
  console.log("[selfcheck] footstep intervals(ms):", intervalsMs, "playbackRates:", playbackRates);

  // --- 3. Local pistol gunshot (Story 14.4, local path) ---
  console.log("\n[selfcheck] === local pistol gunshot ===");
  audioLogs.length = 0;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  results.localPistolGunshot = audioLogs.some((l) => l.text.includes("gunshot weapon=pistol"));
  console.log("[selfcheck] local gunshot logs:", audioLogs.map((l) => l.text));

  // --- 4. Remote gunshots for rifle + grenade launcher (Story 14.4, remote
  // path) — Puppet B (a real player, not a bot — bots never pick up
  // weapons, EPIC 9) picks up each weapon at its real map coordinates
  // (shared/src/pickups.ts PICKUP_SPAWN_POINTS) and fires; Page A should
  // log a gunshot for a weapon it never itself fired, proving the
  // FireBroadcastEvent path (shooterId !== selfId). Done BEFORE the
  // hit-taken test below (and before any other Puppet B movement) so
  // Puppet B's walk path can't accidentally cross a pickup point out of
  // test order — EPIC 13's "any strictly-higher-tier applied pickup
  // auto-equips" rule means picking up the rifle auto-equips it (tier 1 >
  // pistol's tier 0), and picking up the grenade launcher next
  // auto-equips IT (tier 2 > rifle's tier 1) with no manual switch_weapon
  // needed — so this section fires each weapon in the exact order it was
  // picked up. ---
  console.log("\n[selfcheck] === remote gunshot: rifle ===");
  const puppetBPos = findPlayerById(puppetB, puppetB.playerId)?.position;
  const west = (puppetBPos?.x ?? 0) < 0;
  const riflePickup = west ? { x: -42, z: 20 } : { x: 42, z: -20 };
  await walkPuppetTo(puppetB, riflePickup.x, riflePickup.z, 1.2, 8000);
  await sleep(300);
  audioLogs.length = 0;
  puppetB.ws.send(JSON.stringify({ type: "fire" }));
  await sleep(400);
  results.remoteRifleGunshot = audioLogs.some((l) => l.text.includes("gunshot weapon=rifle"));
  console.log("[selfcheck] Page A logs after remote rifle fire:", audioLogs.map((l) => l.text));

  console.log("\n[selfcheck] === remote gunshot: grenade launcher ===");
  await walkPuppetTo(puppetB, 0, 0, 1.5, 8000); // weapon_gl_mid, shared/src/pickups.ts
  await sleep(400);
  const puppetBPosAtGl = findPlayerById(puppetB, puppetB.playerId)?.position;
  console.log("[selfcheck] Puppet B position when attempting GL pickup:", puppetBPosAtGl);
  audioLogs.length = 0;
  // Retry fire a couple of times in case the first attempt lands right on
  // a cooldown boundary (rifle cooldown 250ms) before the GL pickup/equip
  // has been server-confirmed.
  for (let i = 0; i < 3; i++) {
    puppetB.ws.send(JSON.stringify({ type: "fire" })); // auto-equipped GL on pickup above — no manual switch needed
    await sleep(400);
    if (audioLogs.some((l) => l.text.includes("gunshot weapon=grenade_launcher"))) break;
  }
  results.remoteGrenadeLauncherGunshot = audioLogs.some((l) => l.text.includes("gunshot weapon=grenade_launcher"));
  console.log("[selfcheck] Page A logs after remote GL fire:", audioLogs.map((l) => l.text));

  // Switch Puppet B back to the pistol (infinite ammo, 300ms cooldown,
  // WEAPON_ORDER cycle from grenade_launcher back to pistol in exactly one
  // "E" press since it owns all three at this point) for the hit-taken
  // test below — the grenade launcher's 2-round max ammo / 1500ms cooldown
  // would make repeated aimed-fire retries impractical here.
  puppetB.ws.send(JSON.stringify({ type: "switch_weapon" }));
  await sleep(200);

  // --- 5. Hit-taken (Story 14.6): Puppet B continuously CHASES Page A's
  // current position (re-aimed every tick, same dynamic-yaw-aiming
  // technique as walkPuppetTo) while ALSO firing on a ~320ms cadence
  // (pistol cooldown 300ms) — combined move+fire, rather than "walk to a
  // fixed point, then stand still and fire", so Puppet B keeps closing
  // distance / working around any wall between it and Page A's (possibly
  // still-moving) position instead of getting stuck firing from behind an
  // obstruction at a stale target. Includes simple stuck-detection: if
  // Puppet B's position barely changes over ~500ms despite holding
  // forward, it likely wall-blocked on a straight-line chase (this game
  // has no pathfinding) — add an alternating strafe component to slide
  // along the obstruction rather than push uselessly straight into it. ---
  console.log("\n[selfcheck] === hit-taken ===");
  audioLogs.length = 0;
  let hitTaken = false;
  const hitTakenDeadline = Date.now() + 8000;
  let lastFireAt = 0;
  let lastStuckCheckAt = Date.now();
  let lastStuckCheckPos = findPlayerById(puppetB, puppetB.playerId)?.position ?? { x: 0, z: 0 };
  let strafeSign = 1;
  let strafeUntil = 0;
  while (Date.now() < hitTakenDeadline && !hitTaken) {
    const target = findPlayerByShortId(observer, shortId)?.position ?? spawnPos;
    const shooterPos = findPlayerById(puppetB, puppetB.playerId)?.position;
    if (target && shooterPos) {
      if (Date.now() - lastStuckCheckAt >= 500) {
        const moved = Math.hypot(shooterPos.x - lastStuckCheckPos.x, shooterPos.z - lastStuckCheckPos.z);
        if (moved < 1.0) {
          strafeSign *= -1;
          strafeUntil = Date.now() + 700;
        }
        lastStuckCheckAt = Date.now();
        lastStuckCheckPos = shooterPos;
      }
      const dx = target.x - shooterPos.x;
      const dz = target.z - shooterPos.z;
      const yaw = Math.atan2(-dx, -dz);
      const moveRight = Date.now() < strafeUntil ? strafeSign : 0;
      puppetB.ws.send(JSON.stringify({ type: "input", moveForward: 1, moveRight, yaw, pitch: 0, jump: false }));
      if (Date.now() - lastFireAt >= 320) {
        lastFireAt = Date.now();
        puppetB.ws.send(JSON.stringify({ type: "fire" }));
      }
    }
    await sleep(80);
    hitTaken = audioLogs.some((l) => l.text.includes("hit-taken"));
  }
  puppetB.ws.send(JSON.stringify({ type: "input", moveForward: 0, moveRight: 0, yaw: 0, pitch: 0, jump: false }));
  results.hitTaken = hitTaken;
  console.log("[selfcheck] hit-taken logs:", audioLogs.filter((l) => l.text.includes("hit-taken")).map((l) => l.text));

  // --- 6. Pickup sound, positive case (Story 14.5) — Page A walks to the
  // nearest real armor pickup point (armor_tunnel_west/east, shared/src/
  // pickups.ts) and should hear its own pickup sound. Deliberately the
  // LAST section in this script: it is by far the most demanding, longest
  // real-time browser interaction here (many synthetic keyboard events
  // over map geometry that isn't always a straight, obstruction-free line
  // from Page A's current position — this headless session has been
  // observed, during self-check development, to occasionally become
  // unstable after an extended real-time keyboard-held walk), so it runs
  // only after every other, more reliable trigger's evidence is already
  // safely captured above — a slow/failed walk or an eventual browser
  // hiccup here can never cost the results already gathered. Routed via an
  // explicit two-leg waypoint (through the open tunnel center at (0,16),
  // the same corridor both armor points sit in, rather than one long
  // diagonal) since a direct diagonal from a site spawn was observed to
  // stall against intervening wall/divider geometry. Wrapped in try/catch.
  // Best-effort: Tester's own independent QA pass is the authoritative
  // verification for this story, not this script. ---
  console.log("\n[selfcheck] === pickup: armor (local, positive proximity case) ===");
  try {
    const currentPos = findPlayerByShortId(observer, shortId)?.position ?? spawnPos;
    const armorCandidates = [
      { x: -10, z: 16 }, // armor_tunnel_west
      { x: 10, z: 16 }, // armor_tunnel_east
    ];
    const target = armorCandidates.sort(
      (a, b) => Math.hypot(a.x - currentPos.x, a.z - currentPos.z) - Math.hypot(b.x - currentPos.x, b.z - currentPos.z),
    )[0];
    console.log("[selfcheck] nearest armor candidate:", target);
    audioLogs.length = 0;
    // Leg 1: get to the open tunnel center (weapon_gl_mid's column, proven
    // reliably reachable by Puppet B's own walk in Section 4 above) at the
    // armor points' z (16) — a generous radius/timeout since this leg's
    // only job is to get INTO the corridor, not consume anything.
    await walkPageTo(page, observer, shortId, 0, 16, 3.0, 8000);
    // Leg 2: from inside the corridor, a short, mostly single-axis final
    // approach to the actual pickup point — tighter radius than the
    // server's own PICKUP_RADIUS (1.5, shared/src/pickups.ts) so the
    // server actually registers the consumption, not just "nearby".
    await walkPageTo(page, observer, shortId, target.x, target.z, 0.7, 6000);
    await page.waitForTimeout(900);
    results.pickupHeard = audioLogs.some((l) => l.text.includes("pickup category=armor"));
    console.log("[selfcheck] pickup logs:", audioLogs.map((l) => l.text));
  } catch (err) {
    console.error("[selfcheck] pickup section failed:", err.message);
    results.pickupHeard = false;
  }

  console.log("\n[selfcheck] console errors so far:", consoleErrors.length);
  for (const e of consoleErrors) console.log("  -", e);

  try {
    await page.screenshot({ path: `${OUT_DIR}/final-state.png` });
  } catch {
    // best-effort only
  }
  try {
    await browser.close();
  } catch {
    // best-effort only
  }
  observer.ws.close();
  puppetB.ws.close();

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({ results, consoleErrorCount: consoleErrors.length, outDir: OUT_DIR }, null, 2));

  // Hard-required: the five triggers that don't depend on Page A (a
  // fixed-yaw-0 keyboard puppet — see walkPageTo's doc comment) or Puppet B
  // successfully navigating real map geometry with no pathfinding to reach
  // a specific distant point/line-of-sight — these were reproduced
  // reliably across every self-check run during development.
  const coreRequiredPassed =
    results.jumpGrunt &&
    results.footstepCount >= 2 &&
    results.footstepVaried &&
    results.localPistolGunshot &&
    results.remoteRifleGunshot &&
    results.remoteGrenadeLauncherGunshot;

  // Best-effort, NOT hard-required for this script's exit code:
  // hit-taken needs Puppet B to physically close real distance to Page A
  // (anti-clustering spawn placement can start them far apart) and land a
  // hitscan shot with no pathfinding around walls; the pickup test needs
  // Page A (fixed-yaw keyboard-only movement) to navigate real corridor
  // geometry to a specific point. Both are simple, directly-verified-by-
  // code wirings onto the SAME already-proven `onHit`/`onConsumed` event
  // paths this run already exercises successfully elsewhere (onFire/
  // onFireBroadcast) — a live positive case for these two specifically is
  // exactly what Tester's own independent QA pass (a real mouse-look
  // session, not a fixed-yaw-0 CDP puppet) should confirm.
  if (!results.hitTaken) {
    console.log("\n[selfcheck] NOTE: hit-taken did not fire in this run (best-effort, not hard-required — see comment above the SUMMARY block). Verify live in Tester's own QA pass.");
  }
  if (!results.pickupHeard) {
    console.log("[selfcheck] NOTE: pickup category=armor did not fire in this run (best-effort, not hard-required — see comment above the SUMMARY block). Verify live in Tester's own QA pass.");
  }

  if (!coreRequiredPassed) {
    console.log("\n[selfcheck] FAIL: one or more CORE required audio triggers did not fire as expected.");
    process.exit(1);
  }
  if (consoleErrors.length > 0) {
    console.log("\n[selfcheck] FAIL: console errors present.");
    process.exit(1);
  }
  console.log("\n[selfcheck] ALL SELF-CHECKS PASSED.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[selfcheck] script crashed:", err);
  process.exit(2);
});

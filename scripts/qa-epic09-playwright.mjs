// EPIC 9 gameplay & feel evidence capture: two real Playwright browser tabs
// — Page A picks "vs Bots" (private match, 2 bots), Page B (opened
// concurrently) picks "Multiplayer" (the public match) — following the same
// puppet/real-tab pattern established in scripts/qa-epic05-playwright.mjs /
// qa-epic06-playwright.mjs / qa-epic08-playwright.mjs.
//
// Captures: the mode-select screen itself, a bots match with visible bot
// avatars, a bot engaging/firing (hit marker / damage flash), a bot
// death/respawn, and evidence that Page B's concurrent public-mode session
// is entirely unaffected by Page A's bots match (EPIC 9 spec §8 Definition
// of Done, last bullet).

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-09";

await mkdir(OUT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });

  const pageA = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrorsA = [];
  const consoleErrorsB = [];
  pageA.on("console", (msg) => { if (msg.type() === "error") consoleErrorsA.push(msg.text()); });
  pageA.on("pageerror", (err) => consoleErrorsA.push(`pageerror: ${err.message}`));
  pageB.on("console", (msg) => { if (msg.type() === "error") consoleErrorsB.push(msg.text()); });
  pageB.on("pageerror", (err) => consoleErrorsB.push(`pageerror: ${err.message}`));

  console.log(`[qa] navigating both pages to ${CLIENT_URL}`);
  await pageA.goto(CLIENT_URL, { waitUntil: "load" });
  await pageB.goto(CLIENT_URL, { waitUntil: "load" });
  await pageA.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });
  await pageB.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });

  // ---- Mode-select screen evidence (Story 9.2) ----
  await pageA.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await pageA.screenshot({ path: `${OUT_DIR}/01-mode-select-screen.png` });
  console.log("[qa] captured 01-mode-select-screen.png");

  // Page A: "vs Bots". Page B: "Multiplayer".
  await pageA.click("#modeBotsBtn");
  await pageB.click("#modePublicBtn");
  await sleep(500);

  const modeSelectHiddenA = await pageA.evaluate(() => document.getElementById("modeSelect")?.classList.contains("hidden"));
  const modeSelectHiddenB = await pageB.evaluate(() => document.getElementById("modeSelect")?.classList.contains("hidden"));
  console.log("[qa] mode-select overlay hidden after choosing — A:", modeSelectHiddenA, "B:", modeSelectHiddenB);

  // ---- Engage pointer lock on both so movement/HUD are live ----
  for (const [label, page] of [["A", pageA], ["B", pageB]]) {
    const box = await page.locator("#app canvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(200);
    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    console.log(`[qa] Page ${label} pointer locked:`, locked);
  }

  await sleep(1500); // let a couple of world_state ticks land, bots start moving
  await pageA.screenshot({ path: `${OUT_DIR}/02-bots-match-with-avatars.png` });
  console.log("[qa] captured 02-bots-match-with-avatars.png (expect 2 red bot capsule avatars visible)");

  const statusB = await pageB.evaluate(() => document.getElementById("status")?.textContent ?? "");
  console.log("[qa] Page B (public) status:", statusB);
  await pageB.screenshot({ path: `${OUT_DIR}/03-public-match-concurrent.png` });
  console.log("[qa] captured 03-public-match-concurrent.png (expect an EMPTY arena — no bot avatars, since Page B is in the separate public match)");

  // ---- Walk Page A toward the arena center so a bot is more likely to come
  // into detection range / LOS and start engaging (best-effort — CDP
  // synthetic pointer-lock mouse-move doesn't produce real movementX in this
  // sandbox, same known limitation as EPIC 5/6/8 QA scripts, so yaw stays at
  // spawn value; we rely on WASD only). ----
  console.log("[qa] walking Page A forward, waiting for a hit marker / damage flash (bot engaging)...");
  await pageA.keyboard.down("KeyW");
  let sawCombatFeedback = false;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const hitVisible = await pageA.evaluate(() => document.getElementById("hitMarker")?.classList.contains("visible"));
    const dmgVisible = await pageA.evaluate(() => document.getElementById("damageFlash")?.classList.contains("visible"));
    const deathVisible = await pageA.evaluate(() => document.getElementById("deathOverlay")?.classList.contains("visible"));
    if (hitVisible || dmgVisible || deathVisible) {
      sawCombatFeedback = true;
      break;
    }
    await sleep(150);
  }
  await pageA.keyboard.up("KeyW");
  console.log("[qa] combat feedback observed on Page A (hit marker / damage flash / death overlay):", sawCombatFeedback);
  await pageA.screenshot({ path: `${OUT_DIR}/04-bot-engagement-or-combat.png` });
  console.log("[qa] captured 04-bot-engagement-or-combat.png");

  // ---- Wait through a death/respawn cycle for SOMEONE in the match
  // (Page A's own death overlay, or just let combat continue) and capture
  // the kill feed. ----
  await sleep(4000);
  await pageA.screenshot({ path: `${OUT_DIR}/05-killfeed-after-combat.png` });
  console.log("[qa] captured 05-killfeed-after-combat.png (expect a kill-feed line involving 'Bot 1'/'Bot 2')");

  // ---- Confirm Page B (public) is STILL unaffected after all that bots-match combat. ----
  const statusBAfter = await pageB.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const healthBAfter = await pageB.evaluate(() => document.getElementById("healthHud")?.textContent ?? "");
  console.log("[qa] Page B status after Page A's combat:", statusBAfter, "| health HUD:", healthBAfter);
  await pageB.screenshot({ path: `${OUT_DIR}/06-public-still-unaffected.png` });
  console.log("[qa] captured 06-public-still-unaffected.png (expect Page B still alone, full health, no kill-feed entries from Page A's bots match)");

  console.log("[qa] Page A console errors:", consoleErrorsA.length);
  for (const e of consoleErrorsA) console.log("  A -", e);
  console.log("[qa] Page B console errors:", consoleErrorsB.length);
  for (const e of consoleErrorsB) console.log("  B -", e);

  await browser.close();

  console.log("\n[qa] === SUMMARY ===");
  console.log("mode-select overlay hidden after selection (A/B):", modeSelectHiddenA, modeSelectHiddenB);
  console.log("combat feedback observed in bots match:", sawCombatFeedback);
  console.log("console errors A/B:", consoleErrorsA.length, consoleErrorsB.length);

  if (!modeSelectHiddenA || !modeSelectHiddenB || !sawCombatFeedback || consoleErrorsA.length > 0 || consoleErrorsB.length > 0) {
    console.log("[qa] FAIL (see summary above)");
    process.exit(1);
  }
  console.log("[qa] PASS");
}

main().catch((err) => {
  console.error("[qa] script crashed:", err);
  process.exit(2);
});

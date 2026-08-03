// Tester's own independent Playwright evidence capture for EPIC 9, written
// fresh (not reusing Programmer's scripts/qa-epic09-playwright.mjs as
// anything but a structural reference for known selectors/HUD element ids).
// Saves to qa-artifacts/epic-09-tester/ to keep evidence sources distinct.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-09-tester";

await mkdir(OUT_DIR, { recursive: true });
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });

  const pageBots = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pagePublic = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errBots = [];
  const errPublic = [];
  pageBots.on("console", (m) => { if (m.type() === "error") errBots.push(m.text()); });
  pageBots.on("pageerror", (e) => errBots.push(`pageerror: ${e.message}`));
  pagePublic.on("console", (m) => { if (m.type() === "error") errPublic.push(m.text()); });
  pagePublic.on("pageerror", (e) => errPublic.push(`pageerror: ${e.message}`));

  console.log(`[tester-qa] navigating both tabs to ${CLIENT_URL}`);
  await pageBots.goto(CLIENT_URL, { waitUntil: "load" });
  await pagePublic.goto(CLIENT_URL, { waitUntil: "load" });
  await pageBots.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });
  await pagePublic.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });

  // --- Mode-select screen (Story 9.2) ---
  await pageBots.waitForFunction(() => !document.getElementById("modeBotsBtn")?.disabled, { timeout: 5000 });
  await pageBots.screenshot({ path: `${OUT_DIR}/01-mode-select-screen.png` });
  console.log("[tester-qa] captured 01-mode-select-screen.png");

  // Both buttons present and enabled -- verify both are clickable elements before choosing.
  const publicBtnVisible = await pageBots.locator("#modePublicBtn").isVisible();
  const botsBtnVisible = await pageBots.locator("#modeBotsBtn").isVisible();
  console.log("[tester-qa] both mode buttons visible:", publicBtnVisible, botsBtnVisible);

  await pageBots.click("#modeBotsBtn");
  await pagePublic.click("#modePublicBtn");
  await sleep(500);

  const overlayHiddenBots = await pageBots.evaluate(() => document.getElementById("modeSelect")?.classList.contains("hidden"));
  const overlayHiddenPublic = await pagePublic.evaluate(() => document.getElementById("modeSelect")?.classList.contains("hidden"));
  console.log("[tester-qa] mode-select overlay hidden after pick -- bots tab:", overlayHiddenBots, "public tab:", overlayHiddenPublic);

  // --- Pointer lock both tabs ---
  for (const [label, page] of [["bots", pageBots], ["public", pagePublic]]) {
    const box = await page.locator("#app canvas").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(200);
    const locked = await page.evaluate(() => document.pointerLockElement !== null);
    console.log(`[tester-qa] ${label} tab pointer-locked:`, locked);
  }

  await sleep(1200);
  await pageBots.screenshot({ path: `${OUT_DIR}/02-bots-match-with-avatars.png` });
  console.log("[tester-qa] captured 02-bots-match-with-avatars.png (expect 2 bot avatars)");
  await pagePublic.screenshot({ path: `${OUT_DIR}/03-public-match-concurrent-baseline.png` });
  console.log("[tester-qa] captured 03-public-match-concurrent-baseline.png (empty public arena, before combat in bots match)");

  // --- Movement in public tab: walk forward, capture, confirm no regression visually ---
  await pagePublic.keyboard.down("KeyW");
  await sleep(1000);
  await pagePublic.keyboard.up("KeyW");
  await pagePublic.screenshot({ path: `${OUT_DIR}/04-public-movement.png` });
  console.log("[tester-qa] captured 04-public-movement.png (public tab after WASD movement)");

  // --- Jump in public tab ---
  await pagePublic.keyboard.down("Space");
  await sleep(150);
  await pagePublic.screenshot({ path: `${OUT_DIR}/05-public-jump-midair.png` });
  await pagePublic.keyboard.up("Space");
  await sleep(600);
  console.log("[tester-qa] captured 05-public-jump-midair.png");

  // --- Bots tab: move forward toward map center to try to trigger engagement ---
  console.log("[tester-qa] walking bots-tab player forward, watching for combat feedback (hit marker / damage flash / death overlay)...");
  await pageBots.keyboard.down("KeyW");
  let sawCombat = false;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const hit = await pageBots.evaluate(() => document.getElementById("hitMarker")?.classList.contains("visible"));
    const dmg = await pageBots.evaluate(() => document.getElementById("damageFlash")?.classList.contains("visible"));
    const death = await pageBots.evaluate(() => document.getElementById("deathOverlay")?.classList.contains("visible"));
    if (hit || dmg || death) { sawCombat = true; break; }
    await sleep(150);
  }
  await pageBots.keyboard.up("KeyW");
  console.log("[tester-qa] combat feedback observed:", sawCombat);
  await pageBots.screenshot({ path: `${OUT_DIR}/06-bot-engagement-combat.png` });
  console.log("[tester-qa] captured 06-bot-engagement-combat.png");

  // --- Wait for a death/respawn cycle (human or bot), capture kill feed ---
  await sleep(5000);
  await pageBots.screenshot({ path: `${OUT_DIR}/07-killfeed-after-combat.png` });
  console.log("[tester-qa] captured 07-killfeed-after-combat.png (expect kill-feed lines involving Bot 1/Bot 2)");

  // If the human died, wait for respawn overlay to clear and capture that too.
  const deathVisibleNow = await pageBots.evaluate(() => document.getElementById("deathOverlay")?.classList.contains("visible"));
  if (deathVisibleNow) {
    console.log("[tester-qa] human is currently dead, waiting for respawn...");
    await sleep(3500);
    await pageBots.screenshot({ path: `${OUT_DIR}/08-human-respawned.png` });
    const stillDead = await pageBots.evaluate(() => document.getElementById("deathOverlay")?.classList.contains("visible"));
    console.log("[tester-qa] still showing death overlay after wait:", stillDead, "(expect false = respawned)");
  } else {
    console.log("[tester-qa] human was alive at capture time -- skipping explicit respawn screenshot (death/respawn already exercised via raw-WS regression tests separately)");
  }

  // --- Final isolation check: public tab still fully unaffected after all that bots-match combat ---
  const statusPublicAfter = await pagePublic.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const healthPublicAfter = await pagePublic.evaluate(() => document.getElementById("healthHud")?.textContent ?? "");
  console.log("[tester-qa] public tab status after bots-tab combat:", statusPublicAfter, "| health HUD:", healthPublicAfter);
  await pagePublic.screenshot({ path: `${OUT_DIR}/09-public-still-unaffected.png` });
  console.log("[tester-qa] captured 09-public-still-unaffected.png");

  console.log("[tester-qa] bots-tab console errors:", errBots.length);
  for (const e of errBots) console.log("  bots -", e);
  console.log("[tester-qa] public-tab console errors:", errPublic.length);
  for (const e of errPublic) console.log("  public -", e);

  await browser.close();

  console.log("\n[tester-qa] === SUMMARY ===");
  console.log("mode-select overlay hidden after pick (bots/public):", overlayHiddenBots, overlayHiddenPublic);
  console.log("combat feedback observed in bots match:", sawCombat);
  console.log("console errors bots/public:", errBots.length, errPublic.length);

  if (!overlayHiddenBots || !overlayHiddenPublic || !sawCombat || errBots.length > 0 || errPublic.length > 0) {
    console.log("[tester-qa] FAIL (see summary above)");
    process.exit(1);
  }
  console.log("[tester-qa] PASS");
}

main().catch((err) => {
  console.error("[tester-qa] script crashed:", err);
  process.exit(2);
});

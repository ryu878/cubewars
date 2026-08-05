// Tester's own independent Playwright evidence capture for EPIC 13, written
// fresh (structurally referencing scripts/qa-epic09-tester-playwright.mjs
// for known selectors/conventions, NOT reusing Programmer's own
// scripts/qa-epic13-programmer-selfcheck.mjs beyond that same reference
// role). Saves to qa-artifacts/epic-13-weapon-autoswitch-hud-sizing/ to keep
// evidence sources distinct from Programmer's own self-check output.
//
// Covers: HUD sizing/positioning acceptance criteria at 1280x800 (worst-case
// content: 100/100 health+armor, "Grenade Launcher" name + 2-digit ammo),
// low-health/zero-armor tint states, EMPTY pulse state, ammo-value
// color-inheritance, plus a live bots-match sanity pass (join Bots mode,
// confirm HUD renders normally, no console errors, no regression).
//
// NOTE: synthetic-content screenshots (worst-case/tint/EMPTY) use a SEPARATE
// page that never joins a match — a page that HAS joined a real match keeps
// receiving live world_state ticks (~20Hz) that call setHealth()/setArmor()
// with the real server values, which will silently overwrite any injected
// test values mid-script (confirmed by hitting this myself: injecting
// data-low=true/health=7 into the joined page raced against a real
// world_state tick resetting it back to 100/data-low=false before the
// screenshot fired). Matches the pattern Programmer's own self-check script
// already used for this exact reason.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-13-weapon-autoswitch-hud-sizing";

await mkdir(OUT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"],
  });

  // --- Page A: real joined match, for the true default-state screenshot. ---
  const pageA = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errorsA = [];
  pageA.on("console", (m) => { if (m.type() === "error") errorsA.push(m.text()); });
  pageA.on("pageerror", (e) => errorsA.push(`pageerror: ${e.message}`));

  console.log(`[tester-qa] navigating page A to ${CLIENT_URL}`);
  await pageA.goto(CLIENT_URL, { waitUntil: "load" });
  await pageA.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });
  await pageA.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await pageA.click("#modePublicBtn");
  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: `${OUT_DIR}/01-default-state.png` });
  console.log("[tester-qa] captured 01-default-state.png (real server-driven default)");

  // --- Page B: never joins a match — used for synthetic worst-case/tint/EMPTY
  // states, so no live world_state tick can overwrite injected values. ---
  const pageB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errorsB = [];
  pageB.on("console", (m) => { if (m.type() === "error") errorsB.push(m.text()); });
  pageB.on("pageerror", (e) => errorsB.push(`pageerror: ${e.message}`));
  await pageB.goto(CLIENT_URL, { waitUntil: "load" });
  await pageB.waitForTimeout(500);
  await pageB.evaluate(() => {
    document.getElementById("modeSelect")?.classList.add("hidden");
    document.getElementById("healthValue").textContent = "100";
    document.getElementById("healthHud").dataset.low = "false";
    document.getElementById("armorValue").textContent = "100";
    document.getElementById("armorHud").dataset.zero = "false";
    document.getElementById("weaponName").textContent = "Grenade Launcher";
    document.getElementById("ammoValue").textContent = "48";
    document.getElementById("weaponHud").style.color = "#9b30ff";
    document.getElementById("weaponHud").dataset.empty = "false";
  });
  await pageB.waitForTimeout(150);
  await pageB.screenshot({ path: `${OUT_DIR}/02-worst-case-content.png` });
  const boxes = await pageB.evaluate(() => {
    const ids = ["healthHud", "armorHud", "weaponHud"];
    return Object.fromEntries(ids.map((id) => [id, document.getElementById(id).getBoundingClientRect()]));
  });
  console.log("[tester-qa] worst-case bounding boxes:", JSON.stringify(boxes, null, 2));

  const colors = await pageB.evaluate(() => ({
    weaponHudColor: getComputedStyle(document.getElementById("weaponHud")).color,
    weaponNameColor: getComputedStyle(document.getElementById("weaponName")).color,
    ammoValueColor: getComputedStyle(document.getElementById("ammoValue")).color,
  }));
  console.log("[tester-qa] color inheritance:", colors);

  const viewportWidth = 1280;
  const hb = boxes.healthHud, ab = boxes.armorHud, wb = boxes.weaponHud;
  const checks = [
    { label: "healthHud not clipped off left edge", pass: hb.left >= 0 },
    { label: "armorHud not clipped off right edge", pass: ab.right <= viewportWidth },
    { label: "weaponHud not clipped off left edge", pass: wb.left >= 0 },
    { label: "weaponHud not clipped off right edge", pass: wb.right <= viewportWidth },
    { label: "healthHud does not overlap weaponHud (visible gap)", pass: (wb.left - hb.right) > 0 },
    { label: "weaponHud does not overlap armorHud (visible gap)", pass: (ab.left - wb.right) > 0 },
    { label: "healthHud closer to center than old left:24px anchor", pass: hb.left > 24 },
    { label: "armorHud closer to center than old right:24px anchor", pass: (viewportWidth - ab.right) > 24 },
    { label: "ammoValue color matches weapon-identity color (inherited)", pass: colors.ammoValueColor === colors.weaponHudColor },
    { label: "weaponName color matches weapon-identity color (inherited)", pass: colors.weaponNameColor === colors.weaponHudColor },
  ];
  console.log("\n=== WORST-CASE CHECKS ===");
  let anyFailed = false;
  for (const c of checks) {
    console.log(`[${c.pass ? "PASS" : "FAIL"}] ${c.label}`);
    if (!c.pass) anyFailed = true;
  }
  console.log(`gap healthHud->weaponHud: ${(wb.left - hb.right).toFixed(1)}px`);
  console.log(`gap weaponHud->armorHud: ${(ab.left - wb.right).toFixed(1)}px`);

  // --- Screenshot 3: low-health / zero-armor tint states (page B, isolated). ---
  await pageB.evaluate(() => {
    document.getElementById("healthValue").textContent = "7";
    document.getElementById("healthHud").dataset.low = "true";
    document.getElementById("armorValue").textContent = "0";
    document.getElementById("armorHud").dataset.zero = "true";
  });
  await pageB.waitForTimeout(150);
  await pageB.screenshot({ path: `${OUT_DIR}/03-low-health-zero-armor-tint.png` });
  const tintColors = await pageB.evaluate(() => ({
    healthValueColor: getComputedStyle(document.getElementById("healthValue")).color,
    armorValueColor: getComputedStyle(document.getElementById("armorValue")).color,
    healthDataLow: document.getElementById("healthHud").dataset.low,
    armorDataZero: document.getElementById("armorHud").dataset.zero,
  }));
  console.log("[tester-qa] tint colors + dataset (low health / zero armor):", tintColors);
  const tintPass = tintColors.healthValueColor === "rgb(255, 138, 138)" && tintColors.armorValueColor === "rgb(138, 138, 138)";
  console.log(`[${tintPass ? "PASS" : "FAIL"}] low-health red tint / zero-armor grey tint render correctly`);
  if (!tintPass) anyFailed = true;

  // --- Screenshot 4: EMPTY pulse state (page B). ---
  await pageB.evaluate(() => {
    document.getElementById("ammoValue").textContent = "EMPTY";
    document.getElementById("weaponHud").dataset.empty = "true";
  });
  await pageB.waitForTimeout(150);
  await pageB.screenshot({ path: `${OUT_DIR}/04-empty-pulse-state.png` });
  console.log("[tester-qa] captured 04-empty-pulse-state.png");

  // --- Bots-match sanity pass: fresh page, join Bots mode, confirm HUD
  // renders normally and no console errors over a few seconds of live play. ---
  const botsPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const botsErrors = [];
  botsPage.on("console", (m) => { if (m.type() === "error") botsErrors.push(m.text()); });
  botsPage.on("pageerror", (e) => botsErrors.push(`pageerror: ${e.message}`));
  await botsPage.goto(CLIENT_URL, { waitUntil: "load" });
  await botsPage.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });
  await botsPage.waitForFunction(() => !document.getElementById("modeBotsBtn")?.disabled, { timeout: 5000 });
  await botsPage.click("#modeBotsBtn");
  await botsPage.waitForTimeout(3000);
  await botsPage.screenshot({ path: `${OUT_DIR}/05-bots-match-sanity.png` });
  console.log("[tester-qa] captured 05-bots-match-sanity.png (bots match running)");
  console.log("[tester-qa] bots-page console errors:", botsErrors.length, botsErrors);
  await botsPage.close();

  console.log("\n[tester-qa] page A (real match) console errors:", errorsA.length, errorsA);
  console.log("[tester-qa] page B (synthetic) console errors:", errorsB.length, errorsB);

  await browser.close();
  process.exit(anyFailed || errorsA.length > 0 || errorsB.length > 0 || botsErrors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[tester-qa] script crashed:", err);
  process.exit(2);
});

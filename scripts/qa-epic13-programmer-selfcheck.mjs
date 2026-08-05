// EPIC 13 Story 13.4 Programmer self-check (Pusya): NOT the formal Tester QA
// pass — visual sanity check before handoff. Captures the resized/
// repositioned HUD (#healthHud/#armorHud/#weaponHud) at the standard
// 1280x800 QA viewport (matching scripts/qa-epic09-tester-playwright.mjs),
// both in its real server-driven default state AND in a worst-case content
// scenario (longest weapon name + max-digit ammo count + low-health/non-zero
// armor tints), to evidence the Section 3 judgment call: no overlap between
// the three HUD elements, nothing clipped off either screen edge, and the
// ammo-value span visibly inherits weapon-identity color-coding.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-13-programmer-selfcheck";

await mkdir(OUT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForTimeout(800);
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });
  await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await page.click("#modePublicBtn");
  await page.waitForTimeout(500);

  // --- Screenshot 1: real default state (Pistol, ∞ ammo, health 100, armor 0
  // — armor's zero-tint data-attribute), driven entirely by the server's own
  // welcome/loadout/world_state messages, unmodified. ---
  await page.screenshot({ path: `${OUT_DIR}/01-default-state.png` });
  const defaultBoxes = await page.evaluate(() => {
    const ids = ["healthHud", "armorHud", "weaponHud"];
    return Object.fromEntries(ids.map((id) => [id, document.getElementById(id).getBoundingClientRect()]));
  });
  console.log("[selfcheck] default-state bounding boxes:", JSON.stringify(defaultBoxes, null, 2));

  // --- Screenshot 2/3: worst-case content scenario, on a SECOND fresh page
  // that deliberately never clicks "Multiplayer" (never joins a match) — so
  // no live world_state ticks arrive to overwrite the injected worst-case
  // values (main.ts's onWorldState only calls hud.setHealth()/setArmor() for
  // messages the socket receives, which requires having joined a match; see
  // server/src/match.ts Match.addHuman()/broadcast()). The mode-select
  // overlay (z-index 20, otherwise obscures the whole HUD) is hidden
  // directly instead. Worst-case content: longest weapon name ("Grenade
  // Launcher"), max relevant ammo digit count (48, the rifle's maxAmmo, 2
  // digits — the grenade launcher's own maxAmmo is only 6, 1 digit, so the
  // rifle's 48 is the actual worst case per the shared weapon table), and
  // MAX 3-digit health/armor values (100/100, COMBAT.maxHealth/maxArmor) —
  // the real worst case for overlap risk is the WIDEST digit count, not the
  // low-health/zero-armor tint states (which happen to be narrower text,
  // see screenshot 3 below). DOM values set directly into the same child
  // spans combatHud.ts's setHealth()/setArmor()/setWeapon() write into —
  // the underlying data-flow (server -> combatHud.ts -> these same spans)
  // is exercised separately by screenshot 1 above and Tester's own live
  // gameplay evidence.
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page2.goto(CLIENT_URL, { waitUntil: "load" });
  await page2.waitForTimeout(500);
  await page2.evaluate(() => {
    document.getElementById("modeSelect").classList.add("hidden");
    document.getElementById("healthValue").textContent = "100";
    document.getElementById("healthHud").dataset.low = "false";
    document.getElementById("armorValue").textContent = "100";
    document.getElementById("armorHud").dataset.zero = "false";
    document.getElementById("weaponName").textContent = "Grenade Launcher";
    document.getElementById("ammoValue").textContent = "48";
    document.getElementById("weaponHud").style.color = "#9b30ff"; // grenade launcher color identity
    document.getElementById("weaponHud").dataset.empty = "false";
  });
  await page2.waitForTimeout(150);
  await page2.screenshot({ path: `${OUT_DIR}/02-worst-case-content.png` });
  const worstCaseBoxes = await page2.evaluate(() => {
    const ids = ["healthHud", "armorHud", "weaponHud"];
    return Object.fromEntries(ids.map((id) => [id, document.getElementById(id).getBoundingClientRect()]));
  });
  console.log("[selfcheck] worst-case bounding boxes:", JSON.stringify(worstCaseBoxes, null, 2));

  // --- Screenshot 3: low-health/zero-armor tint states (narrower digit
  // counts, but confirms the data-low/data-zero color CSS still applies
  // correctly against the new child value spans). ---
  await page2.evaluate(() => {
    document.getElementById("healthValue").textContent = "7";
    document.getElementById("healthHud").dataset.low = "true";
    document.getElementById("armorValue").textContent = "0";
    document.getElementById("armorHud").dataset.zero = "true";
  });
  await page2.waitForTimeout(150);
  await page2.screenshot({ path: `${OUT_DIR}/03-low-health-zero-armor-tint.png` });

  // --- Screenshot 4: EMPTY pulse state, still on the restructured markup. ---
  await page2.evaluate(() => {
    document.getElementById("ammoValue").textContent = "EMPTY";
    document.getElementById("weaponHud").dataset.empty = "true";
  });
  await page2.waitForTimeout(150);
  await page2.screenshot({ path: `${OUT_DIR}/04-empty-pulse-state.png` });

  // Color-coding: confirm the ammo number's computed color matches the
  // weapon-identity color (not default/uncolored) — verifies child-span
  // color inheritance, per the EPIC 13 spec's explicit ask.
  const colors = await page2.evaluate(() => {
    const weaponHudColor = getComputedStyle(document.getElementById("weaponHud")).color;
    const weaponNameColor = getComputedStyle(document.getElementById("weaponName")).color;
    const ammoValueColor = getComputedStyle(document.getElementById("ammoValue")).color;
    return { weaponHudColor, weaponNameColor, ammoValueColor };
  });
  console.log("[selfcheck] color inheritance check:", colors);

  // --- Overlap/clipping checks (numeric, not just visual) ---
  const viewportWidth = 1280;
  const hb = worstCaseBoxes.healthHud;
  const ab = worstCaseBoxes.armorHud;
  const wb = worstCaseBoxes.weaponHud;
  const checks = [
    { label: "healthHud not clipped off left edge", pass: hb.left >= 0 },
    { label: "armorHud not clipped off right edge", pass: ab.right <= viewportWidth },
    { label: "weaponHud not clipped off left edge", pass: wb.left >= 0 },
    { label: "weaponHud not clipped off right edge", pass: wb.right <= viewportWidth },
    { label: "healthHud does not overlap weaponHud", pass: hb.right < wb.left },
    { label: "weaponHud does not overlap armorHud", pass: wb.right < ab.left },
    {
      label: "ammoValue color matches weapon-identity color (inherited)",
      pass: colors.ammoValueColor === colors.weaponHudColor,
    },
    {
      label: "weaponName color matches weapon-identity color (inherited)",
      pass: colors.weaponNameColor === colors.weaponHudColor,
    },
  ];
  console.log("\n=== CHECKS ===");
  let anyFailed = false;
  for (const check of checks) {
    console.log(`[${check.pass ? "PASS" : "FAIL"}] ${check.label}`);
    if (!check.pass) anyFailed = true;
  }
  console.log(`\ngap healthHud->weaponHud: ${(wb.left - hb.right).toFixed(1)}px`);
  console.log(`gap weaponHud->armorHud: ${(ab.left - wb.right).toFixed(1)}px`);

  console.log("\n[selfcheck] console errors:", consoleErrors.length);
  for (const e of consoleErrors) console.log("  -", e);

  await page2.close();
  await browser.close();
  process.exit(anyFailed || consoleErrors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[selfcheck] script crashed:", err);
  process.exit(2);
});

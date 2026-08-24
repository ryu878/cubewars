// Tester Playwright evidence for EPIC 29 Inventory Grid UI.
// Captures: overlay closed, overlay open on an EMPTY profile, overlay open on
// a SEEDED profile (grid + equip rail + gold/ratings/caps), an item selected
// (action panel), a legal drag-move, and an illegal drag-move (overlap
// rejected by the server, item snaps back to its last-confirmed anchor).

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://127.0.0.1:5199";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-29";

await mkdir(OUT_DIR, { recursive: true });

function nowSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

async function joinBots(page, nickname) {
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#nicknameInput", { timeout: 10000 });
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(() => {
    const btn = document.getElementById("modeBotsBtn");
    return btn && !btn.disabled;
  }, { timeout: 10000 });
  await page.click("#modeBotsBtn");
  await page.waitForFunction(() => {
    const el = document.getElementById("modeSelect");
    return el && el.classList.contains("hidden");
  }, { timeout: 10000 });
  await page.waitForTimeout(500);
}

async function gridCellRect(page, anchor) {
  return page.evaluate((a) => {
    const el = document.querySelector(`#inventoryGrid [data-anchor="${a}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, anchor);
}

async function itemRectByAnchor(page, anchor) {
  // Items are positioned via inline gridColumn/gridRow computed from their
  // anchor (see inventoryOverlay.ts renderGrid) — locate by matching those.
  return page.evaluate((a) => {
    const col = (a % 8) + 1;
    const row = Math.floor(a / 8) + 1;
    const items = Array.from(document.querySelectorAll("#inventoryGrid .inv-item"));
    for (const el of items) {
      const gc = el.style.gridColumn.split("/")[0].trim();
      const gr = el.style.gridRow.trim();
      if (Number(gc) === col && Number(gr) === row) {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: el.textContent };
      }
    }
    return null;
  }, anchor);
}

async function dragPointer(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Exceed the 6px click/drag disambiguation threshold.
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function inspectOverlay(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById("inventoryOverlay");
    const grid = document.getElementById("inventoryGrid");
    const rail = document.getElementById("inventoryRail");
    const gold = document.getElementById("inventoryGold");
    const ratings = document.getElementById("inventoryRatings");
    const caps = document.getElementById("inventoryCaps");
    return {
      visible: overlay?.classList.contains("visible") ?? false,
      ariaHidden: overlay?.getAttribute("aria-hidden"),
      cellCount: grid?.querySelectorAll(".inv-cell").length ?? 0,
      itemCount: grid?.querySelectorAll(".inv-item").length ?? 0,
      railSlots: rail?.querySelectorAll(".inv-rail-slot").length ?? 0,
      goldText: gold?.textContent ?? "",
      ratingsText: ratings?.textContent ?? "",
      capsText: caps?.textContent ?? "",
    };
  });
}

async function main() {
  const browser = await chromium.launch({
    args: [
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
    ],
  });
  const failures = [];
  const errors = [];

  // ---------- Page A: EMPTY profile ----------
  const emptyNick = `QaEpic29Empty${nowSuffix()}`;
  const pageA = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  pageA.on("console", (m) => {
    if (m.type() === "error") errors.push(`empty: ${m.text()}`);
  });
  pageA.on("pageerror", (e) => errors.push(`empty pageerror: ${e.message}`));

  console.log(`[epic29-qa] joining bots match as ${emptyNick}`);
  await joinBots(pageA, emptyNick);
  await pageA.screenshot({ path: `${OUT_DIR}/01-overlay-closed.png` });

  // Toggle open with "I"
  await pageA.keyboard.press("KeyI");
  await pageA.waitForTimeout(300);
  const emptyState = await inspectOverlay(pageA);
  await pageA.screenshot({ path: `${OUT_DIR}/02-overlay-open-empty-profile.png` });
  console.log("[epic29-qa] empty-profile overlay state:", JSON.stringify(emptyState));
  if (!emptyState.visible) failures.push("empty: overlay did not open on I");
  if (emptyState.cellCount !== 64) failures.push(`empty: expected 64 grid cells, got ${emptyState.cellCount}`);
  if (emptyState.itemCount !== 0) failures.push(`empty: expected 0 items on a fresh profile, got ${emptyState.itemCount}`);
  if (emptyState.railSlots < 2) failures.push(`empty: expected >=2 equip rail slots, got ${emptyState.railSlots}`);
  if (!/^\d+$/.test(emptyState.goldText)) failures.push(`empty: gold not numeric: "${emptyState.goldText}"`);
  if (!emptyState.capsText.includes("Cells 0/64")) failures.push(`empty: caps summary missing/wrong: "${emptyState.capsText}"`);

  // Toggle closed with "P" (alias)
  await pageA.keyboard.press("KeyP");
  await pageA.waitForTimeout(200);
  const afterPClose = await inspectOverlay(pageA);
  await pageA.screenshot({ path: `${OUT_DIR}/03-overlay-closed-via-p-alias.png` });
  if (afterPClose.visible) failures.push("empty: P alias did not close overlay");

  // Re-open with "P" (alias also opens)
  await pageA.keyboard.press("KeyP");
  await pageA.waitForTimeout(200);
  const afterPOpen = await inspectOverlay(pageA);
  if (!afterPOpen.visible) failures.push("empty: P alias did not (re)open overlay");
  await pageA.keyboard.press("KeyI");
  await pageA.waitForTimeout(200);

  // ---------- Page B: SEEDED profile ----------
  const seededNick = "QaEpic29Seed";
  const pageB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  pageB.on("console", (m) => {
    if (m.type() === "error") errors.push(`seeded: ${m.text()}`);
  });
  pageB.on("pageerror", (e) => errors.push(`seeded pageerror: ${e.message}`));

  console.log(`[epic29-qa] joining bots match as ${seededNick}`);
  await joinBots(pageB, seededNick);
  await pageB.keyboard.press("KeyI");
  await pageB.waitForTimeout(400);
  const seededState = await inspectOverlay(pageB);
  await pageB.screenshot({ path: `${OUT_DIR}/04-overlay-open-seeded-profile.png` });
  console.log("[epic29-qa] seeded-profile overlay state:", JSON.stringify(seededState));
  if (!seededState.visible) failures.push("seeded: overlay did not open on I");
  if (seededState.itemCount === 0) failures.push("seeded: expected seeded items to render, got 0");
  if (!seededState.capsText.includes("Pets 2/")) failures.push(`seeded: expected 2 pets in caps text: "${seededState.capsText}"`);
  if (!/Eggs 1\//.test(seededState.capsText)) failures.push(`seeded: expected 1 egg in caps text: "${seededState.capsText}"`);
  if (!/Gems 2\//.test(seededState.capsText)) failures.push(`seeded: expected 2 gems in caps text: "${seededState.capsText}"`);
  if (!/Amulets 1\//.test(seededState.capsText)) failures.push(`seeded: expected 1 amulet in caps text: "${seededState.capsText}"`);
  if (!/Shards 4\//.test(seededState.capsText)) failures.push(`seeded: expected 4 shards in caps text: "${seededState.capsText}"`);

  // Select the egg (anchor 4, per seed script grant order) — proves incubation
  // countdown + Hatch/Stim actions are reachable.
  const eggRect = await itemRectByAnchor(pageB, 4);
  if (!eggRect) {
    failures.push("seeded: could not locate egg item at expected anchor 4");
  } else {
    await pageB.mouse.click(eggRect.x, eggRect.y);
    await pageB.waitForTimeout(200);
    const detailsText = await pageB.evaluate(
      () => document.getElementById("inventoryDetails")?.innerText ?? "",
    );
    console.log("[epic29-qa] egg details panel:", detailsText.replace(/\n/g, " | "));
    if (!/Ready in|Ready to hatch/.test(detailsText)) {
      failures.push(`seeded: egg details missing incubation countdown: "${detailsText}"`);
    }
    if (!/Hatch/.test(detailsText)) failures.push("seeded: Hatch action not present for egg");
    if (!/Apply stimulator/.test(detailsText)) failures.push("seeded: Apply stimulator action not present for egg");
    await pageB.screenshot({ path: `${OUT_DIR}/05-egg-selected-details-panel.png` });
  }

  // Select a pet (anchor 0) — proves Equip/Socket actions are reachable.
  const petRect = await itemRectByAnchor(pageB, 0);
  if (petRect) {
    await pageB.mouse.click(petRect.x, petRect.y);
    await pageB.waitForTimeout(200);
    const petDetailsText = await pageB.evaluate(
      () => document.getElementById("inventoryDetails")?.innerText ?? "",
    );
    console.log("[epic29-qa] pet details panel:", petDetailsText.replace(/\n/g, " | "));
    if (!/Equip slot 1/.test(petDetailsText)) failures.push("seeded: Equip slot 1 action not present for pet");
    if (!/Discard/.test(petDetailsText)) failures.push("seeded: Discard action not present for pet");
    await pageB.screenshot({ path: `${OUT_DIR}/06-pet-selected-details-panel.png` });
  } else {
    failures.push("seeded: could not locate pet item at expected anchor 0");
  }

  // Select an amulet (anchor 8) — proves Equip/Repair actions are reachable.
  const amuletRect = await itemRectByAnchor(pageB, 8);
  if (amuletRect) {
    await pageB.mouse.click(amuletRect.x, amuletRect.y);
    await pageB.waitForTimeout(200);
    const amuletDetailsText = await pageB.evaluate(
      () => document.getElementById("inventoryDetails")?.innerText ?? "",
    );
    console.log("[epic29-qa] amulet details panel:", amuletDetailsText.replace(/\n/g, " | "));
    if (!/Repair/.test(amuletDetailsText)) failures.push("seeded: Repair action not present for amulet");
  } else {
    failures.push("seeded: could not locate amulet item at expected anchor 8");
  }

  // Select a gem (anchor 5) — proves socket-select action is reachable.
  const gemRect = await itemRectByAnchor(pageB, 5);
  if (gemRect) {
    await pageB.mouse.click(gemRect.x, gemRect.y);
    await pageB.waitForTimeout(200);
    const gemDetailsText = await pageB.evaluate(
      () => document.getElementById("inventoryDetails")?.innerText ?? "",
    );
    console.log("[epic29-qa] gem details panel:", gemDetailsText.replace(/\n/g, " | "));
    if (!/Select to socket|Selected for socketing/.test(gemDetailsText)) {
      failures.push("seeded: gem socket-select action not present");
    }
  } else {
    failures.push("seeded: could not locate gem item at expected anchor 5");
  }
  // Deselect (click gem again) so it doesn't interfere with the drag test below.
  if (gemRect) await pageB.mouse.click(gemRect.x, gemRect.y);
  await pageB.waitForTimeout(150);

  // ---------- Legal drag-move: stimulator (anchor 7) -> empty anchor 30 ----------
  const stimRect = await itemRectByAnchor(pageB, 7);
  const target30 = await gridCellRect(pageB, 30);
  if (stimRect && target30) {
    await dragPointer(pageB, stimRect, target30);
    await pageB.waitForTimeout(400); // allow economy_move_item round trip
    const movedRect = await itemRectByAnchor(pageB, 30);
    await pageB.screenshot({ path: `${OUT_DIR}/07-after-legal-drag-move.png` });
    if (!movedRect) {
      failures.push("seeded: legal drag-move did not land the item at target anchor 30 after server echo");
    } else {
      console.log("[epic29-qa] legal move OK: item now at anchor 30");
    }
  } else {
    failures.push("seeded: could not set up legal drag-move test (missing stim/target rect)");
  }

  // ---------- Illegal drag-move: gem (anchor 5) -> occupied anchor 30 (stim) ----------
  const gemRect2 = await itemRectByAnchor(pageB, 5);
  const occupiedTarget = await itemRectByAnchor(pageB, 30); // now the stim
  if (gemRect2 && occupiedTarget) {
    await dragPointer(pageB, gemRect2, occupiedTarget);
    await pageB.waitForTimeout(400);
    const statusText = await pageB.evaluate(
      () => document.getElementById("inventoryStatus")?.textContent ?? "",
    );
    console.log("[epic29-qa] illegal move status:", statusText);
    const gemStillAt5 = await itemRectByAnchor(pageB, 5);
    await pageB.screenshot({ path: `${OUT_DIR}/08-after-illegal-drag-move-rejected.png` });
    if (!/failed/.test(statusText)) {
      failures.push(`seeded: illegal overlapping move was not rejected by server (status: "${statusText}")`);
    }
    if (!gemStillAt5) {
      failures.push("seeded: gem did not remain at its last server-confirmed anchor (5) after a rejected move");
    }
  } else {
    failures.push("seeded: could not set up illegal drag-move test (missing gem/occupied-target rect)");
  }

  console.log("\n=== EPIC 29 CHECKS ===");
  if (failures.length === 0) {
    console.log("ALL PASS");
  } else {
    for (const f of failures) console.log("FAIL:", f);
  }
  if (errors.length) {
    console.log("\nConsole errors:");
    for (const e of errors) console.log(" -", e);
  } else {
    console.log("No console errors on either path.");
  }

  await browser.close();
  if (failures.length) process.exit(1);
}

await main();

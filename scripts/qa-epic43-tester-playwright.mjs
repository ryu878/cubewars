// Tester Playwright evidence for EPIC 43 — inventory cell size, icons, tooltips.
//
// Checks:
//   1) Lobby Inventory after auth/nickname bind opens shared overlay
//   2) Seeded Deathmatch bag: larger grid (~960px / ~115px cells ≈2×)
//   3) Grid cells show geometric icons — NOT STM/PET/AMU/SHD/KIT/EGG/GEM
//   4) Hover/focus data-tooltip English labels + detail
//   5) Detail panel English title; drag/select smoke
//   6) Same overlay via in-match I
//
// Usage:
//   node scripts/qa-epic43-tester-playwright.mjs
//   node scripts/qa-epic43-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7797;
const CLIENT_PORT = 5217;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-43");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

const CRYPTIC = /\b(STM|PET|AMU|SHD|KIT|EGG|GEM)\b/;
const BEFORE_CELL_PX = 56.5; // (480 - 7*4) / 8

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nick(prefix) {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${prefix}${suffix}`.slice(0, 16);
}

function waitForReady(child, label, marker) {
  return new Promise((resolve, reject) => {
    let ready = false;
    const onData = (buf) => {
      const text = buf.toString();
      process.stdout.write(`[${label}] ${text}`);
      if (!ready && text.includes(marker)) {
        ready = true;
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("exit", (code) => {
      if (!ready) reject(new Error(`${label} exited before ready (code ${code})`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error(`${label} did not become ready`));
    }, 45000);
  });
}

function stop(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
    }, 3000);
    resolve();
  });
}

async function startStack() {
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(REPO_ROOT, "server"),
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(server, "server", `listening on`);

  const client = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(CLIENT_PORT), "--strictPort"],
    {
      cwd: CLIENT_ROOT,
      env: { ...process.env, VITE_CUBEWARS_WS_URL: WS_URL },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await waitForReady(client, "client", `http://127.0.0.1:${CLIENT_PORT}/`);
  return { server, client };
}

function installWsTap(page) {
  return page.addInitScript(() => {
    const Orig = window.WebSocket;
    window.WebSocket = function (...args) {
      const ws = new Orig(...args);
      window.__epic43Tap = window.__epic43Tap || {
        welcomeId: null,
        outbound: [],
        profiles: [],
        actionResults: [],
        lastSelf: null,
      };
      window.__epic43Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic43Tap.outbound.push(msg);
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "welcome") window.__epic43Tap.welcomeId = msg.playerId;
          if (msg.type === "economy_profile") window.__epic43Tap.profiles.push(msg);
          if (msg.type === "economy_action_result") window.__epic43Tap.actionResults.push(msg);
          if (msg.type === "world_state" && Array.isArray(msg.players)) {
            const selfId = window.__epic43Tap.welcomeId;
            const self = msg.players.find((p) => p.id === selfId);
            if (self) {
              window.__epic43Tap.lastSelf = {
                id: self.id,
                position: self.position,
                alive: self.alive,
              };
            }
          }
        } catch {
          /* ignore */
        }
      });
      return ws;
    };
    window.WebSocket.prototype = Orig.prototype;
    Object.assign(window.WebSocket, Orig);
  });
}

async function registerAndContinue(page, email) {
  await installWsTap(page);
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#accountEmailInput", { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("accountEmailBtn");
      return btn && !btn.disabled;
    },
    { timeout: 20000 },
  );
  await page.fill("#accountEmailInput", email);
  await page.click("#accountEmailBtn");
  await page.waitForFunction(
    () => {
      const codeEl = document.getElementById("accountRevealCode");
      return codeEl && /^\d{3}-\d{3}$/.test(codeEl.textContent || "");
    },
    { timeout: 15000 },
  );
  await page.click("#accountContinueBtn");
  await page.waitForFunction(
    () =>
      document.getElementById("accountSignedIn") &&
      !document.getElementById("accountSignedIn").classList.contains("hidden"),
    { timeout: 10000 },
  );
}

async function openLobbyInventory(page, nickname) {
  await page.fill("#nicknameInput", nickname);
  await page.click("#lobbyInventoryBtn");
  await page.waitForFunction(
    () => document.getElementById("inventoryOverlay")?.classList.contains("visible"),
    { timeout: 10000 },
  );
  await page.waitForFunction(
    () => (window.__epic43Tap?.profiles ?? []).some((p) => p.economyPool === "deathmatch"),
    { timeout: 15000 },
  );
}

async function closeInventory(page) {
  await page.keyboard.press("Escape");
  await sleep(250);
  const stillOpen = await page.evaluate(
    () => document.getElementById("inventoryOverlay")?.classList.contains("visible") ?? false,
  );
  if (stillOpen) {
    const closeBtn = page.locator("#inventoryCloseBtn, #inventoryOverlay button").first();
    if (await closeBtn.count()) await closeBtn.click().catch(() => undefined);
    await sleep(200);
  }
}

async function seedDeathmatchBag(nickname) {
  const helper = join(OUT_DIR, "_seed-bag.mjs");
  await writeFile(
    helper,
    `import { EconomyStore } from "../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${JSON.stringify(nickname)};
const now = Date.now();
const scope = "deathmatch";
const pet = await store.grantPetForTests(nick, "lion", 80, now, scope);
const egg = await store.grantEgg(nick, now, 60_000, scope);
const gem = await store.grantGem(nick, "damage", 12, now, undefined, scope);
const amulet = await store.grantAmulet(nick, 8, now, scope);
const stim = await store.grantStimulator(nick, now, scope);
const kit = await store.grantRepairKit(nick, now, scope);
const shards = await store.addShard(nick, 5, now, scope);
await store.close();
console.log(JSON.stringify({
  petId: pet.id, eggId: egg.id, gemId: gem.id, amuletId: amulet.id,
  stimId: stim.id, kitId: kit.id, shards
}));
`,
    "utf8",
  );
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", helper], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => {
      out += b.toString();
    });
    child.stderr.on("data", (b) => {
      err += b.toString();
    });
    child.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`seed failed: ${err || out}`));
      try {
        const line = out
          .trim()
          .split("\n")
          .filter((l) => l.startsWith("{"))
          .pop();
        resolve(JSON.parse(line));
      } catch (e) {
        reject(new Error(`seed parse fail: ${out}\n${err}\n${e}`));
      }
    });
  });
}

function inspectInventory() {
  const grid = document.getElementById("inventoryGrid");
  const overlay = document.getElementById("inventoryOverlay");
  const panel = document.getElementById("inventoryPanel");
  const gridRect = grid.getBoundingClientRect();
  const cell = grid.querySelector(".inv-cell");
  const cellRect = cell?.getBoundingClientRect();
  const items = [...grid.querySelectorAll(".inv-item")];
  const itemInfo = items.map((el) => {
    const icon = el.querySelector(".inv-icon");
    const iconClass = icon?.className ?? "";
    const typeMatch = iconClass.match(/inv-icon-(pet|egg|gem|amulet|stimulator|repair_kit|shard_stack)/);
    return {
      text: (el.textContent || "").trim(),
      tooltip: el.dataset.tooltip || "",
      aria: el.getAttribute("aria-label") || "",
      hasIcon: Boolean(icon),
      iconType: typeMatch?.[1] ?? null,
      classes: el.className,
    };
  });
  const detailTitle =
    document.getElementById("inventoryDetailsTitle")?.textContent?.trim() ||
    document.querySelector("#inventoryDetails .inv-details-title")?.textContent?.trim() ||
    document.querySelector(".inv-details-title")?.textContent?.trim() ||
    "";
  const detailText =
    document.getElementById("inventoryDetails")?.textContent?.trim()?.slice(0, 400) || "";
  return {
    overlayVisible: overlay?.classList.contains("visible") ?? false,
    gridWidthCss: getComputedStyle(grid).width,
    gridWidthPx: Math.round(gridRect.width),
    cellWidthPx: cellRect ? Math.round(cellRect.width) : null,
    cellHeightPx: cellRect ? Math.round(cellRect.height) : null,
    panelMaxHeight: panel ? getComputedStyle(panel).maxHeight : null,
    itemCount: items.length,
    iconCount: grid.querySelectorAll(".inv-icon").length,
    itemInfo,
    detailTitle,
    detailText,
    crypticInPrimaryLabel: itemInfo.some((i) => {
      // meta lines like "x5" ok; reject abbreviation-only primary labels
      const primary = i.text.replace(/\s+/g, " ");
      return CRYPTIC_SRC.test(primary) && !i.hasIcon;
    }),
    crypticTooltips: itemInfo.filter((i) => CRYPTIC_SRC.test(i.tooltip)).map((i) => i.tooltip),
    englishTooltips: itemInfo.map((i) => i.tooltip),
  };
}

async function pointerLock(page) {
  const box = await page.locator("#app canvas").boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(200);
  return page.evaluate(() => document.pointerLockElement !== null);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = {
    tipExpected: "0d2e9d7",
    lobbyOpen: null,
    seed: null,
    grid: null,
    tooltips: null,
    hover: null,
    select: null,
    drag: null,
    inMatch: null,
    consoleErrors: [],
  };

  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic43-qa] starting dedicated server/client");
    stack = await startStack();
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  // Inject cryptic regex into page evaluate helpers
  await page.addInitScript(() => {
    window.__CRYPTIC = /\b(STM|PET|AMU|SHD|KIT|EGG|GEM)\b/;
  });

  try {
    const email = `epic43_${Date.now()}@example.com`;
    const nickname = nick("E43");
    await registerAndContinue(page, email);
    await page.waitForFunction(
      () => document.getElementById("status")?.dataset.state === "connected",
      { timeout: 20000 },
    );

    // Seed Deathmatch bag in Redis BEFORE first lobby bind so the live
    // server cold-loads the filled profile (its write-through cache would
    // otherwise keep an empty doc after a parallel seed).
    await page.fill("#nicknameInput", nickname);
    summary.seed = await seedDeathmatchBag(nickname);
    console.log("[epic43-qa] seeded", summary.seed);

    await openLobbyInventory(page, nickname);
    summary.lobbyOpen = await page.evaluate(() => ({
      visible: document.getElementById("inventoryOverlay")?.classList.contains("visible"),
      binds: (window.__epic43Tap?.outbound ?? []).filter((m) => m.type === "lobby_bind_nickname")
        .length,
      pool: (window.__epic43Tap?.profiles ?? []).at(-1)?.economyPool ?? null,
      bagPets: (window.__epic43Tap?.profiles ?? []).at(-1)?.pets?.length ?? 0,
      bagEggs: (window.__epic43Tap?.profiles ?? []).at(-1)?.eggs?.length ?? 0,
    }));
    if (!summary.lobbyOpen.visible) failures.push("lobby inventory overlay not visible");
    await sleep(400);
    await page.screenshot({ path: join(OUT_DIR, "01-lobby-inventory-seeded.png") });

    const gridSnap = await page.evaluate(() => {
      const CRYPTIC_SRC = window.__CRYPTIC;
      const grid = document.getElementById("inventoryGrid");
      const overlay = document.getElementById("inventoryOverlay");
      const panel = document.getElementById("inventoryPanel");
      const gridRect = grid.getBoundingClientRect();
      const cell = grid.querySelector(".inv-cell");
      const cellRect = cell?.getBoundingClientRect();
      const items = [...grid.querySelectorAll(".inv-item")];
      const itemInfo = items.map((el) => {
        const icon = el.querySelector(".inv-icon");
        const iconClass = icon?.className ?? "";
        const typeMatch = iconClass.match(
          /inv-icon-(pet|egg|gem|amulet|stimulator|repair_kit|shard_stack)/,
        );
        // Strip meta secondary text for cryptic primary-label check: look at
        // non-meta children text only.
        const meta = el.querySelector(".inv-item-meta");
        const metaText = meta?.textContent?.trim() ?? "";
        const fullText = (el.textContent || "").trim();
        const labelish = metaText ? fullText.replace(metaText, "").trim() : fullText;
        return {
          text: fullText,
          labelish,
          meta: metaText,
          tooltip: el.dataset.tooltip || "",
          aria: el.getAttribute("aria-label") || "",
          hasIcon: Boolean(icon),
          iconType: typeMatch?.[1] ?? null,
          classes: el.className,
        };
      });
      return {
        overlayVisible: overlay?.classList.contains("visible") ?? false,
        gridWidthCss: getComputedStyle(grid).width,
        gridWidthPx: Math.round(gridRect.width),
        cellWidthPx: cellRect ? Math.round(cellRect.width) : null,
        cellHeightPx: cellRect ? Math.round(cellRect.height) : null,
        panelMaxHeight: panel ? getComputedStyle(panel).maxHeight : null,
        itemCount: items.length,
        iconCount: grid.querySelectorAll(".inv-icon").length,
        itemInfo,
        crypticPrimary: itemInfo.filter((i) => CRYPTIC_SRC.test(i.labelish)).map((i) => i.labelish),
        crypticTooltips: itemInfo.filter((i) => CRYPTIC_SRC.test(i.tooltip)).map((i) => i.tooltip),
        englishTooltips: itemInfo.map((i) => i.tooltip),
        typesPresent: [...new Set(itemInfo.map((i) => i.iconType).filter(Boolean))],
      };
    });
    summary.grid = {
      ...gridSnap,
      scaleVsBefore: gridSnap.cellWidthPx ? gridSnap.cellWidthPx / BEFORE_CELL_PX : null,
    };

    if (!gridSnap.overlayVisible) failures.push("overlay not visible after seed re-open");
    if (gridSnap.gridWidthPx < 900) {
      failures.push(`grid width ${gridSnap.gridWidthPx}px < 900 (expected ~960)`);
    }
    if (!gridSnap.cellWidthPx || gridSnap.cellWidthPx < 100) {
      failures.push(`cell ${gridSnap.cellWidthPx}px too small (want ~115 / ~2×)`);
    }
    if ((summary.grid.scaleVsBefore ?? 0) < 1.7) {
      failures.push(`cell scale ${summary.grid.scaleVsBefore} < 1.7× vs prior ~56.5px`);
    }
    if (gridSnap.itemCount < 7) failures.push(`expected ≥7 bag items, got ${gridSnap.itemCount}`);
    if (gridSnap.iconCount < 7) failures.push(`expected ≥7 icons, got ${gridSnap.iconCount}`);
    if (gridSnap.crypticPrimary.length) {
      failures.push(`cryptic primary labels: ${gridSnap.crypticPrimary.join(" | ")}`);
    }
    if (gridSnap.crypticTooltips.length) {
      failures.push(`cryptic tooltips: ${gridSnap.crypticTooltips.join(" | ")}`);
    }

    const expectedNameBits = [
      /Stimulator/i,
      /Pet/i,
      /Egg/i,
      /Gem/i,
      /Amulet/i,
      /Repair kit/i,
      /Shard/i,
    ];
    const tipJoined = gridSnap.englishTooltips.join(" || ");
    for (const re of expectedNameBits) {
      if (!re.test(tipJoined)) failures.push(`missing English tooltip match ${re}`);
    }
    summary.tooltips = gridSnap.englishTooltips;

    await page.screenshot({ path: join(OUT_DIR, "02-lobby-inventory-icons-large-grid.png") });

    // Hover first item — capture CSS tooltip (::after) via forced hover + screenshot.
    const itemCount = await page.locator("#inventoryGrid .inv-item").count();
    if (itemCount < 1) {
      failures.push("no .inv-item cells after seed+bind — cannot hover/select");
      summary.ok = false;
      summary.failures = failures;
      await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));
      console.error("[epic43-qa] FAIL", failures);
      process.exitCode = 1;
      return;
    }
    const firstItem = page.locator("#inventoryGrid .inv-item").first();
    await firstItem.scrollIntoViewIfNeeded();
    await firstItem.hover();
    await sleep(350);
    const hoverProbe = await page.evaluate(() => {
      const el = document.querySelector("#inventoryGrid .inv-item");
      if (!el) return null;
      const after = getComputedStyle(el, "::after");
      return {
        tooltip: el.dataset.tooltip || "",
        afterContent: after.content,
        afterDisplay: after.display,
        afterOpacity: after.opacity,
      };
    });
    summary.hover = hoverProbe;
    if (!hoverProbe?.tooltip || /STM|PET|AMU/.test(hoverProbe.tooltip)) {
      failures.push(`hover tooltip bad: ${hoverProbe?.tooltip}`);
    }
    // CSS tooltip should be visible on hover (opacity > 0 or content not none)
    const tipVisible =
      hoverProbe &&
      hoverProbe.afterContent &&
      hoverProbe.afterContent !== "none" &&
      hoverProbe.afterContent !== '""';
    if (!tipVisible) {
      // soft note — still dump aria; may clip but data-tooltip is required
      summary.hover.note = "CSS ::after tooltip may be clipped; data-tooltip present";
    }
    await page.screenshot({ path: join(OUT_DIR, "03-hover-tooltip.png") });

    // Select item → detail English title
    await firstItem.click();
    await sleep(200);
    const selectSnap = await page.evaluate(() => {
      const details = document.getElementById("inventoryDetails");
      const titleEl =
        details?.querySelector(".inv-details-title") ||
        details?.querySelector("[data-details-title]") ||
        null;
      // title row often has icon + text
      const titleText = (titleEl?.textContent || details?.textContent || "").trim().slice(0, 200);
      return {
        titleText,
        hasDetailIcon: Boolean(details?.querySelector(".inv-icon")),
        cryptic: /\b(STM|PET|AMU|SHD|KIT|EGG|GEM)\b/.test(titleText),
      };
    });
    summary.select = selectSnap;
    if (selectSnap.cryptic) failures.push(`detail title cryptic: ${selectSnap.titleText}`);
    if (!/Pet|Egg|Gem|Amulet|Stimulator|Repair|Shard/i.test(selectSnap.titleText)) {
      failures.push(`detail title not English readable: ${selectSnap.titleText}`);
    }
    await page.screenshot({ path: join(OUT_DIR, "04-selected-detail-english.png") });

    // Drag smoke: move first 1-cell item to an empty cell if possible
    const dragResult = await page.evaluate(async () => {
      const items = [...document.querySelectorAll("#inventoryGrid .inv-item")];
      const target = items.find((el) => {
        const icon = el.querySelector(".inv-icon");
        return icon && /inv-icon-(stimulator|repair_kit|gem|egg|pet|shard_stack)/.test(icon.className);
      });
      if (!target) return { ok: false, reason: "no 1-cell item" };
      const cells = [...document.querySelectorAll("#inventoryGrid .inv-cell")];
      const empty = cells.find((c) => {
        const col = Number(c.style.gridColumn);
        const row = Number(c.style.gridRow);
        // naive: pick a far cell
        return col >= 6 && row >= 6;
      });
      if (!empty) return { ok: false, reason: "no empty cell" };
      const from = target.getBoundingClientRect();
      const to = empty.getBoundingClientRect();
      const outboundBefore = (window.__epic43Tap?.outbound ?? []).length;
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: from.x + from.width / 2,
          clientY: from.y + from.height / 2,
          pointerId: 1,
          button: 0,
          pointerType: "mouse",
        }),
      );
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: to.x + to.width / 2,
          clientY: to.y + to.height / 2,
          pointerId: 1,
          button: 0,
          pointerType: "mouse",
        }),
      );
      target.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          clientX: to.x + to.width / 2,
          clientY: to.y + to.height / 2,
          pointerId: 1,
          button: 0,
          pointerType: "mouse",
        }),
      );
      await new Promise((r) => setTimeout(r, 400));
      const moveMsgs = (window.__epic43Tap?.outbound ?? [])
        .slice(outboundBefore)
        .filter((m) => m.type === "economy_move_item" || m.type === "economy_bag_move");
      return {
        ok: true,
        moveMsgTypes: moveMsgs.map((m) => m.type),
        outboundDelta: (window.__epic43Tap?.outbound ?? []).length - outboundBefore,
        ghostGone: !document.querySelector(".inv-drag-ghost"),
      };
    });
    summary.drag = dragResult;
    // Soft: drag may use different message name — check inventoryOverlay for type
    await page.screenshot({ path: join(OUT_DIR, "05-after-drag-smoke.png") });

    await closeInventory(page);

    // In-match: same overlay via I
    await page.fill("#nicknameInput", nickname);
    await page.waitForFunction(
      () => {
        const btn = document.getElementById("modeBotsBtn");
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );
    await page.click("#modeBotsBtn");
    await page.waitForFunction(
      () => document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 15000 },
    );
    await sleep(800);
    const locked = await pointerLock(page);
    await page.keyboard.press("Escape");
    await sleep(150);
    await page.keyboard.press("KeyI");
    await sleep(400);
    const inMatch = await page.evaluate(() => {
      const overlay = document.getElementById("inventoryOverlay");
      const grid = document.getElementById("inventoryGrid");
      const icons = grid?.querySelectorAll(".inv-icon").length ?? 0;
      const cryptic = [...(grid?.querySelectorAll(".inv-item") ?? [])].some((el) => {
        const meta = el.querySelector(".inv-item-meta");
        const metaText = meta?.textContent?.trim() ?? "";
        const full = (el.textContent || "").trim();
        const labelish = metaText ? full.replace(metaText, "").trim() : full;
        return window.__CRYPTIC.test(labelish);
      });
      return {
        visible: overlay?.classList.contains("visible") ?? false,
        overlayId: overlay?.id ?? null,
        icons,
        cryptic,
        gridWidthPx: grid ? Math.round(grid.getBoundingClientRect().width) : null,
      };
    });
    summary.inMatch = { ...inMatch, locked };
    if (!inMatch.visible) failures.push("in-match I did not open inventory");
    if (inMatch.overlayId !== "inventoryOverlay") failures.push("in-match wrong overlay");
    if (inMatch.cryptic) failures.push("in-match cryptic primary labels");
    if ((inMatch.gridWidthPx ?? 0) < 900) {
      failures.push(`in-match grid width ${inMatch.gridWidthPx}`);
    }
    await page.screenshot({ path: join(OUT_DIR, "06-inmatch-inventory-I.png") });

    summary.consoleErrors = consoleErrors.filter(
      (e) => !/favicon/i.test(e) && !/DevTools/i.test(e),
    );
    const hardErrors = summary.consoleErrors.filter((e) =>
      /TypeError|ReferenceError|is not defined|Cannot read/i.test(e),
    );
    if (hardErrors.length) failures.push(`console: ${hardErrors.slice(0, 3).join("; ")}`);

    summary.ok = failures.length === 0;
    summary.failures = failures;
    await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));
    console.log("[epic43-qa] summary", JSON.stringify(summary, null, 2));
    if (failures.length) {
      console.error("[epic43-qa] FAIL", failures);
      process.exitCode = 1;
    } else {
      console.log("[epic43-qa] PASS");
    }
  } finally {
    await browser.close().catch(() => undefined);
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
    }
  }
}

main().catch((err) => {
  console.error("[epic43-qa] FATAL", err);
  process.exit(1);
});

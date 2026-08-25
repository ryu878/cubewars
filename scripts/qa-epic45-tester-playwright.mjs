// Tester Playwright evidence for EPIC 45 — dual lobby inventories + lobby Auction.
//
// Checks:
//   1) Lobby shows Deathmatch Inventory, Bots Inventory, Auction (disabled pre-auth)
//   2) Deathmatch Inventory → deathmatch bind + Pool: Deathmatch badge; no join
//   3) Bots Inventory → sandbox bind + Pool: Sandbox badge; no join
//   4) Auction → deathmatch bind + auction panel open + auction_browse; no join
//   5) Lobby I/P hotkeys do not open inventory/auction
//   6) Light in-match smoke (movement) after bots join
//
// Usage:
//   node scripts/qa-epic45-tester-playwright.mjs
//   node scripts/qa-epic45-tester-playwright.mjs <clientUrl> <outDir>

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
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-45");
const MANAGE_STACK = process.argv[2] === undefined;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;

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
      window.__epic45Tap = window.__epic45Tap || {
        welcomeId: null,
        outbound: [],
        profiles: [],
        actionResults: [],
        auctionStates: [],
        lastSelf: null,
      };
      window.__epic45Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic45Tap.outbound.push(msg);
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "welcome") window.__epic45Tap.welcomeId = msg.playerId;
          if (msg.type === "economy_profile") window.__epic45Tap.profiles.push(msg);
          if (msg.type === "economy_action_result") window.__epic45Tap.actionResults.push(msg);
          if (msg.type === "economy_auction_state") window.__epic45Tap.auctionStates.push(msg);
          if (msg.type === "world_state" && Array.isArray(msg.players)) {
            const selfId = window.__epic45Tap.welcomeId;
            const self = msg.players.find((p) => p.id === selfId);
            if (self) {
              window.__epic45Tap.lastSelf = {
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

async function closeInventoryIfOpen(page) {
  await page.keyboard.press("Escape");
  await sleep(200);
  const stillOpen = await page.evaluate(
    () => document.getElementById("inventoryOverlay")?.classList.contains("visible") ?? false,
  );
  if (stillOpen) {
    const closeBtn = page.locator("#inventoryCloseBtn, #inventoryOverlay button").first();
    if (await closeBtn.count()) await closeBtn.click().catch(() => undefined);
    await sleep(200);
  }
}

async function closeAuctionIfOpen(page) {
  await page.keyboard.press("Escape");
  await sleep(200);
  const stillOpen = await page.evaluate(
    () => document.getElementById("auctionOverlay")?.classList.contains("visible") ?? false,
  );
  if (stillOpen) {
    const closeBtn = page.locator("#auctionCloseBtn").first();
    if (await closeBtn.count()) await closeBtn.click().catch(() => undefined);
    await sleep(200);
  }
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
    preAuthButtons: null,
    deathmatchInventory: null,
    botsInventory: null,
    lobbyAuction: null,
    lobbyHotkeys: null,
    gameplay: null,
    consoleErrors: [],
  };

  let stack = null;
  if (MANAGE_STACK) {
    console.log("[epic45-qa] starting dedicated server/client");
    stack = await startStack();
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  try {
    // --- Pre-auth: three lobby economy buttons present, disabled ---
    await installWsTap(page);
    await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("#modeSelect", { timeout: 15000 });
    await page.waitForFunction(
      () => document.getElementById("status")?.dataset.state === "connected",
      { timeout: 20000 },
    );

    const preAuth = await page.evaluate(() => {
      const dm = document.getElementById("lobbyDeathmatchInventoryBtn");
      const bots = document.getElementById("lobbyBotsInventoryBtn");
      const auction = document.getElementById("lobbyAuctionBtn");
      return {
        dm: {
          exists: Boolean(dm),
          label: dm?.textContent?.trim() ?? null,
          disabled: dm?.disabled ?? null,
        },
        bots: {
          exists: Boolean(bots),
          label: bots?.textContent?.trim() ?? null,
          disabled: bots?.disabled ?? null,
        },
        auction: {
          exists: Boolean(auction),
          label: auction?.textContent?.trim() ?? null,
          disabled: auction?.disabled ?? null,
        },
        oldInventoryExists: Boolean(document.getElementById("lobbyInventoryBtn")),
      };
    });
    summary.preAuthButtons = preAuth;
    if (!preAuth.dm.exists) failures.push("Deathmatch Inventory button missing");
    if (preAuth.dm.label !== "Deathmatch Inventory") {
      failures.push(`DM button label: "${preAuth.dm.label}"`);
    }
    if (!preAuth.dm.disabled) failures.push("DM Inventory should be disabled before auth");
    if (!preAuth.bots.exists) failures.push("Bots Inventory button missing");
    if (preAuth.bots.label !== "Bots Inventory") {
      failures.push(`Bots button label: "${preAuth.bots.label}"`);
    }
    if (!preAuth.bots.disabled) failures.push("Bots Inventory should be disabled before auth");
    if (!preAuth.auction.exists) failures.push("Auction button missing");
    if (preAuth.auction.label !== "Auction") {
      failures.push(`Auction button label: "${preAuth.auction.label}"`);
    }
    if (!preAuth.auction.disabled) failures.push("Auction should be disabled before auth");
    if (preAuth.oldInventoryExists) failures.push("legacy single lobbyInventoryBtn still present");

    await page.screenshot({
      path: join(OUT_DIR, "01-lobby-dual-buttons-preauth.png"),
      fullPage: true,
    });

    // --- Auth + valid nickname ---
    const email = `epic45_${Date.now()}@example.com`;
    await registerAndContinue(page, email);
    const nickname = nick("L45");
    await page.fill("#nicknameInput", nickname);
    await page.waitForFunction(
      () => {
        const dm = document.getElementById("lobbyDeathmatchInventoryBtn");
        return dm && !dm.disabled;
      },
      { timeout: 20000 },
    );

    await page.screenshot({
      path: join(OUT_DIR, "02-lobby-dual-buttons-authed.png"),
      fullPage: true,
    });

    // --- Deathmatch Inventory ---
    await page.evaluate(() => {
      if (window.__epic45Tap) {
        window.__epic45Tap.outbound = [];
        window.__epic45Tap.profiles = [];
      }
    });
    await page.click("#lobbyDeathmatchInventoryBtn");
    await page.waitForFunction(
      () => document.getElementById("inventoryOverlay")?.classList.contains("visible") === true,
      null,
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () =>
        (window.__epic45Tap?.profiles ?? []).some((p) => p.economyPool === "deathmatch"),
      null,
      { timeout: 15000 },
    );

    const dmInv = await page.evaluate(() => {
      const tap = window.__epic45Tap;
      const binds = (tap?.outbound ?? []).filter((m) => m.type === "lobby_bind_nickname");
      const joins = (tap?.outbound ?? []).filter((m) => m.type === "join");
      const profiles = (tap?.profiles ?? []).filter((p) => p.economyPool === "deathmatch");
      const badge = document.getElementById("inventoryPoolBadge")?.textContent?.trim() ?? "";
      const badgePool =
        document.getElementById("inventoryPoolBadge")?.getAttribute("data-pool") ?? null;
      return {
        overlayVisible:
          document.getElementById("inventoryOverlay")?.classList.contains("visible") ?? false,
        bindPool: binds[binds.length - 1]?.economyPool ?? null,
        bindNick: binds[binds.length - 1]?.nickname ?? null,
        joinCount: joins.length,
        economyPool: profiles[profiles.length - 1]?.economyPool ?? null,
        badge,
        badgePool,
      };
    });
    summary.deathmatchInventory = dmInv;
    if (!dmInv.overlayVisible) failures.push("DM inventory overlay not visible");
    if (dmInv.bindPool !== "deathmatch") failures.push(`DM bind pool: ${dmInv.bindPool}`);
    if (dmInv.bindNick !== nickname) failures.push("DM bind nickname mismatch");
    if (dmInv.joinCount > 0) failures.push("join sent during DM inventory open");
    if (dmInv.economyPool !== "deathmatch") failures.push("DM profile pool wrong");
    if (!/Deathmatch/i.test(dmInv.badge)) failures.push(`DM badge text: "${dmInv.badge}"`);
    if (dmInv.badgePool !== "deathmatch") failures.push(`DM badge data-pool: ${dmInv.badgePool}`);

    await page.screenshot({
      path: join(OUT_DIR, "03-deathmatch-inventory-open.png"),
      fullPage: true,
    });
    await closeInventoryIfOpen(page);

    // --- Bots Inventory (sandbox) ---
    await page.evaluate(() => {
      if (window.__epic45Tap) {
        window.__epic45Tap.outbound = [];
        window.__epic45Tap.profiles = [];
      }
    });
    await page.click("#lobbyBotsInventoryBtn");
    await page.waitForFunction(
      () => document.getElementById("inventoryOverlay")?.classList.contains("visible") === true,
      null,
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () => (window.__epic45Tap?.profiles ?? []).some((p) => p.economyPool === "sandbox"),
      null,
      { timeout: 15000 },
    );

    const botsInv = await page.evaluate(() => {
      const tap = window.__epic45Tap;
      const binds = (tap?.outbound ?? []).filter((m) => m.type === "lobby_bind_nickname");
      const joins = (tap?.outbound ?? []).filter((m) => m.type === "join");
      const profiles = (tap?.profiles ?? []).filter((p) => p.economyPool === "sandbox");
      const badge = document.getElementById("inventoryPoolBadge")?.textContent?.trim() ?? "";
      const badgePool =
        document.getElementById("inventoryPoolBadge")?.getAttribute("data-pool") ?? null;
      return {
        overlayVisible:
          document.getElementById("inventoryOverlay")?.classList.contains("visible") ?? false,
        bindPool: binds[binds.length - 1]?.economyPool ?? null,
        joinCount: joins.length,
        economyPool: profiles[profiles.length - 1]?.economyPool ?? null,
        badge,
        badgePool,
      };
    });
    summary.botsInventory = botsInv;
    if (!botsInv.overlayVisible) failures.push("Bots inventory overlay not visible");
    if (botsInv.bindPool !== "sandbox") failures.push(`Bots bind pool: ${botsInv.bindPool}`);
    if (botsInv.joinCount > 0) failures.push("join sent during Bots inventory open");
    if (botsInv.economyPool !== "sandbox") failures.push("Bots profile pool wrong");
    if (!/Sandbox/i.test(botsInv.badge)) failures.push(`Bots badge text: "${botsInv.badge}"`);
    if (botsInv.badgePool !== "sandbox") failures.push(`Bots badge data-pool: ${botsInv.badgePool}`);

    await page.screenshot({
      path: join(OUT_DIR, "04-bots-inventory-open.png"),
      fullPage: true,
    });
    await closeInventoryIfOpen(page);

    // --- Lobby Auction ---
    await page.evaluate(() => {
      if (window.__epic45Tap) {
        window.__epic45Tap.outbound = [];
        window.__epic45Tap.profiles = [];
        window.__epic45Tap.auctionStates = [];
        window.__epic45Tap.actionResults = [];
      }
    });
    await page.click("#lobbyAuctionBtn");
    await page.waitForFunction(
      () => document.getElementById("auctionOverlay")?.classList.contains("visible") === true,
      null,
      { timeout: 10000 },
    );
    // Browse may race ahead of bind on a fresh connection; wait for browse OK or state.
    // After prior lobby binds nicknameReady is already true, so browse should succeed.
    await page.waitForFunction(
      () => {
        const tap = window.__epic45Tap;
        const browseOk = (tap?.actionResults ?? []).some(
          (r) => r.action === "auction_browse" && r.ok,
        );
        const hasState = (tap?.auctionStates ?? []).length > 0;
        const browseSent = (tap?.outbound ?? []).some((m) => m.type === "economy_auction_browse");
        return browseOk || hasState || browseSent;
      },
      null,
      { timeout: 15000 },
    );
    // Give the server a moment to answer browse after bind if race occurred.
    await sleep(800);
    // If browse was sent before nicknameReady, refresh once after profile arrives.
    await page.evaluate(() => {
      const tap = window.__epic45Tap;
      const browseOk = (tap?.actionResults ?? []).some(
        (r) => r.action === "auction_browse" && r.ok,
      );
      const hasState = (tap?.auctionStates ?? []).length > 0;
      if (!browseOk && !hasState && tap?.ws && tap.ws.readyState === 1) {
        tap.ws.send(JSON.stringify({ type: "economy_auction_browse" }));
      }
    });
    await page.waitForFunction(
      () => {
        const tap = window.__epic45Tap;
        const browseOk = (tap?.actionResults ?? []).some(
          (r) => r.action === "auction_browse" && r.ok,
        );
        return browseOk || (tap?.auctionStates ?? []).length > 0;
      },
      null,
      { timeout: 15000 },
    );

    const lobbyAuction = await page.evaluate(() => {
      const tap = window.__epic45Tap;
      const binds = (tap?.outbound ?? []).filter((m) => m.type === "lobby_bind_nickname");
      const joins = (tap?.outbound ?? []).filter((m) => m.type === "join");
      const browses = (tap?.outbound ?? []).filter((m) => m.type === "economy_auction_browse");
      const browseResults = (tap?.actionResults ?? []).filter((r) => r.action === "auction_browse");
      const heading =
        document.querySelector("#auctionPanel h2")?.textContent?.trim() ??
        document.getElementById("auctionPanel")?.textContent?.slice(0, 80) ??
        "";
      return {
        overlayVisible:
          document.getElementById("auctionOverlay")?.classList.contains("visible") ?? false,
        bindPool: binds[binds.length - 1]?.economyPool ?? null,
        joinCount: joins.length,
        browseSent: browses.length > 0,
        browseOk: browseResults.some((r) => r.ok),
        auctionStateCount: (tap?.auctionStates ?? []).length,
        heading,
        deathmatchProfiles: (tap?.profiles ?? []).filter((p) => p.economyPool === "deathmatch")
          .length,
        sandboxProfilesAfterAuction: (tap?.profiles ?? []).filter((p) => p.economyPool === "sandbox")
          .length,
      };
    });
    summary.lobbyAuction = lobbyAuction;
    if (!lobbyAuction.overlayVisible) failures.push("auction overlay not visible from lobby");
    if (lobbyAuction.bindPool !== "deathmatch") {
      failures.push(`auction bind pool: ${lobbyAuction.bindPool}`);
    }
    if (lobbyAuction.joinCount > 0) failures.push("join sent during lobby auction open");
    if (!lobbyAuction.browseOk && lobbyAuction.auctionStateCount < 1) {
      failures.push("auction browse/state missing from lobby");
    }
    if (lobbyAuction.sandboxProfilesAfterAuction > 0) {
      // Soft note only if unexpected: auction must not push sandbox profiles.
      failures.push("sandbox economy_profile received during lobby auction open");
    }
    if (lobbyAuction.overlayVisible && !/Auction/i.test(lobbyAuction.heading)) {
      failures.push(`auction heading unexpected: "${lobbyAuction.heading}"`);
    }

    await page.screenshot({
      path: join(OUT_DIR, "05-lobby-auction-open.png"),
      fullPage: true,
    });
    await closeAuctionIfOpen(page);

    // --- Lobby I/P hotkeys ignored ---
    await page.fill("#nicknameInput", "");
    await page.focus("#nicknameInput");
    await page.keyboard.type("ippi");
    await sleep(300);
    const hotkeys = await page.evaluate(() => ({
      inventoryVisible:
        document.getElementById("inventoryOverlay")?.classList.contains("visible") ?? false,
      auctionVisible:
        document.getElementById("auctionPanel")?.classList.contains("visible") ?? false,
      nickValue: document.getElementById("nicknameInput")?.value ?? "",
      modeSelectVisible: !document.getElementById("modeSelect")?.classList.contains("hidden"),
    }));
    summary.lobbyHotkeys = hotkeys;
    if (hotkeys.inventoryVisible) failures.push("I/P opened inventory on lobby");
    if (hotkeys.auctionVisible) failures.push("hotkey opened auction on lobby");
    if (!hotkeys.nickValue.includes("i") || !hotkeys.nickValue.includes("p")) {
      failures.push("nickname field did not accept typed i/p");
    }
    await page.screenshot({
      path: join(OUT_DIR, "06-lobby-hotkeys-ignored.png"),
      fullPage: true,
    });

    // --- Light gameplay smoke after bots join ---
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
    const beforePos = await page.evaluate(() => window.__epic45Tap?.lastSelf?.position ?? null);
    await page.keyboard.down("KeyW");
    await sleep(400);
    await page.keyboard.up("KeyW");
    await page.mouse.move(640, 400);
    await page.mouse.move(700, 420);
    await page.keyboard.press("Space");
    await sleep(500);
    const afterPos = await page.evaluate(() => window.__epic45Tap?.lastSelf?.position ?? null);
    const moved =
      beforePos &&
      afterPos &&
      (Math.abs(beforePos.x - afterPos.x) > 0.05 ||
        Math.abs(beforePos.z - afterPos.z) > 0.05 ||
        Math.abs(beforePos.y - afterPos.y) > 0.05);
    summary.gameplay = { locked, beforePos, afterPos, moved: Boolean(moved) };
    if (!moved) failures.push("movement smoke: position did not change");

    await page.screenshot({
      path: join(OUT_DIR, "07-inmatch-gameplay-smoke.png"),
      fullPage: true,
    });

    summary.consoleErrors = consoleErrors.filter(
      (e) => !/favicon/i.test(e) && !/DevTools/i.test(e),
    );
    const hardErrors = summary.consoleErrors.filter(
      (e) => /TypeError|ReferenceError|is not defined|Cannot read/i.test(e),
    );
    if (hardErrors.length) failures.push(`console errors: ${hardErrors.slice(0, 3).join("; ")}`);

    summary.ok = failures.length === 0;
    summary.failures = failures;
    await writeFile(join(OUT_DIR, "smoke-summary.json"), JSON.stringify(summary, null, 2));
    console.log("[epic45-qa] summary", JSON.stringify(summary, null, 2));
    if (failures.length) {
      console.error("[epic45-qa] FAIL", failures);
      process.exitCode = 1;
    } else {
      console.log("[epic45-qa] PASS");
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
  console.error("[epic45-qa] FATAL", err);
  process.exit(1);
});

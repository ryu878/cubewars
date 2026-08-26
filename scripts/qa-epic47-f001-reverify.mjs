// EPIC 47 Critic F-001 re-verify (Tester):
// Pause Auction in bots must NOT send lobby_bind_nickname / set lastLobbyBindPool
// to deathmatch; sandbox economy_profile must still apply; Inventory pool stays Sandbox.
//
// Usage:
//   node scripts/qa-epic47-f001-reverify.mjs

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7807;
const CLIENT_PORT = 5227;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-47");

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
        /* already dead */
      }
      resolve();
    }, 3000);
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
      window.__epic47F001Tap = window.__epic47F001Tap || {
        outbound: [],
        inboundProfiles: [],
        joinAccepted: [],
        mapStates: [],
      };
      window.__epic47F001Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic47F001Tap.outbound.push({ ...msg, _t: Date.now() });
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "economy_profile") {
            window.__epic47F001Tap.inboundProfiles.push(msg);
          }
          if (msg.type === "join_accepted") window.__epic47F001Tap.joinAccepted.push(msg);
          if (msg.type === "map_state") window.__epic47F001Tap.mapStates.push(msg);
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

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  const summary = {
    shaHint: "verify against 0e03183 F-001 fix",
    before: null,
    afterAuction: null,
    probe: null,
    inventory: null,
  };

  console.log("[epic47-f001] starting dedicated server/client");
  const stack = await startStack();
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-gl=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-proxy-server",
      "--proxy-bypass-list=*",
    ],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const nickname = nick("F001");
    await installWsTap(page);
    await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load", timeout: 30000 });
    await page.waitForSelector("#mapSelect", { timeout: 15000 });
    await page.waitForFunction(
      () => document.getElementById("status")?.dataset.state === "connected",
      { timeout: 20000 },
    );
    const email = `epic47_f001_${Date.now()}@example.com`;
    await registerAndContinue(page, email);
    await page.fill("#nicknameInput", nickname);
    await page.waitForFunction(
      () => {
        const btn = document.getElementById("modeBotsBtn");
        return btn && !btn.disabled;
      },
      { timeout: 20000 },
    );

    await page.selectOption("#mapSelect", "rust_canyon");
    await page.evaluate(() => localStorage.setItem("cubewars.mapId", "rust_canyon"));
    await page.click("#modeBotsBtn");
    await page.waitForFunction(
      () => document.getElementById("modeSelect")?.classList.contains("hidden"),
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () => (window.__epic47F001Tap?.mapStates ?? []).length > 0,
      { timeout: 15000 },
    );
    await page.waitForFunction(
      () =>
        (window.__epic47F001Tap?.inboundProfiles ?? []).some((p) => p.economyPool === "sandbox"),
      { timeout: 15000 },
    );
    await sleep(500);

    const before = await page.evaluate(() => {
      const profiles = window.__epic47F001Tap?.inboundProfiles ?? [];
      const lastSandbox = [...profiles].reverse().find((p) => p.economyPool === "sandbox") ?? null;
      const outboundAfterJoin = (window.__epic47F001Tap?.outbound ?? []).filter((m) => {
        const joins = (window.__epic47F001Tap?.outbound ?? []).filter((x) => x.type === "join");
        const lastJoinT = joins.at(-1)?._t ?? 0;
        return m._t >= lastJoinT;
      });
      return {
        goldHud: document.getElementById("goldValue")?.textContent ?? null,
        lastSandboxGold: lastSandbox?.gold ?? null,
        lastSandboxPool: lastSandbox?.economyPool ?? null,
        bindsAfterJoin: outboundAfterJoin.filter((m) => m.type === "lobby_bind_nickname"),
        joinAcceptedMode: (window.__epic47F001Tap?.joinAccepted ?? []).at(-1)?.mode ?? null,
      };
    });
    summary.before = before;
    if (before.lastSandboxPool !== "sandbox") failures.push("no sandbox economy_profile before auction");
    await page.screenshot({ path: join(OUT_DIR, "11-f001-bots-before-pause-auction.png") });

    // Mark outbound cursor before pause Auction
    await page.evaluate(() => {
      window.__epic47F001Tap.outboundMark = (window.__epic47F001Tap.outbound ?? []).length;
    });

    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("pauseMenu")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    await page.screenshot({ path: join(OUT_DIR, "12-f001-esc-pause-before-auction.png") });
    await page.click("#pauseAuctionBtn");
    await page.waitForFunction(
      () => document.getElementById("auctionOverlay")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    await sleep(300);

    const afterAuction = await page.evaluate(() => {
      const mark = window.__epic47F001Tap.outboundMark ?? 0;
      const since = (window.__epic47F001Tap.outbound ?? []).slice(mark);
      return {
        auctionVisible: document.getElementById("auctionOverlay")?.classList.contains("visible") ?? false,
        pauseVisible: document.getElementById("pauseMenu")?.classList.contains("visible") ?? false,
        outboundSinceAuctionClick: since.map((m) => ({
          type: m.type,
          economyPool: m.economyPool,
        })),
        lobbyBinds: since.filter((m) => m.type === "lobby_bind_nickname"),
      };
    });
    summary.afterAuction = afterAuction;
    if (!afterAuction.auctionVisible) failures.push("auction panel did not open from pause");
    if (afterAuction.pauseVisible) failures.push("pause still visible after Auction");
    if (afterAuction.lobbyBinds.length > 0) {
      failures.push(
        `pause Auction sent lobby_bind_nickname: ${JSON.stringify(afterAuction.lobbyBinds)}`,
      );
    }
    await page.screenshot({ path: join(OUT_DIR, "13-f001-pause-auction-open.png") });

    await page.click("#auctionCloseBtn");
    await page.waitForFunction(
      () => !document.getElementById("auctionOverlay")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    await sleep(200);

    // Probe: inject synthetic sandbox economy_profile via WS MessageEvent.
    // If lastLobbyBindPool were poisoned to deathmatch, HUD gold would NOT update.
    const probeGold = 424242;
    const probeOk = await page.evaluate(
      ({ nickname, probeGold }) => {
        const ws = window.__epic47F001Tap?.ws;
        if (!ws) return { ok: false, reason: "no ws" };
        const msg = {
          type: "economy_profile",
          nickname,
          economyPool: "sandbox",
          gold: probeGold,
          pets: [],
          eggs: [],
          stimulatorCount: 0,
          stimulators: [],
          gems: [],
          amulets: [],
          shardCount: 0,
          shardSlotAnchor: null,
          repairKitCount: 0,
          repairKits: [],
          ratings: { attack: 0, defense: 0, speed: 0, luck: 0 },
          slot2Enabled: false,
        };
        ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(msg) }));
        const goldHud = document.getElementById("goldValue")?.textContent ?? null;
        return {
          ok: goldHud === String(probeGold),
          goldHud,
          probeGold,
        };
      },
      { nickname, probeGold },
    );
    summary.probe = probeOk;
    if (!probeOk.ok) {
      failures.push(
        `sandbox economy_profile probe not applied after pause Auction (goldHud=${probeOk.goldHud}, expected ${probeGold}) — lastLobbyBindPool likely stuck`,
      );
    }
    await page.screenshot({ path: join(OUT_DIR, "14-f001-sandbox-profile-after-auction.png") });

    // Light regression: pause Inventory still works; Pool stays Sandbox
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.getElementById("pauseMenu")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    await page.click("#pauseInventoryBtn");
    await page.waitForFunction(
      () => document.getElementById("inventoryOverlay")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    await sleep(200);
    const inventory = await page.evaluate(() => {
      const badge = document.getElementById("inventoryPoolBadge")?.textContent ?? "";
      return {
        visible: document.getElementById("inventoryOverlay")?.classList.contains("visible") ?? false,
        poolBadge: badge,
        isSandbox: /Sandbox/i.test(badge),
        goldHud: document.getElementById("goldValue")?.textContent ?? null,
      };
    });
    summary.inventory = inventory;
    if (!inventory.visible) failures.push("pause Inventory did not open");
    if (!inventory.isSandbox) {
      failures.push(`inventory pool badge not Sandbox: ${inventory.poolBadge}`);
    }
    await page.screenshot({ path: join(OUT_DIR, "15-f001-inventory-sandbox-after-auction.png") });

    await writeFile(
      join(OUT_DIR, "f001-reverify-summary.json"),
      JSON.stringify({ failures, summary }, null, 2),
    );
    console.log("[epic47-f001] summary", JSON.stringify(summary, null, 2));
    if (failures.length) {
      console.error("[epic47-f001] FAIL", failures);
      process.exitCode = 1;
    } else {
      console.log("[epic47-f001] PASS");
    }
  } finally {
    await browser.close();
    await stop(stack.client);
    await stop(stack.server);
  }
}

main().catch((err) => {
  console.error("[epic47-f001] FAIL", err);
  process.exit(1);
});

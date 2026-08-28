// EPIC 51 Playwright QA: dev console (~ / IDDQD) + pet DR labels + armorHud pickup subtitle.
//
// Usage:
//   node scripts/qa-epic51-tester-playwright.mjs
//   node scripts/qa-epic51-tester-playwright.mjs <clientUrl> <outDir>

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");

const SERVER_PORT = 7851;
const CLIENT_PORT = 5251;
const DEFAULT_CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const CLIENT_URL = process.argv[2] ?? DEFAULT_CLIENT_URL;
const OUT_DIR = process.argv[3] ?? join(REPO_ROOT, "qa-artifacts", "epic-51");
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
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("exit", finish);
    try {
      child.kill("SIGKILL");
    } catch {
      finish();
    }
    setTimeout(finish, 1500);
  });
}

async function startStack() {
  const server = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(REPO_ROOT, "server"),
    env: { ...process.env, CUBEWARS_SERVER_PORT: String(SERVER_PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(server, "server", "listening on");

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
      window.__epic51Tap = window.__epic51Tap || {
        outbound: [],
        devResults: [],
        profiles: [],
        joinAccepted: [],
      };
      window.__epic51Tap.ws = ws;
      const origSend = ws.send.bind(ws);
      ws.send = (data) => {
        try {
          const msg = JSON.parse(typeof data === "string" ? data : "");
          window.__epic51Tap.outbound.push(msg);
        } catch {
          /* ignore */
        }
        return origSend(data);
      };
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "dev_console_result") window.__epic51Tap.devResults.push(msg);
          if (msg.type === "economy_profile") window.__epic51Tap.profiles.push(msg);
          if (msg.type === "join_accepted") window.__epic51Tap.joinAccepted.push(msg);
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

async function openLobby(page, nickname) {
  await installWsTap(page);
  await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "load", timeout: 30000 });
  await page.waitForSelector("#mapSelect", { timeout: 15000 });
  await page.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "connected",
    { timeout: 20000 },
  );
  const email = `epic51_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  await registerAndContinue(page, email);
  await page.fill("#nicknameInput", nickname);
  await page.waitForFunction(
    () => {
      const btn = document.getElementById("modeBotsBtn");
      return btn && !btn.disabled;
    },
    { timeout: 20000 },
  );
}

async function joinBotsMatch(page) {
  await page.click("#modeBotsBtn");
  await page.waitForFunction(
    () => document.getElementById("modeSelect")?.classList.contains("hidden"),
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => (window.__epic51Tap?.joinAccepted ?? []).length > 0,
    { timeout: 15000 },
  );
  await sleep(600);
}

async function runConsoleCommand(page, command) {
  const before = await page.evaluate(() => (window.__epic51Tap?.devResults ?? []).length);
  await page.fill("#devConsoleInput", command);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (prev) => (window.__epic51Tap?.devResults ?? []).length > prev,
    before,
    { timeout: 8000 },
  );
  return page.evaluate(() => (window.__epic51Tap?.devResults ?? []).at(-1));
}

async function seedDogPet(nickname) {
  const helper = join(OUT_DIR, "_seed-dog.mjs");
  await writeFile(
    helper,
    `import { EconomyStore } from "../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${JSON.stringify(nickname)};
const now = Date.now();
const scope = "deathmatch";
const dog = await store.grantPetForTests(nick, "dog", 156, now, scope);
const gemArmor = await store.grantGem(nick, "armor", 20, now, undefined, scope);
await store.socketGem(nick, gemArmor.id, dog.id, now, scope);
await store.equipPet(nick, dog.id, 1, now, scope);
await store.close();
console.log(JSON.stringify({ dogId: dog.id }));
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
      resolve();
    });
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const failures = [];
  let stack = null;

  if (MANAGE_STACK) {
    console.log("[epic51-qa] starting dedicated server/client");
    stack = await startStack();
  }

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
    const nickname = nick("E51");

    await openLobby(page, nickname);
    await joinBotsMatch(page);

    // Gameplay sanity: hold pose + movement keys
    await page.evaluate(() => {
      window.__cwQaHoldPose = {
        eye: { x: 0, y: 5.5, z: 18 },
        look: { x: 0, y: 3.2, z: 0 },
      };
    });
    await sleep(300);
    await page.screenshot({ path: join(OUT_DIR, "01-in-match-baseline.png"), fullPage: false });

    // ~ opens dev console in-match
    await page.keyboard.press("Backquote");
    await page.waitForFunction(
      () => document.getElementById("devConsole")?.classList.contains("visible"),
      { timeout: 5000 },
    );
    await page.screenshot({ path: join(OUT_DIR, "02-dev-console-open.png"), fullPage: false });

    // Cheat rejected without IDDQD
    const rejectResult = await runConsoleCommand(page, "get_pet");
    console.log("[epic51-qa] get_pet without unlock:", rejectResult);
    if (!rejectResult?.ok && /IDDQD/i.test(rejectResult?.message || "")) {
      /* ok */
    } else {
      failures.push(`expected get_pet rejection before IDDQD, got ${JSON.stringify(rejectResult)}`);
    }

    const logAfterReject = await page.evaluate(
      () => document.getElementById("devConsoleLog")?.innerText || "",
    );
    if (!/error|IDDQD/i.test(logAfterReject)) {
      failures.push("console log missing IDDQD rejection message");
    }

    // IDDQD unlock
    const unlockResult = await runConsoleCommand(page, "IDDQD");
    console.log("[epic51-qa] IDDQD:", unlockResult);
    if (!unlockResult?.ok || !/unlock/i.test(unlockResult?.message || "")) {
      failures.push(`IDDQD unlock failed: ${JSON.stringify(unlockResult)}`);
    }

    // get_pet after unlock
    const profilesBefore = await page.evaluate(() => (window.__epic51Tap?.profiles ?? []).length);
    const petResult = await runConsoleCommand(page, "get_pet");
    console.log("[epic51-qa] get_pet:", petResult);
    if (!petResult?.ok || !/Granted/i.test(petResult?.message || "")) {
      failures.push(`get_pet after unlock failed: ${JSON.stringify(petResult)}`);
    }
    await page
      .waitForFunction(
        (prev) => (window.__epic51Tap?.profiles ?? []).length > prev,
        profilesBefore,
        { timeout: 10000 },
      )
      .catch(() => failures.push("economy profile not pushed after get_pet"));

    // god_mode toggle
    const godOn = await runConsoleCommand(page, "god_mode");
    console.log("[epic51-qa] god_mode on:", godOn);
    if (!godOn?.ok || !/ON/i.test(godOn?.message || "")) {
      failures.push(`god_mode ON failed: ${JSON.stringify(godOn)}`);
    }
    const godOff = await runConsoleCommand(page, "god_mode");
    console.log("[epic51-qa] god_mode off:", godOff);
    if (!godOff?.ok || !/OFF/i.test(godOff?.message || "")) {
      failures.push(`god_mode OFF failed: ${JSON.stringify(godOff)}`);
    }

    await page.screenshot({ path: join(OUT_DIR, "03-dev-console-cheats-log.png"), fullPage: false });

    // Close console with ~
    await page.keyboard.press("Backquote");
    await page.waitForFunction(
      () => !document.getElementById("devConsole")?.classList.contains("visible"),
      { timeout: 5000 },
    );

    // armorHud pickup subtitle
    const armorHudLabel = await page.evaluate(() => {
      const hud = document.getElementById("armorHud");
      return hud?.innerText?.trim() || "";
    });
    console.log("[epic51-qa] armorHud:", armorHudLabel);
    if (!/pickup/i.test(armorHudLabel)) {
      failures.push(`armorHud missing (pickup) subtitle: ${armorHudLabel}`);
    }
    await page.screenshot({ path: join(OUT_DIR, "04-armor-hud-pickup-label.png"), fullPage: false });

    // Seed dog + open inventory for DR labels
    await seedDogPet(nickname);
    await page.keyboard.press("KeyI");
    await page.waitForFunction(
      () => document.getElementById("inventoryOverlay")?.classList.contains("visible"),
      { timeout: 10000 },
    );
    await sleep(500);

    const railText = await page.evaluate(
      () => (document.getElementById("inventoryRail")?.innerText || "").trim(),
    );
    console.log("[epic51-qa] rail:", railText.replace(/\n/g, " | "));
    if (!/\+\d+\s+DR\s+\(~\d+%\)/.test(railText)) {
      failures.push(`equip rail missing DR grant: ${railText}`);
    }
    if (/\+\d+\s+Armor/.test(railText)) {
      failures.push(`equip rail still shows Armor instead of DR: ${railText}`);
    }

    await page.screenshot({ path: join(OUT_DIR, "05-pet-dr-rail-labels.png"), fullPage: false });

    const dogItem = page.locator(".inv-item").filter({ has: page.locator(".inv-icon-pet-dog") }).first();
    if ((await dogItem.count()) > 0) {
      await dogItem.click({ position: { x: 8, y: 8 } });
      await sleep(400);
    }
    const detailsText = await page.evaluate(
      () => (document.getElementById("inventoryDetails")?.innerText || "").trim(),
    );
    console.log("[epic51-qa] details:", detailsText.replace(/\n/g, " | "));
    if (!/\+\d+\s+DR\s+\(~\d+%\)/.test(detailsText)) {
      failures.push(`detail missing DR grant: ${detailsText}`);
    }
    await page.screenshot({ path: join(OUT_DIR, "06-pet-dr-detail-labels.png"), fullPage: false });

    // Movement keys while console closed
    await page.keyboard.press("Escape");
    await sleep(200);
    await page.keyboard.down("KeyW");
    await sleep(400);
    await page.keyboard.up("KeyW");
    await page.screenshot({ path: join(OUT_DIR, "07-after-movement.png"), fullPage: false });

    if (failures.length > 0) {
      console.error("[epic51-qa] FAILURES:");
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("[epic51-qa] ALL PASS");
    }
  } finally {
    await browser.close();
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
    }
  }
}

main().catch((err) => {
  console.error("[epic51-qa] fatal:", err);
  process.exit(1);
});

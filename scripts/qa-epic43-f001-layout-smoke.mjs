// Brief Playwright smoke for EPIC 43 Critic F-001.
// At 1400×900: after selecting a bag item, detail title + an action control
// must intersect the visible viewport (no scroll past empty full-square grid).
// Also records cell linear size (~2× expected).
//
// Usage:
//   node scripts/qa-epic43-f001-layout-smoke.mjs

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLIENT_ROOT = join(REPO_ROOT, "client");
const OUT_DIR = join(REPO_ROOT, "qa-artifacts", "epic-43");

const SERVER_PORT = 7800;
const CLIENT_PORT = 5220;
const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}/`;
const WS_URL = `ws://127.0.0.1:${SERVER_PORT}`;
const BEFORE_CELL_PX = 56.5;
const CRYPTIC = /\b(STM|PET|AMU|SHD|KIT|EGG|GEM)\b/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nick(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 6)}`.slice(0, 16);
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
    if (!child || child.killed || child.exitCode != null) return resolve();
    const done = () => resolve();
    child.once("exit", done);
    try {
      child.kill("SIGTERM");
    } catch {
      return resolve();
    }
    setTimeout(() => {
      try {
        if (child.exitCode == null) child.kill("SIGKILL");
      } catch {
        /* ignore */
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
      window.__epic43F001 = window.__epic43F001 || { profiles: [] };
      const origSend = ws.send.bind(ws);
      ws.send = (data) => origSend(data);
      ws.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (msg.type === "economy_profile") window.__epic43F001.profiles.push(msg);
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

async function seedDeathmatchBag(nickname) {
  const helper = join(OUT_DIR, "_seed-bag-f001.mjs");
  await writeFile(
    helper,
    `import { EconomyStore } from "../../server/src/economy/index.ts";
const store = await EconomyStore.open({ skipSqliteImport: true });
const nick = ${JSON.stringify(nickname)};
const now = Date.now();
const scope = "deathmatch";
const pet = await store.grantPetForTests(nick, "lion", 80, now, scope);
const stim = await store.grantStimulator(nick, now, scope);
await store.close();
console.log(JSON.stringify({ petId: pet.id, stimId: stim.id }));
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

function visibilityReport() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const grid = document.getElementById("inventoryGrid");
  const details = document.getElementById("inventoryDetails");
  const title = details?.querySelector(".inv-details-title");
  const actionBtn = details?.querySelector(".inv-details-actions button");
  const cell = grid?.querySelector(".inv-cell");
  const gridScroll = document.querySelector(".inv-grid-scroll");
  const side = document.querySelector(".inv-side");

  function inViewport(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0;
  }

  const gridRect = grid?.getBoundingClientRect();
  const cellRect = cell?.getBoundingClientRect();
  const titleRect = title?.getBoundingClientRect();
  const actionRect = actionBtn?.getBoundingClientRect();

  return {
    viewport: { w: vw, h: vh },
    gridWidthPx: gridRect ? Math.round(gridRect.width) : null,
    gridHeightPx: gridRect ? Math.round(gridRect.height) : null,
    gridScrollMaxHeight: gridScroll ? getComputedStyle(gridScroll).maxHeight : null,
    sidePresent: Boolean(side),
    cellWidthPx: cellRect ? Math.round(cellRect.width) : null,
    cellHeightPx: cellRect ? Math.round(cellRect.height) : null,
    detailTitle: title?.textContent?.trim() || "",
    actionLabel: actionBtn?.textContent?.trim() || "",
    titleInViewport: inViewport(title),
    actionInViewport: inViewport(actionBtn),
    titleTop: titleRect ? Math.round(titleRect.top) : null,
    actionTop: actionRect ? Math.round(actionRect.top) : null,
    panelScrollTop: document.getElementById("inventoryPanel")?.scrollTop ?? null,
  };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const nickname = nick("f001");
  const email = `${nickname}@example.com`;
  let stack = null;
  const summary = { ok: false, nickname, failures: [] };

  try {
    stack = await startStack();
    await seedDeathmatchBag(nickname);

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await installWsTap(page);
    await page.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load", timeout: 30000 });

    await page.waitForSelector("#accountEmailInput", { timeout: 15000 });
    await page.waitForFunction(() => {
      const btn = document.getElementById("accountEmailBtn");
      return btn && !btn.disabled;
    }, { timeout: 20000 });
    await page.fill("#accountEmailInput", email);
    await page.click("#accountEmailBtn");
    await page.waitForFunction(() => {
      const codeEl = document.getElementById("accountRevealCode");
      return codeEl && /^\d{3}-\d{3}$/.test(codeEl.textContent || "");
    }, { timeout: 15000 });
    await page.click("#accountContinueBtn");
    await page.waitForFunction(
      () =>
        document.getElementById("accountSignedIn") &&
        !document.getElementById("accountSignedIn").classList.contains("hidden"),
      { timeout: 10000 },
    );

    await page.fill("#nicknameInput", nickname);
    await page.click("#lobbyInventoryBtn");
    await page.waitForFunction(
      () => document.getElementById("inventoryOverlay")?.classList.contains("visible"),
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () => (window.__epic43F001?.profiles ?? []).some((p) => p.economyPool === "deathmatch"),
      { timeout: 15000 },
    );
    await sleep(400);

    // Light regression: icons + no cryptic primary labels + English tooltips.
    const gridSnap = await page.evaluate((crypticSrc) => {
      const CRYPTIC_SRC = new RegExp(crypticSrc);
      const items = [...document.querySelectorAll("#inventoryGrid .inv-item")];
      return {
        itemCount: items.length,
        iconCount: items.filter((el) => el.querySelector(".inv-icon")).length,
        crypticPrimary: items
          .map((el) => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll(".inv-item-meta,.inv-icon").forEach((n) => n.remove());
            return (clone.textContent || "").trim();
          })
          .filter((t) => CRYPTIC_SRC.test(t)),
        tooltips: items.map((el) => el.dataset.tooltip || ""),
      };
    }, CRYPTIC.source);
    summary.regression = gridSnap;
    if (gridSnap.itemCount < 1) summary.failures.push("no bag items after seed");
    if (gridSnap.iconCount < gridSnap.itemCount) {
      summary.failures.push(`missing icons: ${gridSnap.iconCount}/${gridSnap.itemCount}`);
    }
    if (gridSnap.crypticPrimary.length) {
      summary.failures.push(`cryptic primary: ${gridSnap.crypticPrimary.join(" | ")}`);
    }
    if (gridSnap.tooltips.some((t) => !t || CRYPTIC.test(t))) {
      summary.failures.push(`bad tooltips: ${JSON.stringify(gridSnap.tooltips)}`);
    }

    const item = page.locator("#inventoryGrid .inv-item").first();
    await item.hover();
    await sleep(200);
    const hoverTip = await page.evaluate(() => {
      const el = document.querySelector("#inventoryGrid .inv-item");
      return el?.dataset.tooltip || "";
    });
    summary.hoverTooltip = hoverTip;
    if (!hoverTip || CRYPTIC.test(hoverTip)) {
      summary.failures.push(`hover tooltip bad: ${hoverTip}`);
    }
    await page.screenshot({
      path: join(OUT_DIR, "08-f001-hover-tooltip-regression.png"),
      fullPage: false,
    });

    await item.click();
    await sleep(300);

    const report = await page.evaluate(visibilityReport);
    summary.layout = report;
    summary.scaleVsBefore =
      report.cellWidthPx != null ? Number((report.cellWidthPx / BEFORE_CELL_PX).toFixed(2)) : null;

    if (!report.titleInViewport) summary.failures.push("detail title not in viewport");
    if (!report.actionInViewport) summary.failures.push("action button not in viewport");
    if ((report.panelScrollTop ?? 0) !== 0) {
      summary.failures.push(`panelScrollTop not 0: ${report.panelScrollTop}`);
    }
    if (!report.detailTitle || /^(STM|PET|AMU|SHD|KIT|EGG|GEM)\b/.test(report.detailTitle)) {
      summary.failures.push(`bad detail title: ${report.detailTitle}`);
    }
    if (report.cellWidthPx == null || report.cellWidthPx < 100) {
      summary.failures.push(`cell too small: ${report.cellWidthPx}`);
    }
    if (summary.scaleVsBefore != null && summary.scaleVsBefore < 1.7) {
      summary.failures.push(`scale below ~2× preference: ${summary.scaleVsBefore}`);
    }

    await page.screenshot({
      path: join(OUT_DIR, "07-f001-selected-detail-actions-visible.png"),
      fullPage: false,
    });

    summary.ok = summary.failures.length === 0;
    await writeFile(join(OUT_DIR, "f001-layout-smoke.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));

    await browser.close();
    if (!summary.ok) process.exitCode = 1;
  } catch (err) {
    summary.failures.push(String(err));
    await writeFile(join(OUT_DIR, "f001-layout-smoke.json"), JSON.stringify(summary, null, 2));
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (stack) {
      await stop(stack.client);
      await stop(stack.server);
    }
    process.exit(process.exitCode ?? 0);
  }
}

main();

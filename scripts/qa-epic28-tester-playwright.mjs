// Tester Playwright evidence for EPIC 28 Lobby Emerald Lore.
// Captures desktop + narrow lobby screenshots and verifies lore beats + CTA hit-targets.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://127.0.0.1:5175";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-28";

await mkdir(OUT_DIR, { recursive: true });

const REQUIRED_SNIPPETS = [
  "Изумрудная Пустошь",
  "2157",
  "Пэт",
  "золот",
  "яйц",
  "самоцвет",
  "амулет",
  "рейтинг",
];

async function inspectLobby(page) {
  return page.evaluate(() => {
    const lore = document.querySelector("#modeSelect .lobby-lore");
    const box = document.querySelector("#modeSelect .mode-select-box");
    const nick = document.getElementById("nicknameInput");
    const buttons = ["modePublicBtn", "modeBotsBtn", "modeEndlessBtn"].map((id) => {
      const el = document.getElementById(id);
      const r = el?.getBoundingClientRect();
      const cx = r ? r.left + r.width / 2 : 0;
      const cy = r ? r.top + r.height / 2 : 0;
      const top = document.elementFromPoint(cx, cy);
      return {
        id,
        disabled: !!el?.disabled,
        rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom } : null,
        hitTargetId: top?.id || top?.tagName || null,
        hitIsSelf: top === el,
      };
    });
    const nickRect = nick?.getBoundingClientRect();
    const nickCx = nickRect ? nickRect.left + nickRect.width / 2 : 0;
    const nickCy = nickRect ? nickRect.top + nickRect.height / 2 : 0;
    const nickTop = document.elementFromPoint(nickCx, nickCy);
    const loreRect = lore?.getBoundingClientRect();
    const boxRect = box?.getBoundingClientRect();
    const style = lore ? getComputedStyle(lore) : null;
    return {
      lorePresent: !!lore,
      loreText: lore?.innerText ?? "",
      loreAria: lore?.getAttribute("aria-label") ?? null,
      loreMaxHeight: style?.maxHeight ?? null,
      loreOverflowY: style?.overflowY ?? null,
      loreRect: loreRect
        ? { x: loreRect.x, y: loreRect.y, w: loreRect.width, h: loreRect.height }
        : null,
      boxRect: boxRect
        ? { x: boxRect.x, y: boxRect.y, w: boxRect.width, h: boxRect.height }
        : null,
      nicknameHitIsSelf: nickTop === nick,
      nicknameHitId: nickTop?.id || nickTop?.tagName || null,
      buttons,
      modeSelectHidden: document.getElementById("modeSelect")?.classList.contains("hidden") ?? true,
    };
  });
}

function assertLobby(data, label) {
  const failures = [];
  if (!data.lorePresent) failures.push(`${label}: lore section missing`);
  if (data.modeSelectHidden) failures.push(`${label}: modeSelect hidden`);
  for (const snip of REQUIRED_SNIPPETS) {
    if (!data.loreText.includes(snip)) failures.push(`${label}: missing lore snippet "${snip}"`);
  }
  if (!data.nicknameHitIsSelf) {
    failures.push(`${label}: nickname input covered (hit=${data.nicknameHitId})`);
  }
  for (const b of data.buttons) {
    if (!b.rect || b.rect.w < 8 || b.rect.h < 8) {
      failures.push(`${label}: ${b.id} not visibly sized`);
    }
    if (!b.hitIsSelf) {
      failures.push(`${label}: ${b.id} covered (hit=${b.hitTargetId})`);
    }
  }
  // Lore should not fully cover the join card center.
  if (data.loreRect && data.boxRect) {
    const loreCenterY = data.loreRect.y + data.loreRect.h / 2;
    const boxCenterY = data.boxRect.y + data.boxRect.h / 2;
    // On desktop, lore should sit left of card; on narrow, above.
    // Either way, buttons must remain hittable (already checked).
    if (data.boxRect.w < 100 || data.boxRect.h < 100) {
      failures.push(`${label}: mode-select-box too small`);
    }
    void loreCenterY;
    void boxCenterY;
  }
  return failures;
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
  const errors = [];

  // Desktop
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  desktop.on("console", (m) => {
    if (m.type() === "error") errors.push(`desktop: ${m.text()}`);
  });
  desktop.on("pageerror", (e) => errors.push(`desktop pageerror: ${e.message}`));

  console.log(`[epic28-qa] navigating desktop ${CLIENT_URL}`);
  await desktop.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await desktop.waitForSelector("#modeSelect .lobby-lore", { timeout: 10000 });
  await desktop.waitForTimeout(400);
  const desktopData = await inspectLobby(desktop);
  await desktop.screenshot({ path: `${OUT_DIR}/01-lobby-desktop-1280.png`, fullPage: false });
  console.log("[epic28-qa] desktop lore preview:", desktopData.loreText.slice(0, 120).replace(/\n/g, " "));
  console.log("[epic28-qa] desktop layout:", JSON.stringify({
    loreRect: desktopData.loreRect,
    boxRect: desktopData.boxRect,
    buttons: desktopData.buttons.map((b) => ({ id: b.id, hitIsSelf: b.hitIsSelf })),
  }));

  // Interact: type nickname (proves CTA usable)
  await desktop.fill("#nicknameInput", "QaLore");
  const nickValue = await desktop.inputValue("#nicknameInput");

  // Narrow
  const narrow = await browser.newPage({ viewport: { width: 375, height: 812 } });
  narrow.on("console", (m) => {
    if (m.type() === "error") errors.push(`narrow: ${m.text()}`);
  });
  narrow.on("pageerror", (e) => errors.push(`narrow pageerror: ${e.message}`));
  await narrow.goto(CLIENT_URL, { waitUntil: "load", timeout: 30000 });
  await narrow.waitForSelector("#modeSelect .lobby-lore", { timeout: 10000 });
  await narrow.waitForTimeout(400);
  const narrowData = await inspectLobby(narrow);
  await narrow.screenshot({ path: `${OUT_DIR}/02-lobby-narrow-375.png`, fullPage: false });
  // Scroll lore block a bit to show it's scrollable, then re-check CTAs
  await narrow.evaluate(() => {
    const lore = document.querySelector("#modeSelect .lobby-lore");
    if (lore) lore.scrollTop = 80;
  });
  await narrow.waitForTimeout(200);
  await narrow.screenshot({ path: `${OUT_DIR}/03-lobby-narrow-375-lore-scrolled.png`, fullPage: false });
  const narrowAfterScroll = await inspectLobby(narrow);
  console.log("[epic28-qa] narrow lore maxHeight/overflow:", narrowData.loreMaxHeight, narrowData.loreOverflowY);

  const failures = [
    ...assertLobby(desktopData, "desktop"),
    ...assertLobby(narrowData, "narrow"),
    ...assertLobby(narrowAfterScroll, "narrow-after-scroll"),
  ];
  if (nickValue !== "QaLore") failures.push(`desktop: nickname fill failed (got=${nickValue})`);

  // Desktop split: lore should be left of card (x smaller) when both visible side-by-side
  if (desktopData.loreRect && desktopData.boxRect) {
    if (!(desktopData.loreRect.x + desktopData.loreRect.w <= desktopData.boxRect.x + 40)) {
      // Allow slight overlap of flex gap; require lore mostly to the left
      if (desktopData.loreRect.x >= desktopData.boxRect.x) {
        failures.push("desktop: expected lore column to the left of join card");
      }
    }
  }
  // Narrow: lore above card
  if (narrowData.loreRect && narrowData.boxRect) {
    if (!(narrowData.loreRect.y + narrowData.loreRect.h <= narrowData.boxRect.y + 8)) {
      failures.push("narrow: expected lore above join card");
    }
  }

  console.log("\n=== EPIC 28 CHECKS ===");
  if (failures.length === 0) {
    console.log("ALL PASS");
  } else {
    for (const f of failures) console.log("FAIL:", f);
  }
  if (errors.length) {
    console.log("\nConsole errors:");
    for (const e of errors) console.log(" -", e);
  } else {
    console.log("No console errors on lobby path.");
  }

  await browser.close();
  if (failures.length) process.exit(1);
}

await main();

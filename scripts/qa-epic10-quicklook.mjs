// Quick standalone visual iteration helper (Programmer self-check only, not
// a real QA artifact) — loads the client, joins bots mode (fastest path to
// a playable state, no puppets needed), locks pointer, and screenshots the
// idle + firing pistol viewmodel so positioning tweaks can be checked fast
// without running the full multi-minute navigation script.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";
const OUT_DIR = process.argv[3] ?? "qa-artifacts/epic-10-quicklook";

await mkdir(OUT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (err) => console.log("PAGEERROR:", err.message));

  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", {
    timeout: 8000,
  });
  await page.waitForFunction(() => !document.getElementById("modeBotsBtn")?.disabled, { timeout: 5000 });
  await page.click("#modeBotsBtn");
  await page.waitForTimeout(500);

  const box = await page.locator("#app canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(500);
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  console.log("locked:", locked);

  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT_DIR}/pistol-idle.png` });

  await page.mouse.down();
  await page.mouse.up();
  await page.screenshot({ path: `${OUT_DIR}/pistol-fire.png` });
  await page.waitForTimeout(400);

  await browser.close();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// QA evidence capture for player-facing changes (ai-office/checklists/qa-checklist.md
// § Gameplay & feel). Launches the client in headless Chromium, waits for the
// WebSocket connection to the game server to complete, captures a screenshot
// before and after a mouse-drag camera orbit, and reports console errors.
//
// Usage: node scripts/qa-screenshot.mjs <client-url> <output-dir>

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const clientUrl = process.argv[2] ?? "http://localhost:5174";
const outDir = process.argv[3] ?? "qa-artifacts/epic-01";

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

console.log(`[qa] navigating to ${clientUrl}`);
await page.goto(clientUrl, { waitUntil: "load" });

// Let the render loop and WS handshake settle.
await page.waitForTimeout(1500);

let connectionState = "unknown";
try {
  await page.waitForFunction(
    () => document.getElementById("status")?.dataset.state === "connected",
    { timeout: 5000 },
  );
  connectionState = "connected";
} catch {
  connectionState = await page.evaluate(
    () => document.getElementById("status")?.dataset.state ?? "missing",
  );
}

const statusText = await page.evaluate(
  () => document.getElementById("status")?.textContent ?? "",
);

await page.screenshot({ path: `${outDir}/01-initial.png` });
console.log(`[qa] captured 01-initial.png — status: "${statusText}" (state=${connectionState})`);

// Prove mouse-look/orbit control works: drag from center and re-screenshot.
const box = await page.locator("#app canvas").boundingBox();
if (box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 250, cy - 100, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}
await page.screenshot({ path: `${outDir}/02-after-camera-drag.png` });
console.log(`[qa] captured 02-after-camera-drag.png`);

await browser.close();

console.log(`[qa] connection state: ${connectionState}`);
console.log(`[qa] status text: ${statusText}`);
console.log(`[qa] console errors: ${consoleErrors.length}`);
for (const e of consoleErrors) console.log(`[qa]   - ${e}`);

if (connectionState !== "connected") {
  console.error("[qa] FAIL: client never reached connected state");
  process.exit(1);
}
if (consoleErrors.length > 0) {
  console.error("[qa] FAIL: console errors present");
  process.exit(1);
}
console.log("[qa] PASS");

import { chromium } from "playwright";

const CLIENT_URL = process.argv[2] ?? "http://localhost:5174";

async function main() {
  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist", "--no-proxy-server", "--proxy-bypass-list=*"],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await page.goto(CLIENT_URL, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("status")?.dataset.state === "connected", { timeout: 5000 });
  await page.waitForFunction(() => !document.getElementById("modePublicBtn")?.disabled, { timeout: 5000 });
  await page.click("#modePublicBtn");
  await page.waitForTimeout(500);
  const status = await page.evaluate(() => document.getElementById("status")?.textContent ?? "");
  const hud = await page.evaluate(() => ({
    health: document.getElementById("healthHud")?.textContent,
    armor: document.getElementById("armorHud")?.textContent,
    weapon: document.getElementById("weaponHud")?.textContent,
  }));
  console.log("public mode status:", status);
  console.log("public mode HUD:", hud);
  console.log("console errors:", consoleErrors.length, consoleErrors);
  await browser.close();
  process.exit(consoleErrors.length > 0 ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});

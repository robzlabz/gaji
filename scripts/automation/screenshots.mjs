// Screenshot halaman Gaji (desktop 1366px + mobile 390px) setelah login akun demo seed.
// Pakai: node scripts/automation/screenshots.mjs <outDir> <admin|employee> <path...>
// Playwright dipasang oleh setup-env.sh di luar repo; set NODE_PATH ke node_modules-nya.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(path.join(process.env.NODE_PATH || "/tmp/gaji-automation/node_modules", "_"));
const { chromium } = require("playwright");
import fs from "node:fs";
const [outDir, role, ...paths] = process.argv.slice(2);
const BASE = process.env.BASE_URL || "http://localhost:3000";
const ACC = { admin: ["08111111111", "111111"], employee: ["08333333333", "333333"] }[role];
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
for (const [vp, size] of [["desktop", { width: 1366, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="tel"], input[name="phone"]').first().fill(ACC[0]);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/login\/pin/, { timeout: 60000 });
  await page.locator("input").first().click();
  await page.keyboard.type(ACC[1], { delay: 50 });
  const btn = page.locator('button[type="submit"]');
  if (await btn.isEnabled()) await btn.click().catch(() => {});
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
  for (const p of paths) {
    await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(800);
    const name = (p.replace(/^\//, "").replace(/[\/\[\]?=&]/g, "_") || "root") + `-${vp}.png`;
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: true });
    console.log("saved", `${outDir}/${name}`);
  }
  await ctx.close();
}
await browser.close();

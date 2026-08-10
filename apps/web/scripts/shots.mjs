/**
 * Screenshots the dashboard at desktop and phone widths.
 *
 * Curl cannot see a wrapped amount, a tree that reads as jitter, or a control that
 * traps keyboard focus. Every UI defect found in this project so far was invisible
 * to the API and obvious in an image.
 *
 * Run with both servers up:
 *   cd apps/server && bun run dev
 *   cd apps/web && bun run dev
 *   node apps/web/scripts/shots.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.PARAGON_URL ?? "http://localhost:5173";
const OUT = process.env.PARAGON_SHOTS ?? ".";

const browser = await chromium.launch();
const shots = [
  { name: "dashboard-desktop", width: 1280, height: 1400, nav: null },
  { name: "dashboard-phone", width: 390, height: 1600, nav: null },
  { name: "settings", width: 1280, height: 1000, nav: "Настройки" },
];

for (const shot of shots) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  if (shot.nav) {
    await page.getByRole("button", { name: shot.nav }).click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${shot.name}.png`, fullPage: true });
  console.log("shot:", shot.name);
}

await browser.close();

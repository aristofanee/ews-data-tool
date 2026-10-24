// Visual smoke test: drives the browser demo with Playwright + Edge and saves
// screenshots of every plot type in light and dark mode.
//
//   node tools/shoot.mjs
//
// Requires `npm run dev` to be running on http://127.0.0.1:1420.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const OUT = "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1560, height: 980 },
  deviceScaleFactor: 1,
});

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`page: ${e.message}`));

await page.goto("http://127.0.0.1:1420", { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/00-empty.png` });

await page.getByText("Load demo data").click();
await page.waitForSelector(".js-plotly-plot", { timeout: 30000 });
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/01-box-light.png` });

const tab = async (name) => {
  await page.locator(".tab", { hasText: name }).first().click();
  await page.waitForTimeout(1200);
};

await tab("Wafer map");
await page.waitForSelector("canvas.map-canvas");
await page.waitForTimeout(500);
const box = await page.locator("canvas.map-canvas").boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.47);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: `${OUT}/02-map-light.png` });

await tab("Pareto");
await page.waitForSelector(".js-plotly-plot");
await page.screenshot({ path: `${OUT}/03-pareto-light.png` });

await tab("Histogram");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-hist-light.png` });

await tab("Trend");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-trend-light.png` });

await tab("Box plot");
await page.locator(".topbar-actions button[title='Dark mode']").click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/06-box-dark.png` });

await tab("Wafer map");
await page.waitForTimeout(700);
const box2 = await page.locator("canvas.map-canvas").boundingBox();
if (box2) {
  await page.mouse.move(box2.x + box2.width * 0.42, box2.y + box2.height * 0.47);
  await page.waitForTimeout(300);
}
await page.screenshot({ path: `${OUT}/07-map-dark.png` });

await page.locator(".topbar-actions button[title='Open the report builder']").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/08-report-drawer.png` });

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();

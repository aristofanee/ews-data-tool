import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

import { repoPath } from "./harness-paths.mjs";
const shotDir = repoPath("shots", "debug-ui");
mkdirSync(shotDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack || e.message}`));
await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Load demo data" }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: `${shotDir}\\01-box.png`, fullPage: false });
const summary = await page.evaluate(() => ({
  tabs: [...document.querySelectorAll(".tab")].map((b) => b.textContent?.trim()),
  selects: [...document.querySelectorAll("select")].map((s) => ({
    label: s.closest(".row")?.querySelector("label")?.textContent?.trim(),
    value: s.value,
    options: [...s.options].map((o) => `${o.value}:${o.textContent?.trim()}`),
  })),
  stats: [...document.querySelectorAll(".stat")].map((s) => s.textContent?.trim()),
  facets: document.querySelectorAll(".facet-card").length,
  placeholder: document.querySelector(".chart-placeholder")?.textContent?.trim() ?? null,
  error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
  plotly: document.querySelectorAll(".plotly-host .plot-container").length,
}));
console.log(JSON.stringify({ summary, errors }, null, 2));
await browser.close();

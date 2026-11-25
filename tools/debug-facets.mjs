import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { repoPath } from "./harness-paths.mjs";
const shotDir = repoPath("shots", "debug-ui");
mkdirSync(shotDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => page.waitForTimeout(ms);
const result = {};
const testType = async (tabName, shotName) => {
  await page.locator(".tab", { hasText: tabName }).click();
  await sleep(700);
  await page.locator(".field", { hasText: "Group by" }).locator("select").selectOption("lot");
  await sleep(800);
  const check = page.locator(".check-row", { hasText: "Split into different plots" }).locator("input");
  if (!(await check.isChecked())) await check.setChecked(true);
  await sleep(1200);
  const preview = await page.evaluate(() => {
    const host = document.querySelector(".facet-card .js-plotly-plot");
    return {
      facets: document.querySelectorAll(".facet-card").length,
      overlays: document.querySelectorAll(".facet-open").length,
      height: host?.getBoundingClientRect().height ?? 0,
      staticPlot: host?._context?.staticPlot ?? null,
      modebar: document.querySelectorAll(".facet-card .modebar").length,
      pointerEvents: host ? getComputedStyle(host.parentElement).pointerEvents : null,
      error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    };
  });
  await page.screenshot({ path: `${shotDir}\\${shotName}-preview.png` });
  await page.locator(".facet-open").first().click();
  await sleep(700);
  const detail = await page.evaluate(() => {
    const host = document.querySelector(".facet-detail-body .js-plotly-plot");
    return {
      title: document.querySelector(".facet-detail-title")?.textContent?.trim() ?? null,
      height: host?.getBoundingClientRect().height ?? 0,
      traces: host?.data?.length ?? 0,
      staticPlot: host?._context?.staticPlot ?? null,
      error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    };
  });
  await page.screenshot({ path: `${shotDir}\\${shotName}-detail.png` });
  await page.getByRole("button", { name: "All plots" }).click();
  await sleep(500);
  return { preview, detail };
};
try {
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Load demo data" }).click();
  await sleep(2000);
  result.box = await testType("Box plot", "14-box");
  result.hist = await testType("Histogram", "15-hist");
  console.log(JSON.stringify({ result, errors }, null, 2));
} finally {
  await browser.close();
}

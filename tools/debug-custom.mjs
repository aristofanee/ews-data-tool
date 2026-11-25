import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

import { repoPath } from "./harness-paths.mjs";
const shotDir = repoPath("shots", "debug-ui");
mkdirSync(shotDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack || e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) errors.push(`console: ${m.text()}`);
});
const sleep = (ms) => page.waitForTimeout(ms);
try {
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Load demo data" }).click();
  await sleep(2000);

  // Create a two-value custom split column.
  await page.getByRole("button", { name: "+ Add column" }).click();
  await page.locator(".modal-field").filter({ hasText: "Column name" }).locator("input").fill("Split");
  await page.locator(".column-tools").getByRole("button", { name: "All", exact: true }).click();
  await page.locator('.modal-field input[list="custom-label-options"]').fill("A");
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await page.locator(".column-tools").getByRole("button", { name: "None", exact: true }).click();
  const checks = page.locator(".column-wafer-list .wafer-check");
  for (let i = 0; i < 25; i++) await checks.nth(i).click();
  await page.locator('.modal-field input[list="custom-label-options"]').fill("B");
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await page.getByRole("button", { name: "Create column", exact: true }).click();
  await sleep(1200);
  const customInfo = await page.evaluate(() => ({
    columns: [...document.querySelectorAll(".custom-column-name")].map((e) => e.textContent?.trim()),
    error: document.querySelector(".toast")?.textContent?.trim() ?? null,
  }));

  // Box split by the custom column: this used to hit the stack-unsafe mock path.
  await page.locator(".tab", { hasText: "Box plot" }).click();
  await sleep(700);
  await page.locator(".field", { hasText: "Group by" }).locator("select").selectOption("Split");
  await sleep(900);
  await page.locator(".check-row", { hasText: "Split into different plots" }).locator("input").setChecked(true);
  await sleep(1200);
  const boxCustom = await page.evaluate(() => ({
    facets: document.querySelectorAll(".facet-card").length,
    error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    labels: [...document.querySelectorAll(".facet-label")].map((e) => e.textContent?.trim()),
  }));
  await page.screenshot({ path: `${shotDir}\\11-box-custom-split.png` });

  // Pareto with custom X axis and custom Group by simultaneously.
  await page.locator(".tab", { hasText: "Pareto" }).click();
  await sleep(700);
  await page.locator(".field", { hasText: "X axis" }).locator("select").selectOption("Split");
  await page.locator(".field", { hasText: "Group by" }).locator("select").selectOption("Split");
  await sleep(1800);
  const paretoCustom = await page.evaluate(() => ({
    facets: document.querySelectorAll(".facet-card").length,
    labels: [...document.querySelectorAll(".facet-label")].map((e) => e.textContent?.trim()),
    error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
  }));
  await page.screenshot({ path: `${shotDir}\\12-pareto-custom-split.png` });
  const firstFacet = page.locator(".facet-open").first();
  if (await firstFacet.count()) {
    await firstFacet.click();
    await sleep(700);
  }
  const paretoCustomDetail = await page.evaluate(() => {
    const host = document.querySelector(".facet-detail-body .js-plotly-plot");
    return {
      height: host?.getBoundingClientRect().height ?? 0,
      traces: host?.data?.length ?? 0,
      error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    };
  });
  await page.screenshot({ path: `${shotDir}\\13-pareto-custom-detail.png` });

  console.log(JSON.stringify({ customInfo, boxCustom, paretoCustom, paretoCustomDetail, errors }, null, 2));
} finally {
  await browser.close();
}

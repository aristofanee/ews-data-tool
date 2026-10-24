// Functional smoke test for the browser demo: JPG save, report builder,
// template save, and map bin mode. Requires `npm run dev`.
import { chromium } from "playwright-core";
import { statSync } from "node:fs";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({
  viewport: { width: 1560, height: 980 },
  acceptDownloads: true,
});

const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`page: ${e.message}`));

const out = {};
await page.goto("http://127.0.0.1:1420", { waitUntil: "networkidle" });
await page.getByText("Load demo data").click();
await page.waitForSelector(".js-plotly-plot");
await page.waitForTimeout(4500);

// Save the box plot as JPG (browser demo -> download).
{
  const dl = page.waitForEvent("download");
  await page.locator('button[title="Save as JPG"]').click();
  const d = await dl;
  const path = "shots/test-plot.jpg";
  await d.saveAs(path);
  out.jpg = { name: d.suggestedFilename(), bytes: statSync(path).size };
}

// "Add to report" also opens the report drawer.
await page.locator('button[title="Add this plot to the report"]').click();
await page.waitForTimeout(400);
out.drawer = {
  items: await page.locator(".report-item").count(),
  sub: await page.locator(".drawer-sub").innerText(),
};

// Add the current plot again from the drawer.
await page.getByText("Add current plot").click();
out.reportAfterAdd = await page.locator(".report-item").count();

// Close the drawer, switch to the map, then reopen the report builder.
await page.locator('.drawer-head button[title="Close"]').click();
await page.waitForTimeout(250);
await page.locator(".tab", { hasText: "Wafer map" }).click();
await page.waitForTimeout(900);
await page.locator('button[title="Open the report builder"]').click();
await page.waitForTimeout(300);

// Batch-add all selected wafers (accept the confirm).
page.once("dialog", (d) => d.accept());
await page.getByText("All selected wafers").click();
await page.waitForTimeout(600);
out.reportAfterWafers = await page.locator(".report-item").count();
await page.screenshot({ path: "shots/09-report-items.png" });

// Generate in browser mode should explain that batch export needs the desktop app.
await page.getByRole("button", { name: /Generate/ }).click();
await page.waitForTimeout(400);
out.toast = await page.locator(".toast").innerText().catch(() => null);

// Close the drawer and switch the map to bin colouring.
await page.locator('.drawer-head button[title="Close"]').click();
await page.waitForTimeout(250);
await page.getByRole("button", { name: "Bin", exact: true }).click();
await page.waitForTimeout(900);
await page.screenshot({ path: "shots/10-map-bin.png" });

// Save the report/template JSON.
{
  const dl = page.waitForEvent("download");
  await page.locator('button[title="Save template (all report plots + settings)"]').click();
  const d = await dl;
  const path = "shots/test-template.json";
  await d.saveAs(path);
  out.template = { name: d.suggestedFilename(), bytes: statSync(path).size };
}

out.errors = errors;
console.log(JSON.stringify(out, null, 2));
await browser.close();

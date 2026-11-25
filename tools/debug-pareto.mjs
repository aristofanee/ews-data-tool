import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Load demo data" }).click();
await page.waitForTimeout(2000);
await page.locator(".tab", { hasText: "Pareto" }).click();
await page.waitForTimeout(700);
await page.locator(".field", { hasText: "X axis" }).locator("select").selectOption("hbin");
await page.waitForTimeout(1200);
const out = await page.evaluate(() => {
  const el = document.querySelector(".chart-body .js-plotly-plot");
  return {
    x: el.data[0].x,
    series: el.data.map((t) => ({ name: t.name, y: t.y, yaxis: t.yaxis, counts: t.customdata })),
    groups: el.layout.annotations,
    y2: el.layout.yaxis2,
    stats: [...document.querySelectorAll(".stat")].map((s) => s.textContent?.trim()),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

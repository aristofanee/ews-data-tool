import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1536, height: 864 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1420/");
  await page.locator("#demo-font-size").waitFor();
  await page.getByText("Load demo data").click();
  await page.waitForSelector(".boxlayer path.box");
  const setSlider = async (value) => {
    await page.locator("#demo-font-size").fill(String(value));
    await page.waitForFunction((v) => document.querySelector(".js-plotly-plot")?._fullLayout.yaxis.tickfont.size === 18 + v, value);
  };
  await setSlider(6);
  const larger = await page.evaluate(() => ({
    ticks: document.querySelector(".js-plotly-plot")._fullLayout.yaxis.tickfont.size,
    title: getComputedStyle(document.querySelector(".chart-title")).fontSize,
    statistic: getComputedStyle(document.querySelector(".stat-v")).fontSize,
    slide: document.querySelector(".global-presentation input").checked,
  }));
  assert.equal(larger.ticks, 24); assert.equal(larger.title, "18.5px"); assert.equal(larger.statistic, "14.5px"); assert.equal(larger.slide, false);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".js-plotly-plot")?._fullLayout.yaxis.tickfont.size === 18);
  for (const type of ["box", "hist", "trend", "pareto"]) {
    await page.evaluate(async (type) => (await import("/src/store.ts")).useStore.getState().setPlotType(type), type);
    await page.waitForTimeout(300);
    const ticks = await page.evaluate(() => {
      const layout = document.querySelector(".js-plotly-plot")._fullLayout;
      return [layout.xaxis.tickfont.size, layout.yaxis.tickfont.size];
    });
    assert.deepEqual(ticks, [18, 18], `${type} axis text should match`);
  }
  await page.locator(".tab").filter({ hasText: "Wafer map" }).click();
  await page.waitForSelector(".map-canvas");
  await page.waitForTimeout(300);
  const before = await page.locator(".map-canvas").evaluate((c) => c.toDataURL());
  await page.locator("#demo-font-size").fill("6");
  await page.waitForTimeout(300);
  const after = await page.locator(".map-canvas").evaluate((c) => c.toDataURL());
  assert.notEqual(before, after);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ larger, reset: true, mapRedrawn: before !== after, errors }));
} finally { await browser.close(); }

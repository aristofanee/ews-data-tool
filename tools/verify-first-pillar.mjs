// Run against `npm run dev`. Checks the exact-statistics Plotly path and
// manual-limit capability/yield consistency without external data fixtures.
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const startServer = process.argv.includes("--start-server");
const url = startServer ? "http://127.0.0.1:1421" : "http://127.0.0.1:1420";
const server = startServer ? spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1421"], { stdio: "ignore", windowsHide: true }) : null;
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1560, height: 980 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByText("Load demo data").click();
  await page.waitForSelector(".js-plotly-plot .boxlayer path.box");
  const box = await page.evaluate(() => {
    const g = document.querySelector(".js-plotly-plot");
    const trace = g.data.find((t) => t.type === "box");
    return { boxes: g.querySelectorAll(".boxlayer path.box").length,
      median: trace.median[0], calculatedMedian: g.calcdata[0][0].med };
  });
  assert.ok(box.boxes > 0);
  assert.equal(box.median, box.calculatedMedian);
  const result = await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    const api = await import("/src/lib/api.ts");
    const state = useStore.getState();
    const data = await api.boxPlot({ test: state.spec.test, xAxis: "wafer", filter: state.filters });
    const spec = data.summary;
    // These symmetric limits must yield Cp == Cpk == 2 in the UI.
    useStore.getState().patchSpec({ lsl: spec.mean - 6 * spec.sd, usl: spec.mean + 6 * spec.sd });
    return { expectedCp: 2 };
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".stat")].some(
    (s) => s.querySelector(".stat-k")?.textContent === "Cp" && s.querySelector(".stat-v")?.textContent === "2.00"));
  await page.locator(".tab").filter({ hasText: "Wafer map" }).click();
  await page.waitForFunction(() => document.body.textContent.includes("Test yield (LSL/USL)"));
  const mapStats = await page.locator(".stats").innerText();
  assert.match(mapStats, /Wafer yield \(HBIN 1\)/i);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ box, capability: result, mapStats, errors }, null, 2));
} finally {
  await browser?.close();
  server?.kill();
}

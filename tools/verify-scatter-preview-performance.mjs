import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1421"], { stdio: "ignore", windowsHide: true });
let browser, page;
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch("http://127.0.0.1:1421")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  page = await browser.newPage({ viewport: { width: 1920, height: 1100 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1421");
  assert.equal(await page.getByText("Open a file to begin", { exact: true }).count(), process.env.BASELINE ? 1 : 0);
  await page.getByText("Load demo data").click();
  await page.waitForSelector(".boxlayer path.box");
  const raster = await page.evaluate(async () => {
    const { rasterScatterPreview } = await import("/src/charts/scatterPreview.ts");
    const figure = { layout: { margin: { l: 0, r: 0, t: 0, b: 0 }, xaxis: { range: [0, 100] }, yaxis: { type: "log", range: [0, 2] } }, data: [
      { x: [0, 50, 100, 75], y: [1, 10, 100, -1], marker: { size: 4, opacity: 1, color: [0, 0.5, 1, 0.5], cmin: 0, cmax: 1, colorscale: [[0, "#2563eb"], [0.5, "#8b5cf6"], [1, "#f5b301"]] } },
      { x: [25], y: [10], marker: { size: 4, opacity: 1, color: "#64748b" } },
    ] };
    const result = rasterScatterPreview(figure, 100, 100);
    const bitmap = new Image(); bitmap.src = result.layout.images[0].source;
    await bitmap.decode();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 200;
    const ctx = canvas.getContext("2d"); ctx.drawImage(bitmap, 0, 0);
    return { center: [...ctx.getImageData(100, 100, 1, 1).data], missing: [...ctx.getImageData(50, 100, 1, 1).data],
      negative: [...ctx.getImageData(150, 100, 1, 1).data], originalPoints: figure.data[0].x.length,
      originalImages: figure.layout.images ?? null, xRange: result.layout.xaxis.range, yRange: result.layout.yaxis.range };
  });
  assert.deepEqual(raster.center, [139, 92, 246, 255]);
  assert.deepEqual(raster.missing, [100, 116, 139, 255]);
  assert.deepEqual(raster.negative, [0, 0, 0, 0]);
  assert.equal(raster.originalPoints, 4); assert.equal(raster.originalImages, null);
  assert.deepEqual(raster.xRange, [0, 100]); assert.deepEqual(raster.yRange, [0, 2]);
  await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").find((r) => r.name.includes("/deps/plotly__js-dist-min.js?"))?.name;
    const Plotly = (await import(url)).default;
    const react = Plotly.react;
    window.previewRuns = [];
    Plotly.react = function(el, ...args) {
      const start = performance.now();
      return react.call(this, el, ...args).then((result) => {
        if (el.closest(".facet-card")) window.previewRuns.push({ ms: performance.now() - start, image: el._fullLayout.images?.length ?? 0 });
        return result;
      });
    };
  });
  const results = [];
  for (const groupBy of ["site", "lot"]) {
    await page.evaluate(async (groupBy) => {
      const { useStore } = await import("/src/store.ts");
      useStore.getState().setPlotType("scatter");
      useStore.getState().patchSpec({ scatterX: 0, scatterY: 1, groupBy, splitPlots: false });
    }, groupBy);
    await page.waitForTimeout(600);
    const start = Date.now();
    await page.evaluate(async () => {
      window.previewRuns = [];
      (await import("/src/store.ts")).useStore.getState().patchSpec({ splitPlots: true });
    });
    const count = groupBy === "site" ? 4 : 2;
    await page.waitForFunction((n) => window.previewRuns.length >= n, count);
    const result = await page.evaluate(() => ({ renders: window.previewRuns,
      svgPoints: document.querySelectorAll(".facet-card .point").length,
      axes: [...document.querySelectorAll(".facet-card .js-plotly-plot")].every((g) => g._fullLayout.xaxis.title.text && g._fullLayout.yaxis.title.text) }));
    results.push({ groupBy, elapsedMs: Date.now() - start, ...result });
    assert.ok(result.axes);
    if (!process.env.BASELINE) {
      assert.equal(result.svgPoints, 0);
      assert.ok(result.renders.every((r) => r.image === 1));
    }
  }
  // Continuous-Z colours and logarithmic previews use the same fast path.
  await page.evaluate(async () => {
    (await import("/src/store.ts")).useStore.getState().patchSpec({ scatterZMode: "continuous", scatterZTest: 2, logY: true });
  });
  await page.waitForFunction(() => [...document.querySelectorAll(".facet-card .js-plotly-plot")].every((g) => g._fullLayout?.yaxis.type === "log" && g._fullLayout.images?.length === 1));
  await page.screenshot({ path: process.env.BASELINE ? "shots/scatter-preview-before.png" : "shots/scatter-preview-after.png" });
  // Enlarging must retain the original point data and hover metadata.
  await page.locator(".facet-card.preview").first().click();
  await page.waitForFunction(() => document.querySelector(".facet-detail .js-plotly-plot")?.data?.[0]?.customdata?.length > 1000);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ raster, results, errors }, null, 2));
} finally { await browser?.close(); server.kill(); }

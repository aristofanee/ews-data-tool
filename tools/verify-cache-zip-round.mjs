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
  await page.getByText("Load demo data").click();
  await page.waitForSelector(".boxlayer path.box");
  const cache = await page.evaluate(async () => {
    const api = await import("/src/lib/api.ts");
    const { useStore } = await import("/src/store.ts");
    const { cachedPlot, invalidateMaps } = await import("/src/lib/mapCache.ts");
    const filter = useStore.getState().filters;
    const requests = [
      () => api.boxPlot({ test: 0, xAxis: "site", filter }),
      () => api.histogram({ test: 0, filter }),
      () => api.pareto({ category: "hard", filter }),
      () => api.trend({ test: 0, by: "wafer", filter }),
      () => api.scatter({ xTest: 1, yTest: 0, zMode: "none", filter }),
    ];
    const same = [];
    for (const request of requests) same.push(await request() === await request());
    let calls = 0;
    const load = () => new Promise((resolve) => setTimeout(() => resolve({ n: ++calls }), 10));
    const [a, b] = await Promise.all([
      cachedPlot("dedup", { a: 1, b: 2 }, load, () => 1024),
      cachedPlot("dedup", { b: 2, a: 1 }, load, () => 1024),
    ]);
    let retries = 0;
    const retry = () => cachedPlot("retry", {}, async () => { if (++retries === 1) throw Error("expected"); return 7; }, () => 1);
    await retry().catch(() => {});
    const retried = await retry();
    const before = await requests[0]();
    let finish;
    const stale = cachedPlot("stale", {}, () => new Promise((resolve) => { finish = resolve; }), () => 1);
    invalidateMaps(); finish(1); await stale;
    const fresh = await cachedPlot("stale", {}, async () => 2, () => 1);
    return { same, dedup: a === b && calls === 1, retried, fresh, invalidated: before !== await requests[0]() };
  });
  assert.ok(cache.same.every(Boolean)); assert.ok(cache.dedup && cache.invalidated);
  assert.equal(cache.retried, 7); assert.equal(cache.fresh, 2);

  const set = async (type, patch = {}) => {
    await page.evaluate(async ({ type, patch }) => {
      const { useStore } = await import("/src/store.ts");
      useStore.getState().setPlotType(type);
      useStore.getState().patchSpec(patch);
    }, { type, patch });
  };
  const graphReady = async () => {
    await page.waitForFunction(() => {
      const g = document.querySelector(".chart-body .js-plotly-plot, .facet-detail .js-plotly-plot");
      return g?._fullLayout && g.data?.length;
    });
    await page.waitForTimeout(180);
  };
  // Main plot viewport and hidden trace survive tab changes.
  await set("box", { test: 0, xAxis: "site", groupBy: "none", splitPlots: false });
  await graphReady();
  const original = await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").find((r) => r.name.includes("/deps/plotly__js-dist-min.js?"))?.name;
    const Plotly = (await import(url)).default;
    const g = document.querySelector(".chart-body .js-plotly-plot");
    const range = [...g._fullLayout.yaxis.range];
    await Plotly.relayout(g, { "yaxis.range": [0.3, 0.4], "yaxis.autorange": false });
    await Plotly.restyle(g, { visible: "legendonly" }, [0]);
    return range;
  });
  await set("hist", { splitPlots: false }); await graphReady();
  await set("box"); await graphReady();
  const restored = await page.evaluate(() => {
    const g = document.querySelector(".chart-body .js-plotly-plot");
    return { range: g._fullLayout.yaxis.range, visible: g.data[0].visible };
  });
  assert.deepEqual(restored.range, [0.3, 0.4]); assert.equal(restored.visible, "legendonly");
  // A double click after restoration must return to the original default.
  await page.locator(".chart-body .nsewdrag").dblclick({ position: { x: 150, y: 150 }, delay: 80 });
  await page.waitForTimeout(450);
  const reset = await page.evaluate(() => document.querySelector(".chart-body .js-plotly-plot")._fullLayout.yaxis.range);
  assert.deepEqual(reset, original);

  const selected = {};
  for (const type of ["box", "hist", "scatter", "pareto"]) {
    await set(type, { test: 0, scatterX: 1, scatterY: 0, xAxis: "site", groupBy: "wafer", splitPlots: true });
    await page.waitForSelector(".facet-card.preview");
    await page.locator(".facet-card.preview").nth(2).click();
    await page.waitForSelector(".facet-detail-title");
    const title = await page.locator(".facet-detail-title").textContent();
    await graphReady();
    await page.evaluate(async () => {
      const url = performance.getEntriesByType("resource").find((r) => r.name.includes("/deps/plotly__js-dist-min.js?"))?.name;
      const Plotly = (await import(url)).default;
      await Plotly.relayout(document.querySelector(".facet-detail .js-plotly-plot"), { "yaxis.range": [0.3, 0.4], "yaxis.autorange": false });
    });
    await set("trend"); await graphReady();
    await set(type);
    await page.waitForSelector(".facet-detail-title");
    assert.equal(await page.locator(".facet-detail-title").textContent(), title);
    await graphReady();
    assert.deepEqual(await page.evaluate(() => document.querySelector(".facet-detail .js-plotly-plot")._fullLayout.yaxis.range), [0.3, 0.4]);
    selected[type] = title;
    await page.evaluate(async () => {
      const { useStore } = await import("/src/store.ts");
      useStore.getState().patchFilters({ wafers: [0, 1, 2, 3] });
    });
    await page.waitForSelector(".facet-card.preview");
    assert.equal(await page.locator(".facet-detail-title").count(), 0);
    await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().resetFilters());
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ cache, restored, reset, selected, errors }, null, 2));
} catch (e) {
  await page?.screenshot({ path: "shots/cache-round-failure.png" }).catch(() => {});
  throw e;
} finally { await browser?.close(); server.kill(); }

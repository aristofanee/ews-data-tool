// Local synthetic regression: site grouping, absolute Pareto rates, bin
// identity/colours, all/outlier markers, zoom reset and map reuse/layout.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1421"], { stdio: "ignore", windowsHide: true });
let browser;
let page;
try {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch("http://127.0.0.1:1421")).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  page = await browser.newPage({ viewport: { width: 1560, height: 980 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1421");
  await page.getByText("Load demo data").click();
  await page.waitForSelector(".boxlayer path.box");
  const pure = await page.evaluate(async () => {
    const api = await import("/src/lib/api.ts");
    const { useStore } = await import("/src/store.ts");
    const { figureBox, figurePareto } = await import("/src/charts/figures.ts");
    const { binColor, binLabel } = await import("/src/lib/theme.ts");
    const { cachedMap } = await import("/src/lib/mapCache.ts");
    const state = useStore.getState();
    const data = await api.boxPlot({ test: 0, xAxis: "wafer", filter: state.filters });
    const points = (figure) => figure.data.filter((t) => t.mode === "markers").flatMap((t) =>
      t.y.map((v, i) => JSON.stringify([v, t.customdata[i]])));
    const outliers = points(figureBox(data, { theme: "light", spec: { ...state.spec, showPoints: "outliers" } }));
    const all = new Set(points(figureBox(data, { theme: "light", spec: { ...state.spec, showPoints: "all" } })));
    const site = await api.boxPlot({ test: 0, xAxis: "site", filter: state.filters });
    const global = await api.pareto({ category: "hard", filter: state.filters, top: 1 });
    const grouped = await api.pareto({ category: "hard", filter: state.filters, groupBy: "site", top: 2 });
    const fig = figurePareto(global, { theme: "light", spec: { ...state.spec, type: "pareto" } });
    const groupedFig = figurePareto(grouped, { theme: "light", spec: { ...state.spec, type: "pareto" } });
    let loads = 0;
    const [a, b] = await Promise.all([
      cachedMap("smoke", { x: 1, y: 2 }, async () => { loads++; return {}; }, () => 1),
      cachedMap("smoke", { y: 2, x: 1 }, async () => { loads++; return {}; }, () => 1),
    ]);
    return { outliers: outliers.length, retained: outliers.every((p) => all.has(p)),
      sites: site.groups.map((g) => g.xLabel),
      globalSum: global.bars.reduce((n, b) => n + b.pct, 0), failureRate: global.failTotal * 100 / global.total,
      groupedCorrect: grouped.series.every((s) => s.pcts.every((p, i) => Math.abs(p - s.counts[i] * 100 / grouped.groups[i].total) < 1e-5)),
      labels: fig.data[0].x, groupLabels: groupedFig.data.filter((t) => t.type === "bar").map((t) => t.name),
      colours: [binColor(1, false), binColor(2, true), binColor(3), binColor(8), binColor(16), binColor(19)],
      label: binLabel("soft", 7, "Leakage"), loads, shared: a === b };
  });
  assert.ok(pure.outliers > 0 && pure.retained);
  assert.deepEqual(pure.sites, ["Site 0", "Site 1", "Site 2", "Site 3"]);
  assert.ok(Math.abs(pure.globalSum - pure.failureRate) < 1e-8);
  assert.ok(pure.groupedCorrect);
  assert.ok(pure.labels.every((s) => s === "Others" || s.startsWith("HBIN ")));
  assert.ok(pure.groupLabels.every((s) => s === "Others" || s.startsWith("HBIN ")));
  assert.equal(pure.label, "SBIN 7 · Leakage");
  assert.equal(pure.colours[0], "#16c55e");
  for (const colour of pure.colours.slice(1)) {
    const [r, g, b] = colour.slice(1).match(/../g).map((v) => parseInt(v, 16));
    assert.ok(!(g > r * 1.15 && g > b * 1.15), `failure colour must not be green: ${colour}`);
  }
  assert.equal(pure.loads, 1); assert.ok(pure.shared);

  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchSpec({ xAxis: "site" }));
  await page.waitForFunction(() => document.querySelector(".js-plotly-plot")?.data.filter((t) => t.type === "box").length === 4);
  await page.screenshot({ path: "shots/polish-site-box.png" });
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchSpec({ xAxis: "wafer" }));
  await page.waitForFunction(() => document.querySelector(".js-plotly-plot")?.data.filter((t) => t.type === "box").length === 50);

  const range = () => page.evaluate(() => {
    const plot = document.querySelector(".js-plotly-plot");
    return [plot._fullLayout.xaxis.range, plot._fullLayout.yaxis.range];
  });
  const initial = await range();
  for (let i = 0; i < 3; i++) {
    await page.locator(".nsewdrag").dblclick({ position: { x: 200, y: 100 } });
    await page.waitForTimeout(400);
    assert.deepEqual(await range(), initial, "double click must always restore the same default");
  }
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().setPlotType("map");
  });
  const defaults = await page.evaluate(() => [...document.querySelectorAll("select")].some((s) =>
    s.options[0]?.value === "none" && s.options[0]?.textContent === "None" &&
    [...s.options].some((o) => o.value === "wafer") && ![...s.options].some((o) => o.value === "hbin")));
  assert.ok(defaults);
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchSpec({ groupBy: "wafer" }));
  await page.waitForFunction(() => document.querySelectorAll(".binmap-open").length === 50);
  const dimensions = () => page.locator(".binmap-canvas-wrap").first().evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  const valueDimensions = await dimensions();
  assert.equal(valueDimensions.width, valueDimensions.height);
  assert.ok(valueDimensions.width >= 300);
  assert.equal(await page.locator(".binmap-lot").count(), 2);
  await page.screenshot({ path: "shots/polish-value-maps.png" });
  await page.locator(".binmap-open").nth(3).click();
  const valueTitle = await page.locator(".map-detail-title").innerText();
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().setPlotType("hist"));
  await page.waitForSelector(".js-plotly-plot");
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().setPlotType("map"));
  await page.waitForSelector(".map-detail-title");
  assert.equal(await page.locator(".map-detail-title").innerText(), valueTitle);
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().selectTest(1));
  await page.waitForFunction(() => document.querySelectorAll(".binmap-open").length === 50 && !document.querySelector(".map-detail"));

  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().setPlotType("binmap"));
  await page.waitForFunction(() => document.querySelectorAll(".binmap-open").length === 50);
  assert.deepEqual(await dimensions(), valueDimensions);
  assert.equal(await page.locator(".binmap-lot").count(), 2);
  await page.screenshot({ path: "shots/polish-bin-maps.png" });
  await page.locator(".binmap-open").nth(3).click();
  const binTitle = await page.locator(".map-detail-title").innerText();
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().setPlotType("box"));
  await page.waitForSelector(".js-plotly-plot");
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().setPlotType("binmap"));
  await page.waitForSelector(".map-detail-title");
  assert.equal(await page.locator(".map-detail-title").innerText(), binTitle);
  await page.screenshot({ path: "shots/polish-bin-detail.png" });
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().patchSpec({ binCategory: "soft" });
  });
  await page.waitForFunction(() => document.querySelectorAll(".binmap-open").length === 50);
  await page.locator(".binmap-open").nth(3).click();
  await page.waitForFunction(() => document.querySelector(".map-detail-title")?.textContent.startsWith("SBIN map"));
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().toggleTheme());
  await page.screenshot({ path: "shots/polish-sbin-dark.png" });
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().setPlotType("pareto");
    useStore.getState().patchSpec({ xAxis: "none", groupBy: "site", binCategory: "soft" });
  });
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 4);
  assert.deepEqual((await page.locator(".facet-label").allTextContents()).map((s) => s.split(" · ")[0]), ["Site 0", "Site 1", "Site 2", "Site 3"]);
  await page.screenshot({ path: "shots/polish-site-pareto.png" });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pure, valueDimensions, valueTitle, binTitle, errors }, null, 2));
} catch (e) {
  if (page) await page.screenshot({ path: "shots/polish-failure.png" }).catch(() => {});
  throw e;
} finally {
  await browser?.close(); server.kill();
}

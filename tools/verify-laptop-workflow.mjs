import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1421"], { stdio: "ignore", windowsHide: true });
let browser;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch("http://127.0.0.1:1421")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1229, height: 864 }, deviceScaleFactor: 1.25 });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1421");
  await page.getByText("Load demo data").click();
  await page.waitForSelector(".boxlayer path.box");
  const initial = await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    const { binLabel } = await import("/src/lib/theme.ts");
    const { chartStyle } = await import("/src/charts/plotlyTheme.ts");
    return { top: useStore.getState().spec.top, hard: binLabel("hard", 2, "failure"), soft: binLabel("soft", 2, "leakage"), style: chartStyle(false) };
  });
  assert.equal(initial.top, 10); assert.equal(initial.hard, "HBIN 2"); assert.equal(initial.soft, "SBIN 2 · leakage");
  assert.equal(initial.style.tick, 18); assert.equal(initial.style.line, 1.4);
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().setPresentation(false));
  await page.waitForFunction(() => document.querySelector(".js-plotly-plot")?._fullLayout.font.size === 18);
  const headerFonts = await page.evaluate(() => ({
    title: getComputedStyle(document.querySelector(".chart-title")).fontSize,
    stat: getComputedStyle(document.querySelector(".stat-k")).fontSize,
  }));
  assert.equal(headerFonts.title, "18.5px"); assert.equal(headerFonts.stat, "11px");
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().selectTest(2); useStore.getState().setPlotType("scatter");
  });
  await page.waitForSelector(".js-plotly-plot");
  assert.equal(await page.getByText("X test", { exact: true }).count(), 0);
  const axes = await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    const before = useStore.getState().spec;
    useStore.getState().patchSpec({ scatterY: 4 });
    useStore.getState().selectTest(3);
    const after = useStore.getState().spec;
    useStore.getState().setPlotType("box");
    return { before: [before.test, before.scatterX], after: [after.test, after.scatterX, after.scatterY], boxTest: useStore.getState().spec.test };
  });
  assert.deepEqual(axes.before, [2, 2]); assert.deepEqual(axes.after, [3, 3, 4]); assert.equal(axes.boxTest, 3);
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchSpec({ groupBy: "wafer", splitPlots: true }));
  await page.waitForSelector(".facet-card.preview");
  const layout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".facet-card.preview")].slice(0, 2).map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width }; });
    return cards;
  });
  assert.equal(layout[0].y, layout[1].y); assert.ok(layout[1].x > layout[0].x);
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().setPlotType("binmap"));
  await page.waitForSelector(".binmap-open");
  await page.locator(".binmap-open").nth(1).click();
  await page.waitForSelector(".map-detail-title");
  const mapTitle = await page.locator(".map-detail-title").textContent();
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchSpec({ binCategory: "soft" }));
  await page.waitForFunction(() => document.querySelector(".map-detail-title")?.textContent.includes("SBIN"));
  assert.equal((await page.locator(".map-detail-title").textContent()).replace("SBIN", "HBIN"), mapTitle);
  const pinch = await page.evaluate(() => {
    const canvas = document.querySelector(".map-detail .map-canvas"), before = canvas.toDataURL();
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -50, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    return { before, after: canvas.toDataURL() };
  });
  assert.notEqual(pinch.before, pinch.after);
  await page.evaluate(async () => { const s = (await import("/src/store.ts")).useStore.getState(); s.setPlotType("pareto"); s.patchSpec({ groupBy: "wafer", xAxis: "none" }); });
  await page.waitForSelector(".facet-card.preview"); await page.locator(".facet-card.preview").nth(1).click();
  await page.waitForSelector(".facet-detail-title"); const paretoTitle = await page.locator(".facet-detail-title").textContent();
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchSpec({ binCategory: "soft" }));
  await page.waitForSelector(".facet-detail-title"); assert.equal(await page.locator(".facet-detail-title").textContent(), paretoTitle);
  const reset = await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts"); const s = useStore.getState();
    s.patchFilters({ sites: [3] }); s.setPresentation(false); s.addReport(); s.setInfo(s.info, { reset: true });
    const n = useStore.getState(); return { type: n.spec.type, test: n.spec.test, top: n.spec.top, filters: n.filters, reports: n.report.length, presentation: n.presentation };
  });
  assert.equal(reset.type, "box"); assert.equal(reset.test, 0); assert.equal(reset.top, 10); assert.deepEqual(reset.filters.sites ?? [], []); assert.equal(reset.reports, 0); assert.equal(reset.presentation, false);
  assert.deepEqual(errors, []); console.log(JSON.stringify({ initial, axes, layout, mapTitle, paretoTitle, reset, errors }, null, 2));
} finally { await browser?.close(); server.kill(); }

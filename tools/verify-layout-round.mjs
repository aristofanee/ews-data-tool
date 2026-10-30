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
  page = await browser.newPage({ viewport: { width: 1560, height: 980 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1421");
  assert.equal(await page.locator(".empty h1").innerText(), "EWS Data Tool");
  assert.equal(await page.locator(".empty-copy p").count(), 0);
  assert.equal(await page.locator(".wafer-svg g").getAttribute("clip-path"), "url(#homeWaferClip)");
  await page.screenshot({ path: "shots/round-home.png" });
  await page.getByLabel("Slide-sized fonts", { exact: true }).uncheck();
  await page.getByText("Load demo data").click();
  await page.waitForSelector(".boxlayer path.box");

  const result = await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    const api = await import("/src/lib/api.ts");
    const { figureBox, figureHist, figurePareto } = await import("/src/charts/figures.ts");
    const state = useStore.getState();
    const initiallyGlobal = !state.presentation && Object.values(state.specs).every((s) => !s.presentation);
    state.addReport();
    state.setPresentation(true);
    const after = useStore.getState();
    const propagated = after.presentation && Object.values(after.specs).every((s) => s.presentation)
      && after.report.every((item) => item.spec.presentation);
    after.applyTemplate({ app: "EWS Data Tool", version: 1, name: "Global presentation check",
      created: new Date().toISOString(), presentation: false, filters: state.filters,
      plots: [{ spec: after.spec, filters: state.filters },
        { spec: { ...after.spec, type: "hist", presentation: true }, filters: state.filters }],
    });
    const restored = useStore.getState();
    const templateGlobal = !restored.presentation && Object.values(restored.specs).every((s) => !s.presentation)
      && restored.report.every((item) => !item.spec.presentation);
    restored.setPresentation(true);
    const grouped = await api.boxPlot({ test: 0, xAxis: "site", groupBy: "lot", filter: state.filters });
    const figure = figureBox(grouped, { theme: "light", spec: { ...after.spec, xAxis: "site", groupBy: "lot" } });
    const boxes = figure.data.filter((t) => t.type === "box");
    const hist = await api.histogram({ test: 0, filter: state.filters, groupBy: "lot" });
    const pareto = await api.pareto({ category: "hard", filter: state.filters, groupBy: "lot" });
    const global = await api.pareto({ category: "hard", filter: state.filters });
    const p = figurePareto(pareto, { theme: "light", spec: after.spec });
    const g = figurePareto(global, { theme: "light", spec: after.spec });
    const empty = figurePareto({ ...pareto, groups: [], series: [] }, { theme: "light", spec: after.spec });
    const previews = [
      figureBox(grouped, { theme: "light", spec: after.spec, facetLabel: grouped.groups[0].groupLabel, preview: true }),
      figureHist(hist, { theme: "light", spec: after.spec, facetLabel: hist.groups[0].label, preview: true }),
      figurePareto(global, { theme: "light", spec: after.spec, preview: true }),
    ];
    return { initiallyGlobal, propagated, templateGlobal,
      names: boxes.map((t) => t.name), positions: boxes.map((t) => t.x[0]), legend: figure.layout.showlegend,
      headings: figure.layout.annotations.filter((a) => a.xref === "x").map((a) => ({ text: a.text, x: a.x })),
      failTitle: p.layout.yaxis.title.text, yieldTitle: p.layout.yaxis2.title.text,
      failRange: p.layout.yaxis.range, yieldRange: p.layout.yaxis2.range,
      singleColour: typeof g.data[0].marker.color === "string",
      emptyAxesFinite: [...empty.layout.yaxis.range, ...empty.layout.yaxis2.range].every(Number.isFinite),
      previewAxes: previews.every((fig) => fig.layout.xaxis.showticklabels && fig.layout.yaxis.showticklabels
        && fig.layout.xaxis.title.text && fig.layout.yaxis.title.text),
    };
  });
  assert.ok(result.initiallyGlobal && result.propagated && result.templateGlobal);
  assert.equal(result.legend, false);
  assert.deepEqual(result.positions, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(result.names.slice(0, 4)).size, 1);
  assert.equal(new Set(result.names.slice(4)).size, 1);
  assert.notEqual(result.names[0], result.names[4]);
  assert.deepEqual(result.headings.map((h) => h.x), [1.5, 5.5]);
  assert.equal(result.failTitle, "Fail [%]"); assert.equal(result.yieldTitle, "Yield [%]");
  assert.ok(result.failRange[1] < result.yieldRange[0]);
  assert.ok(result.singleColour && result.previewAxes && result.emptyAxesFinite);
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().setReportOpen(false);
    useStore.setState({ toast: null });
    useStore.getState().patchSpec({ xAxis: "site", groupBy: "lot", splitPlots: false });
  });
  await page.waitForFunction(() => document.querySelector(".js-plotly-plot")?.data.filter((t) => t.type === "box").length === 8);
  await page.screenshot({ path: "shots/round-box-groups.png" });
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchSpec({ splitPlots: true }));
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 2 && document.querySelectorAll(".facet-card .xtitle").length >= 2);
  const size = () => page.locator(".facet-card.preview").first().evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
  const boxSize = await size();
  assert.ok(Math.abs(boxSize.width / boxSize.height - 4 / 3) < 0.02);
  await page.screenshot({ path: "shots/round-box-previews.png" });
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchFilters({ lots: [0] }));
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 1 && document.querySelector(".facet-card .xtitle"));
  assert.deepEqual(await size(), boxSize, "one preview must keep the same size");
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().resetFilters();
    useStore.getState().setPlotType("hist");
    useStore.getState().patchSpec({ groupBy: "lot", splitPlots: true });
  });
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 2 && document.querySelectorAll(".facet-card .xtitle").length >= 2);
  assert.deepEqual(await size(), boxSize);
  await page.screenshot({ path: "shots/round-hist-previews.png" });
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().setPlotType("pareto");
    useStore.getState().patchSpec({ groupBy: "lot", xAxis: "none" });
  });
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 2 && document.querySelectorAll(".facet-card .xtitle").length >= 2);
  assert.deepEqual(await size(), boxSize);
  await page.screenshot({ path: "shots/round-pareto-previews.png" });
  await page.evaluate(async () => (await import("/src/store.ts")).useStore.getState().patchFilters({ lots: [0] }));
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 1 && document.querySelector(".facet-card .xtitle"));
  assert.deepEqual(await size(), boxSize);
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().resetFilters();
    useStore.getState().patchSpec({ groupBy: "none", xAxis: "lot" });
  });
  await page.waitForFunction(() => !!document.querySelector(".js-plotly-plot")?._fullLayout.yaxis2 && !document.querySelector(".facet-grid"));
  await page.screenshot({ path: "shots/round-pareto-axes.png" });
  await page.getByLabel("Slide-sized fonts", { exact: true }).uncheck();
  await page.reload();
  await page.getByLabel("Slide-sized fonts", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Slide-sized fonts", { exact: true }).isChecked(), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result, boxSize, errors }, null, 2));
} catch (e) {
  if (page) await page.screenshot({ path: "shots/round-failure.png" }).catch(() => {});
  throw e;
} finally {
  await browser?.close(); server.kill();
}

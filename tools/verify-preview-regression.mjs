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
  page = await browser.newPage({ viewport: { width: 2560, height: 1100 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1421");
  await page.getByText("Load demo data").click();
  await page.waitForSelector(".boxlayer path.box");
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().selectTest(1);
    useStore.getState().patchSpec({ xAxis: "site", groupBy: "wafer", splitPlots: true });
  });
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 50 && document.querySelectorAll(".facet-card .xtitle").length > 0);
  const geometry = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll(".facet-card.preview")].map((el) => {
      const r = el.getBoundingClientRect();
      const canvas = el.querySelector(".js-plotly-plot")?.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
        chartBottom: canvas?.bottom ?? null };
    });
    let overlaps = 0;
    for (let i = 0; i < cards.length; i++) for (let j = 0; j < i; j++) {
      const a = cards[i], b = cards[j];
      if (a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1) overlaps++;
    }
    const grid = document.querySelector(".facet-grid");
    return { count: cards.length, first: cards[0], overlaps, horizontalOverflow: grid.scrollWidth - grid.clientWidth,
      chartsContained: cards.every((c) => c.chartBottom === null || c.chartBottom <= c.bottom + 1) };
  });
  const wide = await geometry();
  console.log(JSON.stringify({ wide }, null, 2));
  await page.screenshot({ path: "shots/preview-box-50-wide.png" });
  assert.equal(wide.overlaps, 0);
  assert.ok(wide.chartsContained);
  assert.ok(wide.horizontalOverflow <= 1);
  assert.ok(wide.first.width >= 520);
  assert.ok(Math.abs(wide.first.width / wide.first.height - 4 / 3) < 0.02);
  for (const width of [1920, 1560]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.waitForTimeout(250);
    const current = await geometry();
    assert.equal(current.overlaps, 0);
    assert.ok(current.chartsContained);
    assert.ok(current.horizontalOverflow <= 1);
  }
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().setPlotType("scatter");
    useStore.getState().patchSpec({ groupBy: "wafer", splitPlots: true });
  });
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 50 && document.querySelector(".facet-card .xtitle")?.textContent.includes("Vt"));
  const scatter = await page.evaluate(() => {
    const graphs = [...document.querySelectorAll(".facet-card .js-plotly-plot")];
    const note = [...document.querySelectorAll(".stat")].find((el) => el.querySelector(".stat-k")?.textContent === "Rendering");
    return { axes: graphs.every((g) => g._fullLayout.xaxis.showticklabels && g._fullLayout.yaxis.showticklabels
      && g._fullLayout.xaxis.title.text && g._fullLayout.yaxis.title.text),
      labels: [...document.querySelectorAll(".stat-k")].map((el) => el.textContent),
      note: note?.textContent, help: note?.getAttribute("title") };
  });
  assert.ok(scatter.axes);
  assert.ok(scatter.labels.includes("Considered dice") && scatter.labels.includes("Displayed points"));
  assert.match(scatter.note, /Sampled display/);
  assert.match(scatter.help, /Correlation.*all considered/);
  await page.screenshot({ path: "shots/preview-scatter-axes.png" });
  await page.setViewportSize({ width: 2560, height: 1100 });
  await page.waitForTimeout(250);
  const scatterWide = await geometry();
  assert.equal(scatterWide.overlaps, 0);
  assert.ok(scatterWide.chartsContained);
  await page.screenshot({ path: "shots/preview-scatter-wide.png" });
  await page.locator(".facet-grid").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.locator(".facet-card.preview").last().locator(".xtitle").waitFor();
  assert.equal((await geometry()).overlaps, 0, "lazy previews at the end must keep separate rows");
  await page.evaluate(async () => {
    const { useStore } = await import("/src/store.ts");
    useStore.getState().setPlotType("pareto");
    useStore.getState().patchSpec({ groupBy: "wafer", xAxis: "none" });
  });
  await page.waitForFunction(() => document.querySelectorAll(".facet-card.preview").length === 50 && document.querySelector(".facet-card .ytitle")?.textContent === "Fail [%]");
  const pareto = await geometry();
  assert.equal(pareto.overlaps, 0);
  assert.ok(pareto.chartsContained);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ scatter, scatterWide, pareto, errors }, null, 2));
} catch (e) {
  await page?.screenshot({ path: "shots/preview-regression-failure.png" }).catch(() => {});
  throw e;
} finally { await browser?.close(); server.kill(); }

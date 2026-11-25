import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

import { repoPath } from "./harness-paths.mjs";
const shotDir = repoPath("shots", "debug-ui");
mkdirSync(shotDir, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) errors.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack || e.message}`));
const sleep = (ms) => page.waitForTimeout(ms);
const tab = async (name) => {
  await page.locator(".tab", { hasText: name }).click();
  await sleep(700);
};
const field = (label) => page.locator(".field", { hasText: label }).first();
const select = async (label, value) => {
  await field(label).locator("select").selectOption(value);
  await sleep(700);
};
const check = async (label, on = true) => {
  await page.locator(".check-row", { hasText: label }).locator('input[type="checkbox"]').setChecked(on);
  await sleep(700);
};
const plotInfo = async () =>
  page.evaluate(() => {
    const el = document.querySelector(".chart-body .js-plotly-plot");
    if (!el) return { error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null };
    return {
      traces: el.data?.length ?? 0,
      names: el.data?.map((t) => t.name ?? ""),
      y: el.data?.[0]?.y?.slice?.(0, 4) ?? null,
      x: el.data?.[0]?.x?.slice?.(0, 4) ?? null,
      markerColor: Array.isArray(el.data?.[0]?.marker?.color)
        ? el.data[0].marker.color.slice(0, 3)
        : el.data?.[0]?.marker?.color ?? null,
      lineWidth: el.data?.[0]?.marker?.line?.width ?? null,
      showscale: el.data?.[0]?.marker?.showscale ?? null,
      colorbarOrientation: el.data?.[0]?.marker?.colorbar?.orientation ?? null,
      yaxisTitle: el.layout?.yaxis?.title?.text ?? null,
      yaxisType: el.layout?.yaxis?.type ?? null,
      yaxisRange: el.layout?.yaxis?.range ?? null,
      legendTitle: el.layout?.legend?.title?.text ?? null,
      annotations: el.layout?.annotations?.map((a) => ({ text: a.text, y: a.y, yshift: a.yshift })) ?? [],
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    };
  });

try {
  await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Load demo data" }).click();
  await sleep(2200);

  // Scatter: group + continuous Z at the same time.
  await tab("Scatter");
  await select("Group by", "lot");
  await field("Z colour").getByRole("button", { name: "Value" }).click();
  await sleep(1000);
  const scatter = await plotInfo();
  await page.screenshot({ path: `${shotDir}\\02-scatter-group-z.png` });

  await check("Split into different plots");
  await sleep(1000);
  const facetCount = await page.locator(".facet-card").count();
  const facetInfo = await page.evaluate(() => {
    const host = document.querySelector(".facet-card .js-plotly-plot");
    return {
      facets: document.querySelectorAll(".facet-card").length,
      overlays: document.querySelectorAll(".facet-open").length,
      hostHeight: host?.getBoundingClientRect().height ?? 0,
      lineWidths: host?.data?.map((t) => t.marker?.line?.width ?? null) ?? [],
      pointerEvents: host ? getComputedStyle(host.parentElement).pointerEvents : null,
    };
  });
  await page.screenshot({ path: `${shotDir}\\03-scatter-facets.png` });
  await page.locator(".facet-open").first().click();
  await sleep(700);
  const scatterDetail = await page.evaluate(() => {
    const host = document.querySelector(".facet-detail-body .js-plotly-plot");
    return {
      title: document.querySelector(".facet-detail-title")?.textContent?.trim() ?? null,
      height: host?.getBoundingClientRect().height ?? 0,
      traces: host?.data?.length ?? 0,
      error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    };
  });
  await page.screenshot({ path: `${shotDir}\\04-scatter-detail.png` });
  await page.getByRole("button", { name: "All plots" }).click();
  await sleep(500);

  // Pareto defaults and percentages.
  await tab("Pareto");
  const paretoSelects = await page.evaluate(() =>
    [...document.querySelectorAll(".field")].map((f) => {
      const label = f.querySelector(".field-label")?.textContent?.trim();
      const s = f.querySelector("select");
      return s ? { label, value: s.value, options: [...s.options].map((o) => o.textContent?.trim()) } : null;
    }).filter(Boolean)
  );
  const paretoStats = await page.locator(".stat").allTextContents();
  const pareto = await plotInfo();
  await page.screenshot({ path: `${shotDir}\\05-pareto-default.png` });

  await select("X axis", "hbin");
  const paretoX = await plotInfo();
  await page.screenshot({ path: `${shotDir}\\06-pareto-x-hbin.png` });

  await select("X axis", "none");
  await select("Group by", "lot");
  await sleep(1200);
  const paretoFacets = await page.evaluate(() => ({
    facets: document.querySelectorAll(".facet-card").length,
    overlays: document.querySelectorAll(".facet-open").length,
    labels: [...document.querySelectorAll(".facet-label")].map((e) => e.textContent?.trim()),
    error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
  }));
  await page.screenshot({ path: `${shotDir}\\07-pareto-facets.png` });
  await page.locator(".facet-open").first().click();
  await sleep(700);
  const paretoDetail = await page.evaluate(() => {
    const host = document.querySelector(".facet-detail-body .js-plotly-plot");
    return {
      title: document.querySelector(".facet-detail-title")?.textContent?.trim() ?? null,
      height: host?.getBoundingClientRect().height ?? 0,
      traces: host?.data?.length ?? 0,
      yaxisTitle: host?.layout?.yaxis?.title?.text ?? null,
      error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    };
  });
  await page.screenshot({ path: `${shotDir}\\08-pareto-detail.png` });
  await page.getByRole("button", { name: "All plots" }).click();
  await sleep(500);

  // Wafer map default, then switch to box and watch for stale map flash.
  await tab("Wafer map");
  const mapState = await page.evaluate(() => {
    const groupField = [...document.querySelectorAll(".field")].find(
      (f) => f.querySelector(".field-label")?.textContent?.trim() === "Group by"
    );
    const s = groupField?.querySelector("select");
    return {
      value: s?.value ?? null,
      options: s ? [...s.options].map((o) => o.textContent?.trim()) : [],
      map: !!document.querySelector(".map-wrap"),
      mapText: document.querySelector(".map-wrap")?.textContent?.slice(0, 120) ?? null,
    };
  });
  await page.screenshot({ path: `${shotDir}\\09-map-default.png` });
  await page.evaluate(() => {
    window.__mapSeenAfterBox = false;
    window.__flashObserver = new MutationObserver(() => {
      if (window.__afterBoxClick && document.querySelector(".map-wrap")) window.__mapSeenAfterBox = true;
    });
    window.__flashObserver.observe(document.querySelector(".chart-body"), { childList: true, subtree: true });
  });
  await page.evaluate(() => {
    window.__afterBoxClick = true;
  });
  await page.locator(".tab", { hasText: "Box plot" }).click();
  await sleep(30);
  const mapJustAfterClick = await page.evaluate(() => !!document.querySelector(".map-wrap"));
  await sleep(600);
  const mapAfterLoad = await page.evaluate(() => ({
    map: !!document.querySelector(".map-wrap"),
    seen: window.__mapSeenAfterBox,
    box: !!document.querySelector(".js-plotly-plot"),
    error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
  }));

  // Box log axis + spec range.
  await check("Logarithmic Y axis");
  await field("Y axis range").locator("select").selectOption("spec");
  await sleep(800);
  const boxLog = await plotInfo();
  await page.screenshot({ path: `${shotDir}\\10-box-log.png` });

  console.log(
    JSON.stringify(
      {
        scatter,
        facetCount,
        facetInfo,
        scatterDetail,
        paretoSelects,
        paretoStats,
        pareto,
        paretoX,
        paretoFacets,
        paretoDetail,
        mapState,
        mapJustAfterClick,
        mapAfterLoad,
        boxLog,
        errors,
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}

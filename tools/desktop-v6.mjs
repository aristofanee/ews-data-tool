// Focused checks for the unified grouping UI, split previews, map grouping,
// HBIN/SBIN bin maps, limits and report output. Version stays at v0.3.3.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";

import { desktopExecutable, referenceStdfFiles, repoPath } from "./harness-paths.mjs";
const exe = desktopExecutable();
const files = referenceStdfFiles();
const port = 9346;
const shotDir = repoPath("shots");
const reportDir = `${shotDir}\\report-v6`;
mkdirSync(shotDir, { recursive: true });
rmSync(reportDir, { recursive: true, force: true });
mkdirSync(reportDir, { recursive: true });

const child = spawn(exe, [], {
  windowsHide: true,
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => console.error("[app]", d.toString().trim()));
child.stderr.on("data", (d) => console.error("[app!]", d.toString().trim()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
const failures = [];
const check = (name, ok, detail) => {
  if (!ok) failures.push({ name, detail });
};

let browser = null;
try {
  let version = null;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) {
        version = await res.json();
        break;
      }
    } catch {
      /* not up */
    }
    await sleep(250);
  }
  if (!version) throw new Error("CDP endpoint did not start");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page = null;
  for (let i = 0; i < 80; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => !p.url().startsWith("devtools://")) ?? null;
    if (page) break;
    await sleep(250);
  }
  if (!page) throw new Error("No page");
  for (let i = 0; i < 120; i++) {
    try {
      if (
        await page.evaluate(
          () => location.href.includes("tauri.localhost") && !!window.__TAURI_INTERNALS__
        )
      ) {
        break;
      }
    } catch {
      /* navigating */
    }
    await sleep(250);
  }

  out.open = await page.evaluate(async (paths) => {
    const info = await window.__TAURI_INTERNALS__.invoke("open_paths", { paths });
    return { rows: info.rows, lots: info.lots, wafers: info.wafers.length, tests: info.tests.length };
  }, files);
  await page.evaluate((dir) => localStorage.setItem("ews-report-folder", dir), reportDir);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForSelector(".js-plotly-plot", { timeout: 180000 });
  await page.waitForTimeout(1500);

  const tab = async (label) => {
    await page.locator(".tab", { hasText: label }).click();
    await page.waitForTimeout(900);
  };
  const waitKind = async (kind) => {
    await page.waitForFunction(
      (k) => document.querySelector(".plot-kind")?.textContent?.trim() === k,
      kind,
      { timeout: 120000 }
    );
    await page.waitForTimeout(700);
  };
  const section = (name) => page.locator(".insp-section", { hasText: name });

  out.tabs = await page.locator(".tab").allInnerTexts();
  check(
    "tab order",
    JSON.stringify(out.tabs) ===
      JSON.stringify(["Box plot", "Wafer map", "Histogram", "Scatter", "Trend", "Bin map", "Pareto"]),
    out.tabs
  );
  out.hints = await page.locator(".hint, .map-hint").count();
  check("no hint text", out.hints === 0, out.hints);

  const shortcutOrder = [];
  for (let i = 1; i <= 7; i++) {
    await page.keyboard.press(`Control+${i}`);
    await page.waitForTimeout(350);
    shortcutOrder.push((await page.locator(".plot-kind").innerText()).trim());
  }
  out.shortcutOrder = shortcutOrder;
  check(
    "keyboard shortcuts match tab order",
    JSON.stringify(shortcutOrder.map((s) => s.toLowerCase())) ===
      JSON.stringify(out.tabs.map((s) => s.toLowerCase())),
    shortcutOrder
  );

  // Box: X axis + group by + split previews and enlarged detail.
  await tab("Box plot");
  await waitKind("Box plot");
  const box = section("Box plot");
  out.boxFields = await box.locator(".field-label").allInnerTexts();
  check("box X axis field", out.boxFields.includes("X axis"), out.boxFields);
  check("box group by field", out.boxFields.includes("Group by"), out.boxFields);
  await box.locator(".field", { hasText: "Group by" }).locator("select").selectOption("lot");
  await box.locator("label.check-row", { hasText: "Split into different plots" }).locator("input").check();
  await page.waitForFunction(
    () => document.querySelectorAll(".facet-card.preview").length >= 2,
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(900);
  out.boxPreviewCount = await page.locator(".facet-card.preview").count();
  out.boxPreviewTicks = await page.locator(".facet-card.preview .xtick text").count();
  check("box split previews", out.boxPreviewCount >= 2, out.boxPreviewCount);
  check("box preview has no axis labels", out.boxPreviewTicks === 0, out.boxPreviewTicks);
  await page.screenshot({ path: `${shotDir}\\v6-box-split.png` });
  await page.locator(".facet-card.preview").first().click();
  await page.waitForSelector(".facet-detail", { timeout: 30000 });
  await page.waitForTimeout(900);
  out.boxDetailTicks = await page.locator(".facet-detail .xtick text").count();
  check("box detail has axis labels", out.boxDetailTicks > 0, out.boxDetailTicks);
  await page.screenshot({ path: `${shotDir}\\v6-box-detail.png` });
  await page.locator(".facet-detail .map-detail-back").click();
  await page.waitForTimeout(500);

  // Limits: one section, no control limits, manual range applied on a full chart.
  const limits = section("Limits");
  out.limitLabels = await limits.locator(".field-label").allInnerTexts();
  out.hasControl = (await limits.innerText()).toLowerCase().includes("control");
  check("single limits section", (await limits.count()) === 1, out.limitLabels);
  check("no control limits", !out.hasControl, out.hasControl);
  check(
    "limit modes present",
    (await limits.locator("select option").allInnerTexts()).join("|").includes("±k IQR"),
    await limits.locator("select option").allInnerTexts()
  );
  await box
    .locator("label.check-row", { hasText: "Split into different plots" })
    .locator("input")
    .uncheck();
  await page.waitForTimeout(700);
  await limits.locator("select").selectOption("manual");
  await limits.locator(".field", { hasText: "Min" }).locator("input").fill("-0.8");
  await limits.locator(".field", { hasText: "Max" }).locator("input").fill("0.1");
  await page.waitForTimeout(1100);
  out.boxManualRange = await page.evaluate(() => {
    const gd = document.querySelector(".js-plotly-plot");
    return gd?.layout?.yaxis?.range ?? null;
  });
  check(
    "manual range applied",
    Array.isArray(out.boxManualRange) &&
      Math.abs(out.boxManualRange[0] + 0.8) < 0.01 &&
      Math.abs(out.boxManualRange[1] - 0.1) < 0.01,
    out.boxManualRange
  );
  await page.screenshot({ path: `${shotDir}\\v6-box-manual-limits.png` });

  // Histogram split previews.
  await tab("Histogram");
  await waitKind("Histogram");
  const hist = section("Histogram");
  await hist.locator(".field", { hasText: "Group by" }).locator("select").selectOption("lot");
  await hist.locator("label.check-row", { hasText: "Split into different plots" }).locator("input").check();
  await page.waitForFunction(
    () => document.querySelectorAll(".facet-card.preview").length >= 2,
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(700);
  out.histPreviewCount = await page.locator(".facet-card.preview").count();
  check("hist split previews", out.histPreviewCount >= 2, out.histPreviewCount);
  await page.screenshot({ path: `${shotDir}\\v6-hist-split.png` });

  // Scatter: grouping and a continuous Z colour are independent.
  await tab("Scatter");
  await waitKind("Scatter");
  const scatter = section("Scatter");
  await scatter.locator(".field", { hasText: "Group by" }).locator("select").selectOption("lot");
  await scatter.locator(".field", { hasText: "Z colour" }).getByRole("button", { name: "Value" }).click();
  await page.waitForTimeout(1200);
  out.scatterGroupZ = await page.evaluate(() => {
    const gd = document.querySelector(".chart-body .js-plotly-plot");
    return {
      traces: gd?.data?.length ?? 0,
      legend: gd?.layout?.legend?.title?.text ?? null,
      colorbar: gd?.data?.[0]?.marker?.colorbar?.orientation ?? null,
      showscale: gd?.data?.[0]?.marker?.showscale ?? null,
      outline: gd?.data?.[0]?.marker?.line?.width ?? null,
      error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    };
  });
  check(
    "scatter group + continuous z",
    out.scatterGroupZ.traces >= 2 &&
      out.scatterGroupZ.legend === "Lot" &&
      out.scatterGroupZ.showscale === true &&
      out.scatterGroupZ.colorbar === "h" &&
      out.scatterGroupZ.outline === 0,
    out.scatterGroupZ
  );
  await page.screenshot({ path: `${shotDir}\\v6-scatter-group-z.png` });
  await scatter.locator("label.check-row", { hasText: "Split into different plots" }).locator("input").check();
  await page.waitForFunction(
    () => document.querySelectorAll(".facet-card.preview").length >= 2,
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(700);
  out.scatterPreviewCount = await page.locator(".facet-card.preview").count();
  out.scatterPreview = await page.evaluate(() => {
    const host = document.querySelector(".facet-card .js-plotly-plot");
    return {
      staticPlot: host?._context?.staticPlot ?? null,
      modebar: document.querySelectorAll(".facet-card .modebar").length,
      outlines: host?.data?.map((t) => t.marker?.line?.width ?? null) ?? [],
    };
  });
  check("scatter split previews", out.scatterPreviewCount >= 2, out.scatterPreviewCount);
  check(
    "scatter previews static and outline-free",
    out.scatterPreview.staticPlot === true &&
      out.scatterPreview.modebar === 0 &&
      out.scatterPreview.outlines.every((w) => w === 0),
    out.scatterPreview
  );
  await page.screenshot({ path: `${shotDir}\\v6-scatter-split.png` });
  await page.locator(".facet-open").first().click();
  await page.waitForSelector(".facet-detail", { timeout: 30000 });
  await page.waitForTimeout(700);
  out.scatterDetailHeight = await page
    .locator(".facet-detail-body .js-plotly-plot")
    .evaluate((el) => el.getBoundingClientRect().height);
  check("scatter detail opens full plot", out.scatterDetailHeight > 200, out.scatterDetailHeight);
  await page.screenshot({ path: `${shotDir}\\v6-scatter-detail.png` });
  await page.locator(".facet-detail .map-detail-back").click();
  await page.waitForTimeout(400);

  // Pareto: global defaults, grouped X axis, then Group by facets.
  await tab("Pareto");
  await waitKind("Pareto");
  const pareto = section("Pareto");
  const paretoXSelect = pareto.locator(".field", { hasText: "X axis" }).locator("select");
  const paretoGroupSelect = pareto.locator(".field", { hasText: "Group by" }).locator("select");
  out.paretoDefaults = {
    xAxis: await paretoXSelect.inputValue(),
    groupBy: await paretoGroupSelect.inputValue(),
    splitCheckboxes: await pareto
      .locator("label.check-row", { hasText: "Split into different plots" })
      .count(),
  };
  check(
    "pareto defaults",
    out.paretoDefaults.xAxis === "none" &&
      out.paretoDefaults.groupBy === "none" &&
      out.paretoDefaults.splitCheckboxes === 0,
    out.paretoDefaults
  );
  out.paretoStats = await page.locator(".stat").allInnerTexts();
  check(
    "pareto yield header",
    out.paretoStats.some((s) => s.toLowerCase().includes("yield")),
    out.paretoStats
  );
  out.paretoGlobal = await page.evaluate(() => {
    const gd = document.querySelector(".chart-body .js-plotly-plot");
    return {
      traces: gd?.data?.length ?? 0,
      values: gd?.data?.[0]?.y ?? [],
      colors: gd?.data?.map((t) => t.marker?.color ?? null) ?? [],
      yTitle: gd?.layout?.yaxis?.title?.text ?? null,
      error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    };
  });
  out.paretoSum = out.paretoGlobal.values.reduce((a, b) => a + b, 0);
  check(
    "pareto percentage axis",
    /percent/i.test(out.paretoGlobal.yTitle ?? ""),
    out.paretoGlobal.yTitle
  );
  check("pareto percentages sum to 100", Math.abs(out.paretoSum - 100) < 0.1, out.paretoSum);
  check(
    "pareto one bar colour",
    out.paretoGlobal.colors.length === 1 &&
      out.paretoGlobal.colors.every((c) => c === "#2563eb"),
    out.paretoGlobal.colors
  );
  await page.screenshot({ path: `${shotDir}\\v6-pareto-global.png` });

  // A non-wafer/lot X axis used to overflow the stack in the grouped view.
  await paretoXSelect.selectOption("hbin");
  await page.waitForFunction(
    () => {
      const gd = document.querySelector(".chart-body .js-plotly-plot");
      return (gd?.data?.length ?? 0) > 1;
    },
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(700);
  out.paretoHbin = await page.evaluate(() => ({
    traces: document.querySelector(".chart-body .js-plotly-plot")?.data?.length ?? 0,
    error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
  }));
  check("pareto non-wafer X axis", out.paretoHbin.traces > 1 && !out.paretoHbin.error, out.paretoHbin);
  await page.screenshot({ path: `${shotDir}\\v6-pareto-x-hbin.png` });

  await paretoXSelect.selectOption("lot");
  await page.waitForFunction(
    () => {
      const gd = document.querySelector(".chart-body .js-plotly-plot");
      return (gd?.data?.length ?? 0) > 1;
    },
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(700);
  out.paretoGrouped = await page.evaluate(() => {
    const gd = document.querySelector(".chart-body .js-plotly-plot");
    return {
      traces: gd?.data?.length ?? 0,
      yTitle: gd?.layout?.yaxis?.title?.text ?? null,
      error: document.querySelector(".chart-error-msg")?.textContent?.trim() ?? null,
    };
  });
  check(
    "pareto grouped X axis",
    out.paretoGrouped.traces > 1 && /percent/i.test(out.paretoGrouped.yTitle ?? ""),
    out.paretoGrouped
  );
  await page.screenshot({ path: `${shotDir}\\v6-pareto-x-lot.png` });

  await paretoXSelect.selectOption("none");
  await paretoGroupSelect.selectOption("lot");
  await page.waitForFunction(
    () => document.querySelectorAll(".facet-card.preview").length >= 2,
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(800);
  out.paretoPreviewCount = await page.locator(".facet-card.preview").count();
  out.paretoPreview = await page.evaluate(() => {
    const host = document.querySelector(".facet-card .js-plotly-plot");
    return {
      staticPlot: host?._context?.staticPlot ?? null,
      modebar: document.querySelectorAll(".facet-card .modebar").length,
      ticks: document.querySelectorAll(".facet-card.preview .xtick text").length,
    };
  });
  check("pareto group facets", out.paretoPreviewCount >= 2, out.paretoPreviewCount);
  check(
    "pareto previews static",
    out.paretoPreview.staticPlot === true && out.paretoPreview.modebar === 0,
    out.paretoPreview
  );
  check("pareto preview has no axis labels", out.paretoPreview.ticks === 0, out.paretoPreview.ticks);
  await page.screenshot({ path: `${shotDir}\\v6-pareto-facets.png` });
  await page.locator(".facet-open").first().click();
  await page.waitForSelector(".facet-detail", { timeout: 30000 });
  await page.waitForTimeout(900);
  out.paretoDetailTicks = await page.locator(".facet-detail .xtick text").count();
  check("pareto detail has axis labels", out.paretoDetailTicks > 0, out.paretoDetailTicks);
  await page.screenshot({ path: `${shotDir}\\v6-pareto-detail.png` });
  await page.locator(".facet-detail .map-detail-back").click();
  await page.waitForTimeout(500);

  // Map: default all-wafer mean; Group by creates map-style facets.
  await tab("Wafer map");
  await waitKind("Wafer map");
  await page.waitForSelector(".map-wrap .map-canvas:not(.preview)", { timeout: 120000 });
  const map = section("Wafer map");
  const mapGroupSelect = map.locator(".field", { hasText: "Group by" }).locator("select");
  out.mapDefaults = {
    value: await mapGroupSelect.inputValue(),
    options: await mapGroupSelect.locator("option").allInnerTexts(),
    single: await page.locator(".map-wrap .map-canvas:not(.preview)").count(),
    facets: await page.locator(".map-facets .facet-card").count(),
  };
  check("map default all-wafer mean", out.mapDefaults.value === "none", out.mapDefaults);
  check("map default is a single map", out.mapDefaults.single === 1 && out.mapDefaults.facets === 0, out.mapDefaults);
  check(
    "map group labels",
    out.mapDefaults.options[0] === "Wafer ID (OCR)" &&
      out.mapDefaults.options[1] === "Lot" &&
      out.mapDefaults.options[2] === "All wafers (mean)",
    out.mapDefaults.options
  );
  await page.screenshot({ path: `${shotDir}\\v6-map-default.png` });

  await mapGroupSelect.selectOption("lot");
  await page.waitForFunction(
    () => document.querySelectorAll(".map-facets .facet-card").length >= 2,
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(700);
  out.mapLotCount = await page.locator(".map-facets .facet-card").count();
  check("map lot grouping", out.mapLotCount === out.open.lots.length, out.mapLotCount);
  await page.screenshot({ path: `${shotDir}\\v6-map-lot-split.png` });
  await page.locator(".map-facets .facet-card .map-canvas.preview").first().click();
  await page.waitForSelector(".map-detail", { timeout: 30000 });
  await page.waitForTimeout(800);
  out.mapDetailTitle = await page.locator(".map-detail-title").innerText();
  await page.locator(".map-detail-back").click();
  await page.waitForTimeout(400);

  await mapGroupSelect.selectOption("wafer");
  await page.waitForFunction(
    (n) => document.querySelectorAll(".map-facets .facet-card").length === n,
    out.open.wafers,
    { timeout: 120000 }
  );
  await page.waitForTimeout(700);
  out.mapWaferCount = await page.locator(".map-facets .facet-card").count();
  check("map wafer grouping", out.mapWaferCount === out.open.wafers, out.mapWaferCount);
  await page.screenshot({ path: `${shotDir}\\v6-map-wafer-split.png` });

  await mapGroupSelect.selectOption("none");
  await page.waitForSelector(".map-wrap .map-canvas:not(.preview)", { timeout: 120000 });
  out.mapSingle = await page.locator(".map-wrap .map-canvas:not(.preview)").count();
  check("map all-wafer single", out.mapSingle === 1, out.mapSingle);
  const mapLimits = section("Colour limits");
  out.mapSpecDisabled = await mapLimits.locator('option[value="spec"]').isDisabled();
  check("map spec colour range available", !out.mapSpecDisabled, out.mapSpecDisabled);
  await mapLimits.locator("select").selectOption("spec");
  await page.waitForTimeout(900);
  out.mapLimitLabels = await mapLimits.locator(".field-label").allInnerTexts();
  check(
    "map spec range shows LSL/USL",
    out.mapLimitLabels.includes("LSL") && out.mapLimitLabels.includes("USL"),
    out.mapLimitLabels
  );
  await page.screenshot({ path: `${shotDir}\\v6-map-spec-limits.png` });

  // Switching away from a map must never render the previous map while the
  // next plot type is loading.
  await page.evaluate(() => {
    window.__mapSeenAfterBox = false;
    window.__afterBoxClick = false;
    window.__mapObserver = new MutationObserver(() => {
      if (window.__afterBoxClick && document.querySelector(".map-wrap")) {
        window.__mapSeenAfterBox = true;
      }
    });
    window.__mapObserver.observe(document.querySelector(".chart-body"), {
      childList: true,
      subtree: true,
    });
  });
  await page.evaluate(() => {
    window.__afterBoxClick = true;
  });
  await page.locator(".tab", { hasText: "Box plot" }).click();
  await page.waitForTimeout(80);
  out.mapFlashImmediate = await page.evaluate(() => !!document.querySelector(".map-wrap"));
  await page.waitForTimeout(900);
  out.mapFlashSeen = await page.evaluate(() => window.__mapSeenAfterBox);
  check(
    "no stale map flash",
    out.mapFlashImmediate === false && out.mapFlashSeen === false,
    { immediate: out.mapFlashImmediate, seen: out.mapFlashSeen }
  );

  // Bin map: HBIN/SBIN toggle and detail title.
  await tab("Bin map");
  await waitKind("Bin map");
  await page.waitForSelector(".binmap-tile", { timeout: 60000 });
  const binmap = section("Bin map");
  out.binOptions = await binmap.locator(".seg button").allInnerTexts();
  check("bin toggle labels", JSON.stringify(out.binOptions) === JSON.stringify(["HBIN", "SBIN"]), out.binOptions);
  await binmap.locator(".seg button", { hasText: "SBIN" }).click();
  await page.waitForTimeout(900);
  await page.locator(".binmap-open").first().click();
  await page.waitForSelector(".map-detail", { timeout: 30000 });
  out.binDetailTitle = await page.locator(".map-detail-title").innerText();
  check("SBIN detail title", out.binDetailTitle.includes("SBIN"), out.binDetailTitle);
  await page.screenshot({ path: `${shotDir}\\v6-binmap-sbin.png` });
  await page.locator(".map-detail-back").click();
  await page.waitForTimeout(400);

  // Report: grouped map + split histogram + one composite bin map.
  await tab("Wafer map");
  await waitKind("Wafer map");
  const map2 = section("Wafer map");
  await map2.locator(".field", { hasText: "Group by" }).locator("select").selectOption("lot");
  await page.waitForTimeout(900);
  await page.locator('button[title="Add this plot to the report"]').click();
  await page.waitForTimeout(400);
  await page.locator('.drawer-head button[title="Close"]').click().catch(() => undefined);

  await tab("Histogram");
  await waitKind("Histogram");
  await page.locator('button[title="Add this plot to the report"]').click();
  await page.waitForTimeout(400);
  await page.locator('.drawer-head button[title="Close"]').click().catch(() => undefined);

  await tab("Bin map");
  await waitKind("Bin map");
  await page.locator('button[title="Add this plot to the report"]').click();
  await page.waitForTimeout(400);
  await page.locator('.drawer-head button[title="Close"]').click().catch(() => undefined);

  await tab("Pareto");
  await waitKind("Pareto");
  await page.locator('button[title="Add this plot to the report"]').click();
  await page.waitForTimeout(400);
  await page.locator('.drawer-head button[title="Close"]').click().catch(() => undefined);

  await page.locator('button[title="Open the report builder"]').click();
  await page.waitForTimeout(500);
  await page.locator(".drawer-foot button.btn.primary").click();
  await page
    .waitForFunction(
      () => {
        const t = document.querySelector(".toast")?.textContent ?? "";
        const e = document.querySelector(".error-banner")?.textContent ?? "";
        return t.includes("Report ready") || e.length > 0;
      },
      { timeout: 180000 }
    )
    .catch(() => undefined);
  out.reportToast = await page.locator(".toast").innerText().catch(() => null);
  out.reportError = await page.locator(".error-banner").innerText().catch(() => null);
  out.reportFiles = readdirSync(reportDir)
    .sort()
    .map((name) => ({ name, size: statSync(`${reportDir}\\${name}`).size }));
  const reportJson = JSON.parse(readFileSync(`${reportDir}\\report.json`, "utf8"));
  out.reportSpecs = reportJson.plots.map((p) => ({
    type: p.spec.type,
    xAxis: p.spec.xAxis,
    groupBy: p.spec.groupBy,
    splitPlots: p.spec.splitPlots,
    binCategory: p.spec.binCategory,
  }));
  check("report generated", out.reportFiles.length > 3, out.reportFiles);
  check(
    "report map grouped",
    out.reportSpecs.some((p) => p.type === "map" && p.groupBy === "lot"),
    out.reportSpecs
  );
  check(
    "report hist split",
    out.reportSpecs.some((p) => p.type === "hist" && p.splitPlots === true),
    out.reportSpecs
  );
  check(
    "report pareto group facets",
    out.reportSpecs.some(
      (p) => p.type === "pareto" && p.groupBy === "lot" && p.xAxis === "none"
    ),
    out.reportSpecs
  );
  const paretoImages = out.reportFiles.filter((f) => /pareto/i.test(f.name));
  check("report pareto has one image per lot", paretoImages.length === out.open.lots.length, paretoImages);
  check(
    "report binmap SBIN",
    out.reportSpecs.some((p) => p.type === "binmap" && p.binCategory === "soft"),
    out.reportSpecs
  );
  const binImages = out.reportFiles.filter((f) => /bin_map/i.test(f.name));
  check("one composite bin map image", binImages.length === 1, binImages);

  out.failures = failures;
  out.passed = failures.length === 0;
  out.browser = version.Browser;
  console.log(JSON.stringify(out, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (e) {
  out.fatal = String(e);
  out.failures = failures;
  console.error(e);
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
  } catch {
    /* ignore */
  }
  child.kill();
}

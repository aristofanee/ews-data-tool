// Focused post-v0.3.2 regression checks for the Pareto, scatter and map fixes.
// Runs against the real Tauri desktop app and the reference STDF fixtures.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { desktopExecutable, referenceStdfFiles, repoPath } from "./harness-paths.mjs";
const exe = desktopExecutable();
const stdf = referenceStdfFiles();
if (!existsSync(exe)) throw new Error(`Missing ${exe}`);
if (!stdf.length) throw new Error("No STDF fixtures found");

const shotDir = repoPath("shots");
mkdirSync(shotDir, { recursive: true });
const integerCsv = `${shotDir}\\v4-integers.csv`;
const manyCsv = `${shotDir}\\v4-many-wafers.csv`;

const intLines = ["LOT,WAFER,X,Y,HBIN,DeviceNumber,StepCount"];
for (let i = 0; i < 4500; i++) {
  intLines.push(`L1,01,${i % 90},${Math.floor(i / 90)},1,${i + 1},${(i % 350) + 1}`);
}
writeFileSync(integerCsv, intLines.join("\n"));

const manyLines = ["LOT,WAFER,X,Y,HBIN,TestA,TestB"];
for (let w = 0; w < 16; w++) {
  for (let i = 0; i < 3000; i++) {
    const a = 10 + w * 0.5 + (i % 17) * 0.1;
    const b = 2 * a + ((i * 7 + w * 3) % 19) * 0.05;
    manyLines.push(
      `L1,W${String(w + 1).padStart(2, "0")},${i % 60},${Math.floor(i / 60)},1,${a.toFixed(3)},${b.toFixed(3)}`
    );
  }
}
writeFileSync(manyCsv, manyLines.join("\n"));

const port = 9339;
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
      /* not up yet */
    }
    await sleep(250);
  }
  if (!version) throw new Error("WebView2 CDP endpoint did not start");
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
  if (!page) throw new Error("No WebView2 page found");
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
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

  const open = async (paths) => {
    await page.evaluate(
      async (paths) => await window.__TAURI_INTERNALS__.invoke("open_paths", { paths }),
      paths
    );
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForSelector(".js-plotly-plot", { timeout: 180000 });
    await page.waitForTimeout(1600);
  };

  const tab = async (label) => {
    await page.locator(".tab", { hasText: label }).click();
    await page.waitForTimeout(900);
  };

  const waitPlot = async (kind) => {
    await page.waitForFunction(
      (k) => document.querySelector(".plot-kind")?.textContent?.trim() === k,
      kind,
      { timeout: 180000 }
    );
    await page.waitForTimeout(900);
  };

  const readPlot = () =>
    page.evaluate(() => {
      const gd = document.querySelector(".js-plotly-plot");
      if (!gd) return null;
      const layout = gd.layout || {};
      const full = gd._fullLayout || {};
      return {
        title: full.title?.text ?? layout.title?.text ?? "",
        shapes: (layout.shapes ?? []).map((s) => ({
          type: s.type,
          layer: s.layer,
          x0: s.x0,
          x1: s.x1,
        })),
        traces: (gd.data ?? []).map((t) => ({
          name: t.name ?? "",
          type: t.type,
          x: Array.isArray(t.x) ? t.x : [],
          customdata: t.customdata ?? null,
        })),
      };
    });

  const facetInfo = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".facet-card")).map((card) => {
        const gd = card.querySelector(".js-plotly-plot");
        const label = card.querySelector(".facet-label")?.textContent ?? "";
        if (!gd) return { label, mounted: false, title: "", shapes: [] };
        const layout = gd.layout || {};
        const full = gd._fullLayout || {};
        return {
          label,
          mounted: true,
          title: full.title?.text ?? layout.title?.text ?? "",
          shapes: (layout.shapes ?? []).map((s) => ({ type: s.type, layer: s.layer })),
        };
      })
    );

  const statValue = async (label) => {
    const loc = page.locator(".stats .stat", { hasText: label }).locator(".stat-v");
    if ((await loc.count()) === 0) return null;
    return (await loc.first().innerText()).trim();
  };

  const hoverScan = async () => {
    const box = await page.locator(".map-canvas").boundingBox();
    if (!box) return [];
    const values = new Set();
    for (let gy = 0.12; gy <= 0.88; gy += 0.08) {
      for (let gx = 0.12; gx <= 0.88; gx += 0.08) {
        await page.mouse.move(box.x + box.width * gx, box.y + box.height * gy);
        await page.waitForTimeout(16);
        const tip = await page.locator(".map-tip-value").innerText().catch(() => null);
        if (tip) {
          const first = tip.trim().split(/\s+/)[0];
          if (first) values.add(first);
        }
      }
    }
    return [...values];
  };

  const dispatchHover = (count) =>
    page.evaluate((count) => {
      const canvas = document.querySelector(".map-canvas");
      if (!canvas) return null;
      const r = canvas.getBoundingClientRect();
      const t0 = performance.now();
      for (let i = 0; i < count; i++) {
        const gx = 0.1 + 0.8 * ((i % 25) / 24);
        const gy = 0.1 + 0.8 * (Math.floor(i / 25) / Math.ceil(count / 25 - 1));
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            cancelable: true,
            clientX: r.left + r.width * gx,
            clientY: r.top + r.height * gy,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
          })
        );
      }
      return performance.now() - t0;
    }, count);

  const pinch = async () => {
    const box = await page.locator(".map-canvas").boundingBox();
    if (!box) return null;
    await page.evaluate(
      ({ x, y }) => {
        const canvas = document.querySelector(".map-canvas");
        canvas?.dispatchEvent(
          new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY: -12,
            ctrlKey: true,
            clientX: x,
            clientY: y,
          })
        );
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    );
    await page.waitForTimeout(350);
    return page.locator(".map-hint").innerText();
  };

  const setOutlier = async (kind, k) => {
    const block = page.locator(".filter-block", { hasText: "Outlier filter" });
    await block.locator("select").selectOption(kind);
    await page.waitForTimeout(250);
    if (kind !== "none") {
      const input = block.locator(".stat-row input[type=number]");
      await input.fill(String(k));
      await input.press("Tab");
    }
    await page.waitForTimeout(1600);
  };

  await open(stdf);
  out.stdfMeta = await page.locator(".dataset-meta").innerText();

  /* Pareto: no pass bin, no Plotly title in global or grouped mode. */
  await tab("Pareto");
  await waitPlot("Pareto");
  const paretoGlobal = await readPlot();
  const globalCustom = paretoGlobal?.traces?.[0]?.customdata ?? [];
  out.paretoGlobalTitle = paretoGlobal?.title ?? null;
  out.paretoGlobalLabels = paretoGlobal?.traces?.[0]?.x?.slice(0, 8) ?? [];
  out.paretoGlobalHasPass = Array.isArray(globalCustom)
    ? globalCustom.some((row) => Array.isArray(row) && row[2] === "pass")
    : false;
  check("global Pareto has no title", out.paretoGlobalTitle === "", out.paretoGlobalTitle);
  check("global Pareto has failure bars", (paretoGlobal?.traces?.[0]?.x?.length ?? 0) > 0);
  check("global Pareto excludes pass bin", !out.paretoGlobalHasPass, out.paretoGlobalLabels);

  const paretoSection = page.locator(".insp-section", { hasText: "Pareto" });
  await paretoSection.locator("select").selectOption("lot");
  await page.waitForTimeout(1400);
  const paretoGrouped = await readPlot();
  out.paretoGroupedTitle = paretoGrouped?.title ?? null;
  out.paretoGroupedNames = paretoGrouped?.traces?.map((t) => t.name) ?? [];
  out.paretoGroupedHasPass = out.paretoGroupedNames.some((n) => /^pass$/i.test(n));
  check("grouped Pareto has no title", out.paretoGroupedTitle === "", out.paretoGroupedTitle);
  check("grouped Pareto excludes pass bin", !out.paretoGroupedHasPass, out.paretoGroupedNames);
  check(
    "grouped Pareto keeps good-yield line",
    out.paretoGroupedNames.some((n) => /good yield/i.test(n)),
    out.paretoGroupedNames
  );

  /* Scatter: fit line is a layout shape above WebGL/SVG traces. */
  await tab("Scatter");
  await waitPlot("Scatter");
  const scatter = await readPlot();
  out.scatterFitAbove = scatter?.shapes?.some((s) => s.layer === "above") ?? false;
  check("scatter fit line uses layer=above", out.scatterFitAbove, scatter?.shapes);

  const scatterSection = page.locator(".insp-section", { hasText: "Z colour" });
  await scatterSection.locator(".seg button", { hasText: "Category" }).click();
  await page.waitForTimeout(900);
  const categorySelect = scatterSection
    .locator(".field", { hasText: "Z category" })
    .locator("select");
  await categorySelect.selectOption("wafer");
  await page.waitForTimeout(1300);
  const splitCheck = scatterSection
    .locator("label.check-row", { hasText: "Split into one plot per category" })
    .locator("input");
  const splitStart = Date.now();
  await splitCheck.check();
  await page.waitForSelector(".facet-card .js-plotly-plot", { timeout: 120000 });
  out.scatterSplitFirstMs = Date.now() - splitStart;
  await page.waitForTimeout(1700);
  const stdfFacets = await facetInfo();
  out.scatterSplitFacets = stdfFacets.length;
  out.scatterSplitMounted = stdfFacets.filter((f) => f.mounted).length;
  out.scatterSplitTitles = stdfFacets.filter((f) => f.mounted).map((f) => f.title);
  out.scatterSplitFitAbove = stdfFacets
    .filter((f) => f.mounted)
    .every((f) => f.shapes.some((s) => s.layer === "above"));
  check("split scatter has facets", stdfFacets.length > 1, stdfFacets.length);
  check(
    "split scatter facets have no titles",
    out.scatterSplitTitles.every((t) => t === ""),
    out.scatterSplitTitles
  );
  check("split scatter fit lines use layer=above", out.scatterSplitFitAbove);
  await splitCheck.uncheck();
  await page.waitForTimeout(1400);

  /* Map: mean default, integer tooltips, outlier filter, pinch and hover cost. */
  await tab("Wafer map");
  await waitPlot("Wafer map");
  await page.waitForSelector(".map-canvas", { timeout: 60000 });
  await page.waitForTimeout(700);
  out.mapDefaultHint = await page.locator(".map-hint").innerText();
  out.mapHoverMs = await dispatchHover(300);
  await page.waitForTimeout(250);

  await page.locator(".test-row", { hasText: "indice" }).first().click();
  await page.waitForTimeout(1600);
  out.mapIntegerTips = await hoverScan();
  const integerTips = out.mapIntegerTips.filter((v) => /^\d+$/.test(v));
  const decimalIntegerTips = out.mapIntegerTips.filter((v) => /^\d+\.000$/.test(v));
  out.mapIntegerTipCount = integerTips.length;
  out.mapDecimalIntegerTips = decimalIntegerTips;
  check("STDF map shows integer values without .000", integerTips.length > 0 && decimalIntegerTips.length === 0, out.mapIntegerTips.slice(0, 12));

  const mapDiceBefore = await statValue("Dice");
  await setOutlier("sigma", 0.1);
  const mapDiceAfter = await statValue("Dice");
  out.mapOutlierDiceBefore = mapDiceBefore;
  out.mapOutlierDiceAfter = mapDiceAfter;
  out.mapOutlierExcluded = await statValue("Excluded");
  check(
    "map outlier filter removes dice",
    mapDiceBefore !== null && mapDiceAfter !== null && Number(mapDiceAfter.replace(/,/g, "")) < Number(mapDiceBefore.replace(/,/g, "")),
    { before: mapDiceBefore, after: mapDiceAfter, excluded: out.mapOutlierExcluded }
  );
  check("map outlier filter reports excluded dice", Number((out.mapOutlierExcluded ?? "0").replace(/,/g, "")) > 0, out.mapOutlierExcluded);

  out.mapPinchHint = await pinch();
  out.mapPinchZoomed = /\d+\.\d+×/.test(out.mapPinchHint ?? "");
  check("map ctrl+wheel pinch zooms", out.mapPinchZoomed, out.mapPinchHint);
  await page.screenshot({ path: `${shotDir}\\v4-stdf-map.png` });

  /* CSV with 4,500 integer dice: formatting, hover cost and outlier filter. */
  await open([integerCsv]);
  await tab("Wafer map");
  await waitPlot("Wafer map");
  await page.waitForSelector(".map-canvas", { timeout: 60000 });
  await page.waitForTimeout(900);
  out.csvActiveTest = await page.locator(".test-row.active").innerText().catch(() => null);
  out.csvHint = await page.locator(".map-hint").innerText();
  out.csvTips = await hoverScan();
  out.csvIntegerTips = out.csvTips.filter((v) => /^[\d,]+$/.test(v));
  out.csvDecimalTips = out.csvTips.filter((v) => /\.\d{3}$/.test(v));
  check("CSV map shows integer device numbers", out.csvIntegerTips.length > 0 && out.csvDecimalTips.length === 0, out.csvTips.slice(0, 12));
  out.csvHoverMs = await dispatchHover(300);
  await page.waitForTimeout(250);

  const csvDiceBefore = await statValue("Dice");
  await setOutlier("sigma", 0.1);
  const csvDiceAfter = await statValue("Dice");
  out.csvOutlierDiceBefore = csvDiceBefore;
  out.csvOutlierDiceAfter = csvDiceAfter;
  out.csvOutlierExcluded = await statValue("Excluded");
  check(
    "CSV map outlier filter removes dice",
    csvDiceBefore !== null && csvDiceAfter !== null && Number(csvDiceAfter.replace(/,/g, "")) < Number(csvDiceBefore.replace(/,/g, "")),
    { before: csvDiceBefore, after: csvDiceAfter, excluded: out.csvOutlierExcluded }
  );
  out.csvPinchHint = await pinch();
  out.csvPinchZoomed = /\d+\.\d+×/.test(out.csvPinchHint ?? "");
  check("CSV map ctrl+wheel pinch zooms", out.csvPinchZoomed, out.csvPinchHint);
  await page.screenshot({ path: `${shotDir}\\v4-csv-map.png` });

  /* Many-category split scatter: only nearby facets are built up front. */
  await open([manyCsv]);
  await tab("Scatter");
  await waitPlot("Scatter");
  const manySection = page.locator(".insp-section", { hasText: "Z colour" });
  await manySection.locator(".seg button", { hasText: "Category" }).click();
  await page.waitForTimeout(800);
  await manySection
    .locator(".field", { hasText: "Z category" })
    .locator("select")
    .selectOption("wafer");
  await page.waitForTimeout(1300);
  const manySplit = manySection
    .locator("label.check-row", { hasText: "Split into one plot per category" })
    .locator("input");
  const manyStart = Date.now();
  await manySplit.check();
  await page.waitForSelector(".facet-card .js-plotly-plot", { timeout: 180000 });
  out.manySplitFirstMs = Date.now() - manyStart;
  await page.waitForTimeout(1800);
  const manyFacets = await facetInfo();
  out.manySplitFacets = manyFacets.length;
  out.manySplitMounted = manyFacets.filter((f) => f.mounted).length;
  out.manySplitTitlesEmpty = manyFacets.filter((f) => f.mounted).every((f) => f.title === "");
  out.manySplitFitAbove = manyFacets
    .filter((f) => f.mounted)
    .every((f) => f.shapes.some((s) => s.layer === "above"));
  check("many-category split has 16 facets", manyFacets.length === 16, manyFacets.length);
  check("many-category split mounts only nearby facets", out.manySplitMounted < manyFacets.length, {
    mounted: out.manySplitMounted,
    facets: manyFacets.length,
  });
  check("many-category split facets have no titles", out.manySplitTitlesEmpty);
  check("many-category split fit lines use layer=above", out.manySplitFitAbove);
  await page.locator(".facet-grid").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(1600);
  const manyAfter = await facetInfo();
  out.manySplitMountedAfterScroll = manyAfter.filter((f) => f.mounted).length;
  check(
    "scrolling mounts more split facets",
    out.manySplitMountedAfterScroll > out.manySplitMounted,
    { before: out.manySplitMounted, after: out.manySplitMountedAfterScroll }
  );
  await page.screenshot({ path: `${shotDir}\\v4-many-scatter-split.png` });

  out.failures = failures;
  out.passed = failures.length === 0;
  console.log(JSON.stringify(out, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  child.kill();
}

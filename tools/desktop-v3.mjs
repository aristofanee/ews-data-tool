// v0.3 focused desktop checks: Bin map, split maps, report split cluster,
// CSV manual mapping, tiny-number export and limit-conflict detection.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";

const exe = "D:\\test_matlabtool\\src-tauri\\target\\release\\ews-data-tool.exe";
const dataDir = `${process.env.TEMP}\\pystdf\\pystdf-main\\data`;
const files = ["demofile.stdf.Z", "lot2.stdf", "lot3.stdf"]
  .map((f) => `${dataDir}\\${f}`)
  .filter((p) => existsSync(p));
const port = 9335;
const shotDir = "D:\\test_matlabtool\\shots";
const reportDir = `${shotDir}\\report-v3`;
const tinyCsv = `${shotDir}\\v3-tiny.csv`;
const mapCsv = `${shotDir}\\v3-map.csv`;
const limitA = `${shotDir}\\v3-limit-a.csv`;
const limitB = `${shotDir}\\v3-limit-b.csv`;
mkdirSync(shotDir, { recursive: true });
rmSync(reportDir, { recursive: true, force: true });
mkdirSync(reportDir, { recursive: true });

writeFileSync(
  tinyCsv,
  "Lot,Wafer,X,Y,HBIN,Leak [A]\nL1,01,0,0,1,1.2e-15\nL1,01,1,0,1,2.3e-12\n"
);
writeFileSync(
  mapCsv,
  "LOTX,WAFERX,COLX,ROWX,H1,S1,T1\nLOT-M,01,0,0,1,1,0.5\nLOT-M,01,1,0,1,1,0.6\n"
);
writeFileSync(
  limitA,
  "Lot,Wafer,X,Y,HBIN,Vt\nTests#,,,,,101\nUnit,,,,,V\nLowL,,,,,0.3\nHighL,,,,,0.5\nLOT-L,01,0,0,1,0.4\n"
);
writeFileSync(
  limitB,
  "Lot,Wafer,X,Y,HBIN,Vt\nTests#,,,,,101\nUnit,,,,,V\nLowL,,,,,0.1\nHighL,,,,,0.2\nLOT-L,02,0,0,1,0.15\n"
);

const child = spawn(exe, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => console.error("[app]", d.toString().trim()));
child.stderr.on("data", (d) => console.error("[app!]", d.toString().trim()));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser = null;
const out = {};
try {
  let version = null;
  for (let i = 0; i < 100; i++) {
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
    const pages = browser.contexts().flatMap((c) => c.pages());
    page = pages.find((p) => !p.url().startsWith("devtools://")) ?? null;
    if (page) break;
    await sleep(250);
  }
  if (!page) throw new Error("No page");
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  for (let i = 0; i < 100; i++) {
    const ready = await page
      .evaluate(() => location.href.includes("tauri.localhost") && !!window.__TAURI_INTERNALS__)
      .catch(() => false);
    if (ready) break;
    await sleep(250);
  }

  out.open = await page.evaluate(async (paths) => {
    const info = await window.__TAURI_INTERNALS__.invoke("open_paths", { paths });
    return { rows: info.rows, tests: info.tests.length, lots: info.lots };
  }, files);
  await page.evaluate((dir) => localStorage.setItem("ews-report-folder", dir), reportDir);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForSelector(".js-plotly-plot", { timeout: 60000 });
  await page.waitForTimeout(1200);

  const tab = async (label) => {
    await page.locator(".tab", { hasText: label }).click();
    await page.waitForTimeout(1000);
  };

  // Bin map tab and the shared full-size map detail view.
  await tab("Bin map");
  await page.waitForSelector(".binmap-tile", { timeout: 60000 });
  out.binMapTiles = await page.locator(".binmap-tile").count();
  await page.screenshot({ path: `${shotDir}\\v3-01-binmap.png` });
  await page.locator(".binmap-open").first().click();
  await page.waitForSelector(".map-detail", { timeout: 30000 });
  out.binMapDetail = await page.locator(".map-detail-title").innerText();
  out.binMapStats = await page.locator(".map-detail-stats").innerText();
  await page.screenshot({ path: `${shotDir}\\v3-02-binmap-detail.png` });
  const binDetailFirst = out.binMapDetail;
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  out.binMapNext = await page.locator(".map-detail-title").innerText();
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  out.binMapBackToFirst = (await page.locator(".map-detail-title").innerText()) === binDetailFirst;
  await page.locator(".map-detail-back").click();
  await page.waitForSelector(".binmap-tile", { timeout: 30000 });

  // Wafer map defaults to the all-wafer mean, then split value maps.
  await tab("Wafer map");
  await page.waitForSelector(".map-wrap", { timeout: 60000 });
  out.meanMapHint = await page.locator(".map-hint").innerText();
  out.meanMapScope = await page
    .locator(".stats .stat", { hasText: "Scope" })
    .innerText()
    .catch(() => null);
  const mapSection = page.locator(".insp-section", { hasText: "Wafer map" });
  await mapSection
    .locator("label.check-row", { hasText: "Split into one map per wafer" })
    .locator("input")
    .check();
  await page.waitForSelector(".map-facets .facet-card", { timeout: 60000 });
  out.mapFacets = await page.locator(".map-facets .facet-card").count();
  await page.screenshot({ path: `${shotDir}\\v3-03-map-split.png` });
  await page.locator(".map-facets .facet-map canvas").first().click();
  await page.waitForSelector(".map-detail", { timeout: 30000 });
  out.mapSplitDetail = await page.locator(".map-detail-title").innerText();
  await page.locator(".map-detail-back").click();
  await page.waitForSelector(".map-facets .facet-card", { timeout: 30000 });

  // Add split maps to the report and generate a cluster.
  await page.locator('button[title="Add this plot to the report"]').click();
  await page.waitForTimeout(500);
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
  out.reportSplit = reportJson.plots?.[0]?.spec?.splitPlots;
  out.reportClusterHeading = readFileSync(`${reportDir}\\index.html`, "utf8").includes(
    'class="cluster"'
  );

  // CSV manual mapping through the same Rust command the dialog uses.
  out.inspect = await page.evaluate(async (path) => {
    return await window.__TAURI_INTERNALS__.invoke("inspect_csv", { path });
  }, mapCsv);
  out.mappedImport = await page.evaluate(async (path) => {
    const mapping = { lot: 0, wafer: 1, x: 2, y: 3, hbin: 4, sbin: 5 };
    const info = await window.__TAURI_INTERNALS__.invoke("open_paths", { paths: [path], mapping });
    return { rows: info.rows, lots: info.lots, tests: info.tests.map((t) => t.name) };
  }, mapCsv);

  // Tiny values must survive export in scientific notation.
  out.tinyOpen = await page.evaluate(async (path) => {
    const info = await window.__TAURI_INTERNALS__.invoke("open_paths", { paths: [path] });
    return { rows: info.rows, tests: info.tests.length };
  }, tinyCsv);
  out.tinyExport = await page.evaluate(async (path) => {
    return await window.__TAURI_INTERNALS__.invoke("export_csv", { path, filter: {} });
  }, `${shotDir}\\v3-tiny-export.csv`);
  out.tinyExportHasSci = readFileSync(`${shotDir}\\v3-tiny-export.csv`, "utf8").includes("1.2e-15");

  // Different limits in two files should raise the conflict flag, not silently
  // pretend the first lot's limits apply everywhere.
  out.limitConflict = await page.evaluate(async (paths) => {
    const info = await window.__TAURI_INTERNALS__.invoke("open_paths", { paths });
    const t = info.tests.find((x) => x.name === "Vt");
    return { lo: t?.loSpec, hi: t?.hiSpec, conflict: t?.limitConflict };
  }, [limitA, limitB]);

  out.browser = version.Browser;
} catch (e) {
  out.fatal = String(e);
  console.error(e);
} finally {
  console.log(JSON.stringify(out, null, 2));
  try {
    await browser?.close();
  } catch {
    /* ignore */
  }
  child.kill();
}

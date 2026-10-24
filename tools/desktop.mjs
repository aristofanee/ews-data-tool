// End-to-end test of the real Tauri desktop app through WebView2's CDP port.
//
// It launches the release exe, loads the reference STDF files through the same
// Rust command the Open dialog uses, reloads the webview (exercising dataset
// hydration), captures a screenshot, and checks clipboard + file writes.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";

const exe = "D:\\test_matlabtool\\src-tauri\\target\\release\\ews-data-tool.exe";
const dataDir = `${process.env.TEMP}\\pystdf\\pystdf-main\\data`;
const files = ["demofile.stdf", "lot2.stdf", "lot3.stdf"]
  .map((f) => `${dataDir}\\${f}`)
  .filter((p) => existsSync(p));
const port = 9333;
const reportDir = "D:\\test_matlabtool\\shots\\report-test";

if (!existsSync(exe)) throw new Error(`Missing ${exe}`);
if (!files.length) throw new Error("No STDF samples found");
rmSync(reportDir, { recursive: true, force: true });
mkdirSync(reportDir, { recursive: true });

const child = spawn(exe, [], {
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  },
  stdio: "ignore",
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version = null;
for (let i = 0; i < 80; i++) {
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
if (!version) {
  child.kill();
  throw new Error("WebView2 CDP endpoint did not start");
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
let page = null;
for (let i = 0; i < 40; i++) {
  const pages = browser.contexts().flatMap((c) => c.pages());
  page = pages.find((p) => !p.url().startsWith("devtools://")) ?? null;
  if (page) break;
  await sleep(250);
}
if (!page) {
  child.kill();
  throw new Error("No WebView2 page found");
}
await page.waitForLoadState("domcontentloaded").catch(() => undefined);

const out = {
  url: page.url(),
  browser: version.Browser,
  files,
  tauri: await page.evaluate(() => ({
    internals: typeof window.__TAURI_INTERNALS__,
    secure: window.isSecureContext,
    clipboard: typeof navigator.clipboard,
    write: typeof navigator.clipboard?.write,
    clipboardItem: typeof ClipboardItem,
  })),
};

// Load through the real Rust command.
out.open = await page.evaluate(async (paths) => {
  try {
    const info = await window.__TAURI_INTERNALS__.invoke("open_paths", { paths });
    return {
      ok: true,
      rows: info.rows,
      tests: info.tests.length,
      lots: info.lots,
      wafers: info.wafers.length,
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}, files);

// Point the report builder at a known folder before the reload, so the
// drawer picks it up from localStorage without a native folder dialog.
await page.evaluate((dir) => localStorage.setItem("ews-report-folder", dir), reportDir);

// Reload and let the hydration effect restore the dataset.
await page.reload({ waitUntil: "domcontentloaded" }).catch((e) => (out.reloadError = String(e)));
await page.waitForTimeout(1800);
await page.waitForSelector(".js-plotly-plot", { timeout: 60000 }).catch(() => undefined);
await page.waitForTimeout(1200);

out.title = await page.title();
out.meta = await page.locator(".dataset-meta").innerText().catch(() => null);
out.activeTest = {
  name: await page.locator(".test-row.active .test-name").innerText().catch(() => null),
  units: await page.locator(".test-row.active .test-units").innerText().catch(() => null),
};
out.chips = await page.locator(".chip").allInnerTexts().catch(() => []);
out.axisTitle = await page.locator(".ytitle").innerText().catch(() => null);
out.limitLabels = await page.locator(".annotation-text").allInnerTexts().catch(() => []);
await page.screenshot({ path: "shots/desktop-stdf.png" });

// Clipboard through the native plugin.
await page.locator('button[title="Copy image to clipboard"]').click().catch(() => undefined);
await page.waitForTimeout(3000);
out.copyToast = await page.locator(".toast").innerText().catch(() => null);
out.copyError = await page.locator(".error-banner").innerText().catch(() => null);

// Chart tabs on real data.
const shotTab = async (label, path) => {
  await page.locator(".tab", { hasText: label }).click().catch(() => undefined);
  await page.waitForTimeout(1600);
  await page.screenshot({ path });
  return await page
    .locator(".plot-kind")
    .innerText()
    .catch(() => null);
};
out.mapKind = await shotTab("Wafer map", "shots/desktop-map.png");
out.mapStats = await page.locator(".stats").innerText().catch(() => null);
out.mapHint = await page.locator(".map-hint").innerText().catch(() => null);
out.paretoKind = await shotTab("Pareto", "shots/desktop-pareto.png");
out.paretoStats = await page.locator(".stats").innerText().catch(() => null);
out.paretoTicks = await page.locator(".xtick text").allInnerTexts().catch(() => []);
out.histKind = await shotTab("Histogram", "shots/desktop-hist.png");
out.histStats = await page.locator(".stats").innerText().catch(() => null);
await page.locator(".tab", { hasText: "Box plot" }).click().catch(() => undefined);
await page.waitForTimeout(1000);

// Batch report on disk: add one of each plot, then generate into reportDir.
const addCurrent = async () => {
  await page.locator('button[title="Add this plot to the report"]').click().catch(() => undefined);
  await page.waitForTimeout(300);
  // Adding a plot opens the report drawer; close it before switching tabs.
  await page.locator('.drawer-head button[title="Close"]').click().catch(() => undefined);
  await page.waitForTimeout(300);
};
await addCurrent();
await page.locator(".tab", { hasText: "Wafer map" }).click().catch(() => undefined);
await page.waitForTimeout(1200);
await addCurrent();
await page.locator(".tab", { hasText: "Pareto" }).click().catch(() => undefined);
await page.waitForTimeout(1200);
await addCurrent();
await page.locator(".tab", { hasText: "Histogram" }).click().catch(() => undefined);
await page.waitForTimeout(1200);
await addCurrent();

await page.locator('button[title="Open the report builder"]').click().catch(() => undefined);
await page.waitForTimeout(600);
out.reportFolder = await page.locator(".folder-path").innerText().catch(() => null);
await page.locator(".drawer-foot button.btn.primary").click().catch(() => undefined);
await page
  .waitForFunction(
    () => {
      const toast = document.querySelector(".toast")?.textContent ?? "";
      const error = document.querySelector(".error-banner")?.textContent ?? "";
      return toast.includes("Report ready") || error.length > 0;
    },
    { timeout: 120000 }
  )
  .catch(() => undefined);
out.reportToast = await page.locator(".toast").innerText().catch(() => null);
out.reportError = await page.locator(".error-banner").innerText().catch(() => null);
out.reportFiles = readdirSync(reportDir)
  .sort()
  .map((name) => ({ name, size: statSync(`${reportDir}\\${name}`).size }));

// The same save commands the app uses for JPG and templates.
const png = await page.locator(".js-plotly-plot").screenshot();
out.saveBinary = await page.evaluate(
  async ({ b64, path }) => {
    try {
      await window.__TAURI_INTERNALS__.invoke("save_binary", { path, dataBase64: b64 });
      return "ok";
    } catch (e) {
      return String(e);
    }
  },
  { b64: png.toString("base64"), path: "D:\\test_matlabtool\\shots\\desktop-test.png" }
);
out.saveText = await page.evaluate(async (path) => {
  try {
    await window.__TAURI_INTERNALS__.invoke("save_text", {
      path,
      contents: JSON.stringify({ hello: "world" }),
    });
    return "ok";
  } catch (e) {
    return String(e);
  }
}, "D:\\test_matlabtool\\shots\\desktop-test.json");
out.written = {
  png: existsSync("shots/desktop-test.png") ? statSync("shots/desktop-test.png").size : null,
  json: existsSync("shots/desktop-test.json") ? statSync("shots/desktop-test.json").size : null,
};

// STDF -> CSV converter path.
out.exportCsv = await page.evaluate(async (path) => {
  try {
    return await window.__TAURI_INTERNALS__.invoke("export_csv", { path, filter: {} });
  } catch (e) {
    return String(e);
  }
}, "D:\\test_matlabtool\\shots\\desktop-export.csv");
out.exportSize = existsSync("shots/desktop-export.csv")
  ? statSync("shots/desktop-export.csv").size
  : null;

console.log(JSON.stringify(out, null, 2));
await browser.close();
child.kill();

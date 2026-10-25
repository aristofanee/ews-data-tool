// End-to-end verification of the v0.2 features in the real Tauri desktop app.
//
// It opens the reference lots through the same Rust command as the file picker,
// using the compressed demofile.stdf.Z fixture, then exercises custom label
// columns, OCR/category grouping, scatter modes, box block colours, the report
// writer, the dark theme and the native clipboard.
import { chromium } from "playwright-core";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";

const exe = "D:\\test_matlabtool\\src-tauri\\target\\release\\ews-data-tool.exe";
const dataDir = `${process.env.TEMP}\\pystdf\\pystdf-main\\data`;
const compressed = `${dataDir}\\demofile.stdf.Z`;
const files = [
  existsSync(compressed) ? "demofile.stdf.Z" : "demofile.stdf",
  "lot2.stdf",
  "lot3.stdf",
]
  .map((f) => `${dataDir}\\${f}`)
  .filter((p) => existsSync(p));
const port = 9334;
const reportDir = "D:\\test_matlabtool\\shots\\report-v2";
const shotDir = "D:\\test_matlabtool\\shots";
const clipboardPng = `${shotDir}\\v2-clipboard-dark.png`;

if (!existsSync(exe)) throw new Error(`Missing ${exe}`);
if (!files.length) throw new Error("No STDF samples found");
if (!existsSync(compressed)) throw new Error(`Missing compressed fixture ${compressed}`);
mkdirSync(shotDir, { recursive: true });
rmSync(reportDir, { recursive: true, force: true });
mkdirSync(reportDir, { recursive: true });

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
const out = { files };
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
      /* not up yet */
    }
    await sleep(250);
  }
  if (!version) throw new Error("WebView2 CDP endpoint did not start");
  out.browser = version.Browser;

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page = null;
  for (let i = 0; i < 60; i++) {
    const pages = browser.contexts().flatMap((c) => c.pages());
    page = pages.find((p) => !p.url().startsWith("devtools://")) ?? null;
    if (page) break;
    await sleep(250);
  }
  if (!page) throw new Error("No WebView2 page found");
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);

  for (let i = 0; i < 100; i++) {
    try {
      const ready = await page.evaluate(
        () => location.href.includes("tauri.localhost") && !!window.__TAURI_INTERNALS__
      );
      if (ready) break;
    } catch {
      /* navigating */
    }
    await sleep(250);
  }

  out.open = await page.evaluate(async (paths) => {
    try {
      const info = await window.__TAURI_INTERNALS__.invoke("open_paths", { paths });
      return {
        ok: true,
        rows: info.rows,
        tests: info.tests.length,
        lots: info.lots,
        wafers: info.wafers.map((w) => w.name),
        customColumns: info.customColumns,
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, files);

  await page.evaluate((dir) => localStorage.setItem("ews-report-folder", dir), reportDir);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForSelector(".js-plotly-plot", { timeout: 60000 });
  await page.waitForTimeout(1200);

  const waitPlot = async (kind) => {
    await page.waitForFunction(
      (k) => document.querySelector(".plot-kind")?.textContent?.trim() === k,
      kind,
      { timeout: 60000 }
    );
    await page.waitForTimeout(900);
  };
  const screenshot = async (name) => {
    await page.screenshot({ path: `${shotDir}\\${name}` });
  };
  const tab = async (label) => {
    await page.locator(".tab", { hasText: label }).click();
    await page.waitForTimeout(900);
  };
  const toast = async () => page.locator(".toast").innerText().catch(() => null);
  const error = async () => page.locator(".error-banner").innerText().catch(() => null);

  out.title = await page.title();
  out.meta = await page.locator(".dataset-meta").innerText();
  out.customPanelBefore = await page.locator(".custom-panel").innerText();
  await screenshot("v2-01-loaded.png");

  /* ---------------------------------------------------------------- */
  /* Custom label column: create Split A for all three wafers.         */
  /* ---------------------------------------------------------------- */
  await page.locator(".custom-panel .side-section-head .link-btn").click();
  await page.waitForSelector(".column-modal");
  await page.waitForTimeout(300);
  await page.locator(".column-modal input.input").nth(0).fill("Split");
  await page.locator(".column-modal input.input").nth(1).fill("Split A");
  await page.locator(".column-modal .column-tools .link-btn", { hasText: "All" }).click();
  out.modalSelected = await page.locator(".column-modal .column-tools .muted").innerText();
  await screenshot("v2-02-modal-light.png");
  await page.locator(".column-modal .modal-foot .btn.primary").click();
  await page.waitForSelector(".column-modal", { state: "detached", timeout: 30000 });
  await page.waitForTimeout(1200);
  out.createToast = await toast();
  out.customPanelAfterCreate = await page.locator(".custom-panel").innerText();
  out.infoAfterCreate = await page.evaluate(async () => {
    const info = await window.__TAURI_INTERNALS__.invoke("dataset_info");
    return info?.customColumns;
  });

  /* ---------------------------------------------------------------- */
  /* Edit: assign Split B to the last wafer, leaving two Split A.      */
  /* ---------------------------------------------------------------- */
  await page.locator(".custom-column-main").click();
  await page.waitForSelector(".column-modal");
  await page.locator(".column-modal .column-tools .link-btn", { hasText: "None" }).click();
  await page.locator(".column-modal .wafer-check input").nth(2).check();
  await page.locator(".column-modal input.input").nth(1).fill("Split B");
  await page.locator(".column-modal .modal-foot .btn.primary").click();
  await page.waitForSelector(".column-modal", { state: "detached", timeout: 30000 });
  await page.waitForTimeout(1200);
  out.editToast = await toast();
  out.customPanelAfterEdit = await page.locator(".custom-panel").innerText();
  out.infoAfterEdit = await page.evaluate(async () => {
    const info = await window.__TAURI_INTERNALS__.invoke("dataset_info");
    return info?.customColumns;
  });

  /* ---------------------------------------------------------------- */
  /* Box plot: colour/block by the Split column.                       */
  /* ---------------------------------------------------------------- */
  await tab("Box plot");
  await waitPlot("Box plot");
  await page
    .locator(".insp-section", { hasText: "Box plot" })
    .locator("select")
    .selectOption("Split");
  await page.waitForTimeout(1600);
  out.boxSplitAnnotations = await page
    .locator(".annotation-text")
    .evaluateAll((els) => els.map((e) => e.textContent));
  out.boxSplitStats = await page.locator(".stats").innerText();
  await screenshot("v2-03-box-split.png");

  /* ---------------------------------------------------------------- */
  /* Scatter: none, continuous, category OCR and category Split.       */
  /* ---------------------------------------------------------------- */
  await tab("Scatter");
  await waitPlot("Scatter");
  const legendTexts = () =>
    page
      .locator(".legendtext")
      .evaluateAll((els) => els.map((e) => e.textContent))
      .catch(() => []);
  out.scatterNone = {
    stats: await page.locator(".stats").innerText(),
    legends: await legendTexts(),
    colorbars: await page.locator(".colorbar").count(),
  };
  await screenshot("v2-04-scatter-none.png");

  const scatterSection = page.locator(".insp-section", { hasText: "Z colour" });
  await scatterSection.locator(".seg button", { hasText: "Value" }).click();
  await page.waitForTimeout(1800);
  out.scatterContinuous = {
    stats: await page.locator(".stats").innerText(),
    colorbars: await page.locator(".colorbar").count(),
    cbTitles: await page.locator(".cbaxis .cbtitle").allInnerTexts().catch(() => []),
  };
  await screenshot("v2-05-scatter-continuous.png");

  await scatterSection.locator(".seg button", { hasText: "Category" }).click();
  await page.waitForTimeout(1200);
  const categorySelect = scatterSection.locator(".field", { hasText: "Z category" }).locator("select");
  await categorySelect.selectOption("wafer");
  await page.waitForTimeout(1800);
  out.scatterOcr = {
    stats: await page.locator(".stats").innerText(),
    legends: await legendTexts(),
  };
  await screenshot("v2-06-scatter-ocr.png");

  await categorySelect.selectOption("Split");
  await page.waitForTimeout(1800);
  out.scatterSplit = {
    stats: await page.locator(".stats").innerText(),
    legends: await legendTexts(),
  };
  await screenshot("v2-07-scatter-split.png");

  /* ---------------------------------------------------------------- */
  /* Presentation toggle.                                              */
  /* ---------------------------------------------------------------- */
  const presentation = page.locator(".insp-section", { hasText: "Presentation" }).locator("input[type=checkbox]");
  const tickSize = async () =>
    page
      .locator(".js-plotly-plot .xtick text")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize)
      .catch(() => null);
  out.presentationOn = await tickSize();
  await presentation.uncheck();
  await page.waitForTimeout(1200);
  out.presentationOff = await tickSize();
  await presentation.check();
  await page.waitForTimeout(1000);

  /* ---------------------------------------------------------------- */
  /* Dark theme modal and scatter screenshot.                          */
  /* ---------------------------------------------------------------- */
  await page.locator('button[title="Dark mode"]').click();
  await page.waitForTimeout(800);
  await page.locator(".custom-column-main").click();
  await page.waitForSelector(".column-modal");
  await page.waitForTimeout(300);
  out.modalDarkStyle = await page.locator(".column-modal").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { background: cs.backgroundColor, color: cs.color, border: cs.borderColor };
  });
  await screenshot("v2-08-modal-dark.png");
  await page.locator(".column-modal .modal-head button[title=Close]").click();
  await page.waitForSelector(".column-modal", { state: "detached" });
  await page.waitForTimeout(600);
  await screenshot("v2-09-scatter-dark.png");

  // Native clipboard image, saved to disk so the pixels can be inspected.
  await page.locator('button[title="Copy image to clipboard"]').click();
  await page.waitForTimeout(2500);
  out.copyDarkToast = await toast();
  out.copyDarkError = await error();
  try {
    rmSync(clipboardPng, { force: true });
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$img = [System.Windows.Forms.Clipboard]::GetImage()",
      "if ($img -eq $null) { throw 'clipboard has no image' }",
      `$img.Save('${clipboardPng.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "Write-Output ($img.Width.ToString() + 'x' + $img.Height.ToString())",
    ].join("; ");
    out.clipboardSize = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], {
      encoding: "utf8",
      timeout: 30000,
    }).trim();
  } catch (e) {
    out.clipboardReadError = String(e);
  }
  out.clipboardPng = existsSync(clipboardPng) ? statSync(clipboardPng).size : null;

  // Back to light for the report.
  await page.locator('button[title="Light mode"]').click();
  await page.waitForTimeout(800);

  /* ---------------------------------------------------------------- */
  /* Report with box-split and scatter-split, plus the usual plots.    */
  /* ---------------------------------------------------------------- */
  const addCurrent = async () => {
    await page.locator('button[title="Add this plot to the report"]').click();
    await page.waitForTimeout(400);
    await page.locator('.drawer-head button[title="Close"]').click().catch(() => undefined);
    await page.waitForTimeout(300);
  };
  await addCurrent(); // scatter split

  await tab("Box plot");
  await waitPlot("Box plot");
  await page
    .locator(".insp-section", { hasText: "Box plot" })
    .locator("select")
    .selectOption("Split");
  await page.waitForTimeout(1400);
  await addCurrent();

  await tab("Wafer map");
  await waitPlot("Wafer map");
  await addCurrent();

  await tab("Pareto");
  await waitPlot("Pareto");
  await addCurrent();

  await tab("Histogram");
  await waitPlot("Histogram");
  await addCurrent();

  await page.locator('button[title="Open the report builder"]').click();
  await page.waitForTimeout(600);
  out.reportFolder = await page.locator(".folder-path").innerText().catch(() => null);
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
  out.reportToast = await toast();
  out.reportError = await error();
  out.reportFiles = readdirSync(reportDir)
    .sort()
    .map((name) => ({ name, size: statSync(`${reportDir}\\${name}`).size }));
  out.reportJson = JSON.parse(readFileSync(`${reportDir}\\report.json`, "utf8"));
  out.reportJsonCustomColumns = out.reportJson.customColumns;

  // Map clipboard export: same native path as the chart button, but the
  // canvas renderer must also switch to the light export theme.
  await page.locator('.drawer-head button[title="Close"]').click().catch(() => undefined);
  await tab("Wafer map");
  await waitPlot("Wafer map");
  await page.locator('button[title="Copy image to clipboard"]').click();
  await page.waitForTimeout(1800);
  out.copyMapToast = await toast();
  out.copyMapError = await error();
  const mapClipboardPng = `${shotDir}\\v2-clipboard-map.png`;
  try {
    rmSync(mapClipboardPng, { force: true });
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$img = [System.Windows.Forms.Clipboard]::GetImage()",
      "if ($img -eq $null) { throw 'clipboard has no image' }",
      `$img.Save('${mapClipboardPng.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "Write-Output ($img.Width.ToString() + 'x' + $img.Height.ToString())",
    ].join("; ");
    out.mapClipboardSize = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", ps], {
      encoding: "utf8",
      timeout: 30000,
    }).trim();
  } catch (e) {
    out.mapClipboardReadError = String(e);
  }
  out.mapClipboardPng = existsSync(mapClipboardPng) ? statSync(mapClipboardPng).size : null;

  /* ---------------------------------------------------------------- */
  /* Backend template round-trip: restore columns from report.json.    */
  /* ---------------------------------------------------------------- */
  out.restore = await page.evaluate(async (columns) => {
    try {
      const info = await window.__TAURI_INTERNALS__.invoke("restore_custom_columns", { columns });
      return { ok: true, columns: info.customColumns };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, out.reportJsonCustomColumns);

  // Export CSV still includes the custom labels.
  out.exportCsv = await page.evaluate(async (path) => {
    try {
      return await window.__TAURI_INTERNALS__.invoke("export_csv", { path, filter: {} });
    } catch (e) {
      return String(e);
    }
  }, "D:\\test_matlabtool\\shots\\v2-export.csv");
  out.exportSize = existsSync("shots/v2-export.csv") ? statSync("shots/v2-export.csv").size : null;
  if (existsSync("shots/v2-export.csv")) {
    const lines = readFileSync("shots/v2-export.csv", "utf8").split(/\r?\n/);
    out.exportHeader = lines[0];
    out.exportFirst = lines[1];
  }

  // Delete-column UI path uses window.confirm; accept it through CDP.
  page.on("dialog", async (d) => {
    out.deleteConfirm = d.message();
    await d.accept().catch(() => undefined);
  });
  await page.locator(".custom-column-row .mini.danger").click();
  await page.waitForTimeout(1200);
  out.deleteToast = await toast();
  out.customPanelAfterDelete = await page.locator(".custom-panel").innerText();
  out.infoAfterDelete = await page.evaluate(async () => {
    const info = await window.__TAURI_INTERNALS__.invoke("dataset_info");
    return info?.customColumns;
  });

  // Re-import the exported wide CSV. The Excel-added "Split" text column must
  // become a usable custom column, not a numeric test or ignored metadata.
  out.csvReimport = await page.evaluate(async (path) => {
    try {
      const info = await window.__TAURI_INTERNALS__.invoke("open_paths", { paths: [path] });
      return {
        ok: true,
        rows: info.rows,
        tests: info.tests.length,
        customColumns: info.customColumns,
      };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, "D:\\test_matlabtool\\shots\\v2-export.csv");
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

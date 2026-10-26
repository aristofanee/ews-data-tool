// Focused checks for the split-map preview, enlarged-map legend spacing and
// limit-line halo. Produces screenshots for visual inspection.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const exe = "D:\\test_matlabtool\\src-tauri\\target\\release\\ews-data-tool.exe";
const dataDir = `${process.env.TEMP}\\pystdf\\pystdf-main\\data`;
const stdf = ["demofile.stdf.Z", "lot2.stdf", "lot3.stdf"]
  .map((f) => `${dataDir}\\${f}`)
  .filter((p) => existsSync(p));
const shotDir = "D:\\test_matlabtool\\shots";
mkdirSync(shotDir, { recursive: true });

const manyCsv = `${shotDir}\\v5-many-maps.csv`;
const lines = ["LOT,WAFER,X,Y,HBIN,DeviceNumber,StepCount"];
for (let w = 0; w < 12; w++) {
  for (let i = 0; i < 400; i++) {
    const device = ((i * 7 + w * 13) % 400) + 1;
    const step = (i % 50) + 1;
    lines.push(
      `L1,W${String(w + 1).padStart(2, "0")},${i % 20},${Math.floor(i / 20)},1,${device},${step}`
    );
  }
}
writeFileSync(manyCsv, lines.join("\n"));

const port = 9343;
const child = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
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
    } catch {}
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
    } catch {}
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
  const waitKind = async (kind) => {
    await page.waitForFunction(
      (k) => document.querySelector(".plot-kind")?.textContent?.trim() === k,
      kind,
      { timeout: 120000 }
    );
    await page.waitForTimeout(900);
  };

  await open(stdf);
  await page.screenshot({ path: `${shotDir}\\v5-box-limits.png` });
  out.boxShapes = await page.evaluate(() => {
    const gd = document.querySelector(".js-plotly-plot");
    return (gd?.layout?.shapes ?? []).map((s) => ({
      type: s.type,
      y0: s.y0,
      y1: s.y1,
      layer: s.layer,
      width: s.line?.width,
      color: s.line?.color,
      dash: s.line?.dash,
    }));
  });

  await tab("Bin map");
  await waitKind("Bin map");
  await page.waitForSelector(".binmap-open", { timeout: 60000 });
  await page.locator(".binmap-open").first().click();
  await page.waitForSelector(".map-detail", { timeout: 60000 });
  await page.waitForTimeout(700);
  out.binDetailTitle = await page.locator(".map-detail-title").innerText();
  await page.screenshot({ path: `${shotDir}\\v5-binmap-detail.png` });
  await page.locator(".map-detail-back").click();
  await page.waitForTimeout(500);

  await open([manyCsv]);
  await tab("Wafer map");
  await waitKind("Wafer map");
  await page.waitForSelector(".map-canvas", { timeout: 60000 });
  const split = page
    .locator(".insp-section", { hasText: "Wafer map" })
    .locator("label.check-row", { hasText: "Split into one map per wafer" })
    .locator("input");
  await split.check();
  await page.waitForFunction(
    () => document.querySelectorAll(".facet-card .map-canvas.preview").length === 12,
    null,
    { timeout: 180000 }
  );
  await page.waitForTimeout(1200);
  out.mapFacets = await page.locator(".facet-card").count();
  out.mapPreviews = await page.locator(".facet-card .map-canvas.preview").count();
  out.mapPreviewHints = await page.locator(".facet-card .map-hint").count();
  await page.screenshot({ path: `${shotDir}\\v5-map-split-preview.png` });

  const grid = page.locator(".facet-grid");
  const beforeScroll = await grid.evaluate((el) => el.scrollTop);
  const previewBox = await page.locator(".facet-card .map-canvas.preview").first().boundingBox();
  if (previewBox) {
    await page.mouse.move(
      previewBox.x + previewBox.width / 2,
      previewBox.y + previewBox.height / 2
    );
    await page.mouse.wheel(0, 420);
  }
  await page.waitForTimeout(500);
  const afterScroll = await grid.evaluate((el) => el.scrollTop);
  out.previewScroll = { before: beforeScroll, after: afterScroll };
  check("split map grid scrolls under the pointer", afterScroll > beforeScroll, out.previewScroll);

  await page.locator(".facet-card .map-canvas.preview").first().click();
  await page.waitForSelector(".map-detail", { timeout: 60000 });
  await page.waitForTimeout(900);
  out.splitDetailTitle = await page.locator(".map-detail-title").innerText();
  out.splitDetailHints = await page.locator(".map-detail .map-hint").count();
  await page.screenshot({ path: `${shotDir}\\v5-map-split-detail.png` });

  out.failures = failures;
  out.passed = failures.length === 0;
  console.log(JSON.stringify(out, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => undefined);
  child.kill();
}

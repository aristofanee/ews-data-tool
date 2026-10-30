// Smoke test the built Windows release through its real WebView2/native IPC.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const dir = resolve("shots/release-040"); mkdirSync(dir, { recursive: true });
function stdf(x, value, site, bin) {
  const parts = [];
  const record = (type, sub, body) => { const h = Buffer.alloc(4); h.writeUInt16LE(body.length); h[2] = type; h[3] = sub; parts.push(h, body); };
  record(0, 10, Buffer.from([2, 4])); record(5, 10, Buffer.from([1, site]));
  for (let i = 0; i < 2; i++) {
    const ptr = Buffer.alloc(16); ptr.writeUInt32LE(100 + i); ptr[4] = 1; ptr[5] = site;
    ptr.writeFloatLE(value * (i ? 10 : 1), 8); ptr[12] = 1; ptr[13] = i ? 73 : 86; ptr[15] = 255;
    record(15, 10, ptr);
  }
  const prr = Buffer.from([1, site, 0, 2, 0, bin, 0, bin, 0, 0, 0, 0, 0]);
  prr.writeInt16LE(x, 9); record(5, 20, prr);
  return Buffer.concat(parts);
}
function compressLiteral(bytes) {
  assert.ok(bytes.length < 256);
  const out = Buffer.alloc(3 + Math.ceil(bytes.length * 9 / 8)); out.set([0x1f, 0x9d, 9]);
  bytes.forEach((b, i) => { for (let bit = 0; bit < 9; bit++) if (b & (1 << bit)) out[3 + ((i * 9 + bit) >> 3)] |= 1 << ((i * 9 + bit) & 7); });
  return out;
}
function zip(entries) {
  const local = [], central = []; let offset = 0;
  for (const [name, raw] of entries) {
    const n = Buffer.from(name), packed = deflateRawSync(raw), crc = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, n, packed); central.push(c, n); offset += h.length + n.length + packed.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
const archive = resolve(dir, "synthetic-lot.zip"), csv = resolve(dir, "roundtrip.csv");
writeFileSync(archive, zip([
  ["nested/first.STDF.Z", compressLiteral(stdf(0, 1, 3, 2))],
  ["nested/retest.Z", compressLiteral(stdf(0, 2, 4, 1))],
  ["nested/second.stdf", stdf(1, 3, 3, 2)], ["notes.txt", Buffer.from("Synthetic release test")],
]));
const exe = resolve(process.argv[2] ?? "src-tauri/target/release/ews-data-tool.exe");
const child = spawn(exe, [], { windowsHide: true, env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9350" }, stdio: "ignore" });
let browser, page;
try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch("http://127.0.0.1:9350/json/version")).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.connectOverCDP("http://127.0.0.1:9350");
  for (let i = 0; i < 80; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => !p.url().startsWith("devtools:"));
    if (page) { try { if (await page.evaluate(() => !!window.__TAURI_INTERNALS__ && document.querySelector(".statusbar")?.textContent.includes("v0.4.0"))) break; } catch {} }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(page); await page.getByText("v0.4.0", { exact: true }).waitFor();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const result = await page.evaluate(async ({ archive, csv }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const info = await invoke("open_paths", { paths: [archive] });
    const box = await invoke("box_plot", { req: { test: 0, xAxis: "site", filter: {} } });
    const pareto = await invoke("pareto", { req: { category: "hard", filter: {} } });
    const scatter = await invoke("scatter", { req: { xTest: 0, yTest: 1, groupBy: "site", filter: {} } });
    await invoke("export_csv", { path: csv, filter: { stat: { kind: "sigma", k: 0.1, perWafer: false } } });
    const roundtrip = await invoke("open_paths", { paths: [csv] });
    let rejected = false;
    try { await invoke("open_paths", { paths: [archive + ".missing"] }); } catch { rejected = true; }
    const preserved = await invoke("dataset_info");
    return { info, mean: box.summary.mean, values: box.groups.flatMap((g) => g.values).sort(),
      failPct: pareto.bars[0]?.pct, yieldPct: pareto.yieldPct,
      scatterPoints: scatter.series.reduce((n, s) => n + s.points.length, 0), roundtrip, rejected, preservedRows: preserved.rows };
  }, { archive, csv });
  assert.equal(result.info.rows, 2); assert.equal(result.info.retestCount, 1);
  assert.equal(result.info.files.length, 3); assert.deepEqual(result.info.sites, [3, 4]);
  assert.equal(result.mean, 2.5); assert.deepEqual(result.values, [2, 3]);
  assert.equal(result.failPct, 50); assert.equal(result.yieldPct, 50); assert.equal(result.scatterPoints, 2);
  assert.equal(result.roundtrip.rows, 2); assert.deepEqual(result.roundtrip.sites, [3, 4]);
  assert.ok(result.rejected); assert.equal(result.preservedRows, 2);
  assert.match(readFileSync(csv, "utf8").split(/\r?\n/)[0], /site/);
  await page.reload(); await page.waitForSelector(".boxlayer path.box");
  for (const label of ["Histogram", "Scatter", "Trend", "Pareto", "Box plot"]) {
    await page.locator(".tab").filter({ hasText: label }).click();
    await page.waitForSelector(".js-plotly-plot");
  }
  await page.screenshot({ path: resolve(dir, "desktop-0.4.0.png") });
  assert.deepEqual(errors, []);
  const summary = { version: "0.4.0", zipRows: result.info.rows, retests: result.info.retestCount,
    files: result.info.files, sites: result.info.sites, mean: result.mean, values: result.values,
    failPct: result.failPct, yieldPct: result.yieldPct, csvRows: result.roundtrip.rows, errors };
  writeFileSync(resolve(dir, "smoke-result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await page?.screenshot({ path: resolve(dir, "failure.png") }).catch(() => {});
  throw error;
} finally { await browser?.close(); child.kill(); }

// Smoke test the built Windows release through its real WebView2/native IPC.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const dir = resolve("shots/release-043"); mkdirSync(dir, { recursive: true });
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
const productCsv = resolve(dir, "product.csv"), reference = resolve(dir, "reference.stdf");
writeFileSync(productCsv, "Wafer-Diameter,300\nWafer_Width,2.8\nWafer_Center_X,12\nSoftBinName,7,Existing description\nLOT_ID,Wafer,OCR,DIE_X,DIE_Y,SITE,SBIN,Current,Split\nPattern,,,,,,,unused,unused\nVendor note,,,,,,,unused,unused\nUnit,,,,,,,uA,\nLowL,,,,,,,1.5,\nHighL,,,,,,,9.5,\nL,03,OCR42,1,2,3,7,4.2,Group A\nL,03,OCR42,2,2,4,,5.6,Group A\n");
const wcr = Buffer.alloc(20); wcr.writeFloatLE(300, 0); wcr.writeFloatLE(2.04, 4); wcr.writeFloatLE(2.8, 8); wcr[12] = 3; wcr[13] = 68;
const wcrHeader = Buffer.from([20, 0, 2, 30]);
const sbr = Buffer.from([1, 1, 7, 0, 0, 0, 0, 0, 70, 4, 76, 101, 97, 107]);
writeFileSync(reference, Buffer.concat([stdf(99, 999, 1, 1), wcrHeader, wcr, Buffer.from([sbr.length, 0, 1, 50]), sbr]));
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
    if (page) { try { if (await page.evaluate(() => !!window.__TAURI_INTERNALS__ && document.querySelector(".statusbar")?.textContent.includes("v0.4.3"))) break; } catch {} }
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(page); await page.getByText("v0.4.3", { exact: true }).waitFor();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const result = await page.evaluate(async ({ archive, csv }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const info = await invoke("open_paths", { paths: [archive] });
    const box = await invoke("box_plot", { req: { test: 0, xAxis: "site", filter: {} } });
    const pareto = await invoke("pareto", { req: { category: "hard", filter: {} } });
    const scatter = await invoke("scatter", { req: { xTest: 0, yTest: 1, groupBy: "site", filter: {} } });
    await invoke("export_csv", { path: csv, filter: { stat: { kind: "sigma", k: 0.1, perWafer: false } } });
    const trend = await invoke("trend", { req: { test: 0, by: "site", groupBy: "wafer", filter: {} } });
    const roundtrip = await invoke("open_paths", { paths: [csv] });
    let rejected = false;
    try { await invoke("open_paths", { paths: [archive + ".missing"] }); } catch { rejected = true; }
    const preserved = await invoke("dataset_info");
    return { info, mean: box.summary.mean, values: box.groups.flatMap((g) => g.values).sort(),
      failPct: pareto.bars[0]?.pct, yieldPct: pareto.yieldPct,
      trend, scatterPoints: scatter.series.reduce((n, s) => n + s.points.length, 0), roundtrip, rejected, preservedRows: preserved.rows };
  }, { archive, csv });
  assert.equal(result.info.rows, 2); assert.equal(result.info.retestCount, 1);
  assert.equal(result.info.files.length, 3); assert.deepEqual(result.info.sites, [3, 4]);
  assert.equal(result.mean, 2.5); assert.deepEqual(result.values, [2, 3]);
  assert.equal(result.failPct, 50); assert.equal(result.yieldPct, 50); assert.equal(result.scatterPoints, 2);
  assert.equal(result.trend.points.length, 2);
  assert.deepEqual(result.trend.points.map(p=>p.mean).sort(),[2,3]);
  assert.ok(result.trend.points.every(p=>p.groupLabel));
  assert.equal(result.roundtrip.tests[0].number,100);
  const exportLines=readFileSync(csv,"utf8").trim().split(/\r?\n/);
  assert.ok(exportLines[1].startsWith("LSL,") && exportLines[2].startsWith("USL,"));
  assert.ok(!exportLines.some(l=>l.startsWith("Unit,")||l.startsWith("Tests#,")));
  assert.equal(result.roundtrip.rows, 2); assert.deepEqual(result.roundtrip.sites, [3, 4]);
  assert.ok(result.rejected); assert.equal(result.preservedRows, 2);
  assert.match(readFileSync(csv, "utf8").split(/\r?\n/)[0], /site/);
  const metadata = await page.evaluate(async ({ productCsv, reference }) => {
    const invoke = window.__TAURI_INTERNALS__.invoke;
    const before = await invoke("open_paths", { paths: [productCsv] });
    const after = await invoke("import_product_metadata", { path: reference });
    const box = await invoke("box_plot", { req: { test: 0, xAxis: "site", filter: {} } });
    const hard = await invoke("pareto", { req: { category: "hard", filter: {} } });
    const soft = await invoke("pareto", { req: { category: "soft", filter: {} } });
    return { before, after, values: box.groups.flatMap((g) => g.values).sort(), hard, soft };
  }, { productCsv, reference });
  assert.equal(metadata.after.rows, 2); assert.equal(metadata.after.tests.length, 1);
  assert.deepEqual(metadata.after.lots, ["L"]); assert.equal(metadata.after.wafers.length, 1);
  assert.equal(metadata.after.wafers[0].name, "OCR42");
  const label = (name) => { const c = metadata.after.customColumns.find((c) => c.name === name); return c.categories[c.waferValues[0]]; };
  assert.equal(label("Split"), "Group A"); assert.equal(label("Wafer number"), "03");
  assert.deepEqual(metadata.after.files, metadata.before.files);
  assert.equal(metadata.after.wafers[0].centerX, 12);
  assert.ok(Math.abs(metadata.after.wafers[0].dieHMm - 2.04) < 0.00001);
  assert.equal(metadata.after.wafers[0].diameterMm, 300); assert.equal(metadata.after.wafers[0].flat, "D");
  assert.equal(metadata.after.sbins.find((b) => b.code === 7).name, "Existing description");
  assert.equal(metadata.after.hbins[0].code, 65535); assert.equal(metadata.hard.unknownTotal, 2); assert.equal(metadata.hard.failTotal, 0);
  assert.equal(metadata.soft.unknownTotal, 1); assert.equal(metadata.soft.bars[0].pct, 50);
  assert.ok(Math.abs(metadata.values[0] - 4.2) < 0.00001 && Math.abs(metadata.values[1] - 5.6) < 0.00001);
  assert.equal(metadata.after.tests[0].units, "uA"); assert.equal(metadata.after.tests[0].loSpec, 1.5); assert.equal(metadata.after.tests[0].hiSpec, 9.5);
  await page.evaluate(async ({csv})=>{
    const invoke=window.__TAURI_INTERNALS__.invoke;
    await invoke("export_csv",{path:csv,filter:{}});
    const d=await invoke("open_paths",{paths:[csv]});
    if(d.rows!==2||d.tests[0].units!=="uA"||d.tests[0].loSpec!==1.5||d.tests[0].hiSpec!==9.5)throw Error("CSV metadata roundtrip mismatch");
    const split=d.customColumns.find(c=>c.name==="Split");
    if(!split||split.categories[split.waferValues[0]]!=="Group A")throw Error("CSV Split roundtrip mismatch");
  },{csv});
  await page.reload(); await page.waitForSelector(".boxlayer path.box");
  for (const label of ["Histogram", "Scatter", "Trend", "Pareto", "Box plot"]) {
    await page.locator(".tab").filter({ hasText: label }).click();
    await page.waitForSelector(".js-plotly-plot");
  }
  const drag=await page.locator(".chart-body .nsewdrag").first().boundingBox();
  const before=await page.evaluate(()=>[...document.querySelector(".chart-body .plotly-host")._fullLayout.xaxis.range]);
  await page.mouse.move(drag.x+drag.width*.4,drag.y+drag.height*.4);await page.mouse.down({button:"middle"});
  await page.mouse.move(drag.x+drag.width*.6,drag.y+drag.height*.6,{steps:8});await page.mouse.up({button:"middle"});
  await page.waitForTimeout(150);
  const after=await page.evaluate(()=>[...document.querySelector(".chart-body .plotly-host")._fullLayout.xaxis.range]);
  assert.notDeepEqual(after,before,"desktop middle-button pan");
  await page.screenshot({ path: resolve(dir, "desktop-0.4.3.png") });
  assert.deepEqual(errors, []);
  const summary = { version: "0.4.3", zipRows: result.info.rows, retests: result.info.retestCount,
    files: result.info.files, sites: result.info.sites, mean: result.mean, values: result.values,
    failPct: result.failPct, yieldPct: result.yieldPct, csvRows: result.roundtrip.rows,
    metadataOnly: { rows: metadata.after.rows, tests: metadata.after.tests.length, preservedValues: metadata.values, unknownHbins: metadata.hard.unknownTotal }, errors };
  writeFileSync(resolve(dir, "smoke-result.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await page?.screenshot({ path: resolve(dir, "failure.png") }).catch(() => {});
  throw error;
} finally { await browser?.close(); child.kill(); }

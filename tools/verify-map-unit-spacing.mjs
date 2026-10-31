import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1421"], { stdio: "ignore", windowsHide: true });
let browser;
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch("http://127.0.0.1:1421")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage(); await page.goto("http://127.0.0.1:1421");
  await page.getByText("Load demo data").click(); await page.waitForSelector(".boxlayer path.box");
  const results = await page.evaluate(async () => {
    const { WaferMapRenderer } = await import("/src/charts/waferMap.ts");
    const { setDemoFontOffset } = await import("/src/lib/demoFonts.ts");
    const api = await import("/src/lib/api.ts");
    const data = await api.waferMap({ wafer: 0, test: 1, mode: "value", filter: { lots: [], wafers: [], hbins: [], sbins: [], stat: null } });
    data.test = { ...data.test, units: "uA per micrometre long units" };
    const results = [];
    for (const [presentation, offset] of [[false, 0], [false, 10], [true, 0]]) {
      setDemoFontOffset(offset);
      const canvas = document.createElement("canvas");
      const calls = [], original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) {
        const m = this.measureText(text);
        calls.push({ text: String(text), x, y, top: y - m.actualBoundingBoxAscent, bottom: y + m.actualBoundingBoxDescent });
        return original.call(this, text, x, y, ...rest);
      };
      const renderer = new WaferMapRenderer(canvas); renderer.setSize(900, 650);
      renderer.setData(data, { theme: "light", palette: "brand", mode: "value", lsl: null, usl: null, showLegend: true, presentation });
      CanvasRenderingContext2D.prototype.fillText = original;
      const unit = calls.find((c) => c.text.startsWith("uA"));
      const tick = calls.filter((c) => c.x > unit.x && Number.isFinite(Number(c.text))).sort((a, b) => a.y - b.y)[0];
      results.push({ presentation, offset, unit, tick, gap: tick.top - unit.bottom });
    }
    return results;
  });
  for (const result of results) assert.ok(result.gap > 0, JSON.stringify(result));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser?.close(); server.kill(); }

// Dump the wafer-map canvas in value and bin modes for close inspection.
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1560, height: 980 } });
await page.goto("http://127.0.0.1:1420", { waitUntil: "networkidle" });
await page.getByText("Load demo data").click();
await page.waitForSelector(".js-plotly-plot");
await page.waitForTimeout(1500);
await page.locator(".tab", { hasText: "Wafer map" }).click();
await page.waitForTimeout(900);

const dump = async (name) => {
  const url = await page
    .locator("canvas.map-canvas")
    .evaluate((c) => c.toDataURL("image/png"));
  writeFileSync(`shots/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
  const info = await page.locator("canvas.map-canvas").evaluate((c) => {
    const ctx = c.getContext("2d");
    const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    return {
      w: c.width,
      h: c.height,
      topLeft: px(30, 30),
      center: px(Math.round(c.width / 2), Math.round(c.height / 2)),
      bottom: px(Math.round(c.width / 2), c.height - 5),
    };
  });
  return info;
};

const value = await dump("canvas-value");
await page.getByRole("button", { name: "Bin", exact: true }).click();
await page.waitForTimeout(900);
const bin = await dump("canvas-bin");

console.log(JSON.stringify({ value, bin }, null, 2));
await browser.close();

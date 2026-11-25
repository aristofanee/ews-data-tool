import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Load demo data" }).click();
await page.waitForTimeout(2000);
const out = await page.evaluate(async () => {
  const Plotly = window.Plotly;
  if (!Plotly) return { noPlotly: true };
  const d = document.createElement("div");
  d.style.cssText = "width:700px;height:500px;position:fixed;left:0;top:0;z-index:99999;background:white";
  document.body.appendChild(d);
  await Plotly.newPlot(
    d,
    [{ x: [0, 1], y: [1, 100], mode: "markers" }],
    {
      yaxis: { type: "log", range: [0, 2] },
      annotations: [
        { x: 0.5, y: 1, text: "raw-1", showarrow: false, bgcolor: "#fff" },
        { x: 0.5, y: 10, text: "raw-10", showarrow: false, bgcolor: "#fff" },
        { x: 0.5, y: 0, text: "log0", showarrow: false, bgcolor: "#fff" },
        { x: 0.5, y: 1, text: "log1", showarrow: false, bgcolor: "#fff" },
      ],
    },
    { staticPlot: true }
  );
  const full = d._fullLayout;
  return {
    range: full.yaxis.range,
    anns: full.annotations.map((a) => ({ text: a.text, y: a.y, _y: a._y, ya: a.ya })),
    svg: [...d.querySelectorAll(".annotation")].map((g) => ({
      text: g.textContent,
      bbox: g.getBoundingClientRect().toJSON(),
    })),
    plot: full._size,
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

import { chromium } from "playwright-core";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto("http://127.0.0.1:1420/", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Load demo data" }).click();
await page.waitForTimeout(2000);
await page.locator(".tab", { hasText: "Box plot" }).click();
await page.waitForTimeout(600);
await page.locator(".check-row", { hasText: "Logarithmic Y axis" }).locator("input").setChecked(true);
await page.locator(".field", { hasText: "Y axis range" }).locator("select").selectOption("spec");
await page.waitForTimeout(900);
const out = await page.evaluate(() => {
  const el = document.querySelector(".chart-body .js-plotly-plot");
  const full = el._fullLayout;
  const anns = full.annotations || [];
  return {
    input: el.layout.annotations,
    full: anns.map((a) => ({
      text: a.text,
      x: a.x,
      y: a.y,
      xref: a.xref,
      yref: a.yref,
      yanchor: a.yanchor,
      yshift: a.yshift,
      visible: a.visible,
      xa: a.xa,
      ya: a.ya,
      _x: a._x,
      _y: a._y,
    })),
    yaxis: { range: full.yaxis.range, type: full.yaxis.type, domain: full.yaxis.domain },
    plotBox: full._size,
    svgAnns: [...document.querySelectorAll(".annotation")].map((g) => ({
      text: g.textContent,
      transform: g.getAttribute("transform"),
      bbox: g.getBoundingClientRect().toJSON(),
    })),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();

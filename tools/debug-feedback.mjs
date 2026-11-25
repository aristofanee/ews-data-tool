// Temporary reproduction harness for the graph feedback items.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

import { desktopExecutable, referenceStdfFiles, repoPath } from "./harness-paths.mjs";
const exe = desktopExecutable();
const files = referenceStdfFiles();
const port = 9350;
const shotDir = repoPath("shots");
mkdirSync(shotDir, { recursive: true });

const child = spawn(exe, [], {
  windowsHide: true,
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
try {
  let version = null;
  for (let i = 0; i < 120; i++) {
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
    } catch {
      /* navigating */
    }
    await sleep(250);
  }

  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.stack || e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });

  await page.evaluate(async (paths) => {
    await window.__TAURI_INTERNALS__.invoke("open_paths", { paths });
  }, files);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForSelector(".js-plotly-plot", { timeout: 180000 });
  await page.waitForTimeout(1500);

  const tab = async (label) => {
    await page.locator(".tab", { hasText: label }).click();
    await page.waitForTimeout(900);
  };
  const section = (name) => page.locator(".insp-section", { hasText: name });
  const report = async (label) => {
    const err = await page.locator(".chart-error-msg").allInnerTexts();
    console.log(label, JSON.stringify({ errors: [...errors], chartError: err }));
    await page.screenshot({ path: `${shotDir}\\debug-${label}.png` });
  };

  await tab("Box plot");
  const box = section("Box plot");
  const xSelect = box.locator(".field", { hasText: "X axis" }).locator("select");
  console.log("box x options", await xSelect.locator("option").allInnerTexts());

  for (const value of ["hbin", "sbin"]) {
    await xSelect.selectOption(value);
    await page.waitForTimeout(1800);
    await report(`box-x-${value}`);
  }

  // Add a two-category custom column and reload so the store sees it.
  const custom = await page.evaluate(async () => {
    return await window.__TAURI_INTERNALS__.invoke("add_custom_column", {
      name: "Split",
      assignments: [
        { wafer: 0, label: "Split A" },
        { wafer: 1, label: "Split B" },
        { wafer: 2, label: "Split A" },
      ],
    });
  });
  console.log("custom", JSON.stringify(custom.customColumns));
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.waitForSelector(".js-plotly-plot", { timeout: 180000 });
  await page.waitForTimeout(1500);
  await tab("Box plot");
  const box2 = section("Box plot");
  const xSelect2 = box2.locator(".field", { hasText: "X axis" }).locator("select");
  console.log("box x options 2", await xSelect2.locator("option").allInnerTexts());
  await xSelect2.selectOption("Split");
  await page.waitForTimeout(1800);
  await report("box-x-custom");

  await box2.locator(".field", { hasText: "Group by" }).locator("select").selectOption("Split");
  await page.waitForTimeout(1800);
  await report("box-group-custom");

  // Pareto default, x axis and split.
  await tab("Pareto");
  await page.waitForTimeout(1200);
  await report("pareto-default");
  const pareto = section("Pareto");
  console.log("pareto fields", await pareto.locator(".field-label").allInnerTexts());
  const paretoSelects = pareto.locator("select");
  console.log("pareto selects", await paretoSelects.count());
  if ((await paretoSelects.count()) > 0) {
    console.log("pareto select 0", await paretoSelects.nth(0).locator("option").allInnerTexts());
  }
} finally {
  try {
    if (browser) await browser.close();
  } catch {
    /* ignore */
  }
  try {
    child.kill();
  } catch {
    /* ignore */
  }
}

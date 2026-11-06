import type { MapResponse, PlotSelection, PlotSpec, Summary } from "../types";
import type { PlotData } from "./usePlotData";
import { categoryName } from "./categoryNames";
import { fmt, fmtInt } from "./format";
import { capability, valueMapSummary } from "./stats";
import { binLabel } from "./theme";

export interface Stat {
  k: string;
  v: string;
  tone?: "good" | "warn" | "bad";
  title?: string;
}

function categoryLabel(value: string): string {
  if (value === "site") return "Site";
  if (value === "wafer") return "Wafer ID (OCR)";
  if (value === "lot") return "Lot";
  if (value === "hbin") return "HBIN";
  if (value === "sbin") return "SBIN";
  return categoryName(value);
}

function measurementStats(s: Summary): Stat[] {
  return [
    { k: "Dice", v: fmtInt(s.n) },
    { k: "Mean", v: fmt(s.n ? s.mean : NaN) },
    { k: "SD", v: fmt(s.n ? s.sd : NaN) },
    { k: "Median", v: fmt(s.n ? s.median : NaN) },
  ];
}

function addTestYield(stats: Stat[], yieldPct: number | null, title?: string) {
  if (yieldPct != null) stats.push({ k: "Test yield", v: `${yieldPct.toFixed(2)}%`, tone: "good", title });
}

export function valueMapStats(data: MapResponse): Stat[] {
  const out = measurementStats(valueMapSummary(data.dice));
  addTestYield(out, data.testYieldPct ?? null, data.isMean ? "Test yield uses the individual dice that contributed to this map." : undefined);
  if (data.excluded > 0) out.push({ k: "Excluded", v: fmtInt(data.excluded), tone: "warn" });
  return out;
}

export function statsFor(data: PlotData, spec: PlotSpec, facet?: PlotSelection, sampledMarkers = false, boxInLimits?: number): Stat[] {
  switch (data.kind) {
    case "box":
    case "hist": {
      const d = data.data;
      const population = facet === undefined ? d : data.kind === "box"
        ? data.data.groupStats[facet.label]
        : data.data.groups.find(g => g.key === facet.key)?.stats;
      if (!population) return [];
      const s = population.summary;
      const out = measurementStats(s);
      let inLimits = boxInLimits;
      if (data.kind === "hist") {
        const group = facet ? data.data.groups.find(g => g.key === facet.key) : undefined;
        const bins = group?.histogram ?? data.data;
        const counts = group?.histogram?.counts ?? group?.counts ?? bins.counts;
        const plotted = counts.reduce((n, count) => n + count, 0);
        if (s.n && (bins.binRange || plotted < s.n)) inLimits = plotted;
      }
      if (inLimits !== undefined) out.splice(1, 0, {
        k: "In Limits", v: fmtInt(inLimits), tone: inLimits < s.n ? "warn" : undefined,
        title: "Dice inside the plot range. Statistics use the full filtered population.",
      });
      const process = capability(s.mean, s.sd, spec.lsl ?? d.test.loSpec, spec.usl ?? d.test.hiSpec);
      if (process.cp !== null) out.push({ k: "Cp", v: fmt(process.cp, 2) });
      if (process.cpk !== null) {
        const k = process.cpk;
        out.push({ k: "Cpk", v: fmt(k, 2), tone: k < 1.33 ? "warn" : k >= 1.67 ? "good" : undefined });
      }
      addTestYield(out, population.testYieldPct);
      if (!facet && d.excluded > 0) out.push({ k: "Excluded", v: fmtInt(d.excluded), tone: "warn" });
      if (data.kind === "box" && sampledMarkers) out.push({
        k: "Rendering", v: "Sampled", tone: "warn",
        title: "Some regular markers are skipped. All outliers are retained and statistics use the full filtered population.",
      });
      return out;
    }
    case "map": {
      const d = data.data;
      const out = valueMapStats(d);
      if (spec.groupBy !== "none") {
        out.unshift({ k: "View", v: `Grouped by ${categoryLabel(spec.groupBy)}` });
      } else if (d.isMean) {
        out.unshift({ k: "Scope", v: `All wafers (mean of ${fmtInt(d.waferCount)})` });
      }
      return out;
    }
    case "binmap": {
      const d = data.data;
      const pass = d.wafers.reduce((n, w) => n + w.pass, 0);
      const fail = d.wafers.reduce((n, w) => n + w.fail, 0);
      const tested = pass + fail;
      return [
        {
          k: "Wafer yield (HBIN 1)",
          v: d.wafers.some((w) => w.dice.some((die) => die.hbin === 65535)) ? "N/A (unknown bins)" : `${(tested ? pass * 100 / tested : 0).toFixed(2)}%`,
          tone: "good",
        },
        { k: "Bin", v: spec.binCategory === "soft" ? "SBIN" : "HBIN" },
        { k: "Wafers", v: fmtInt(d.wafers.length) },
        { k: "Pass", v: fmtInt(pass) },
        { k: "Other / unknown bins", v: fmtInt(fail) },
      ];
    }
    case "pareto": {
      const d = data.data;
      const top = d.bars[0];
      const out: Stat[] = [
        { k: "Failures", v: fmtInt(d.failTotal) },
        { k: "Bin", v: spec.binCategory === "soft" ? "SBIN" : "HBIN" },
        {
          k: "Bin categories",
          v: fmtInt(d.mode === "global" ? d.bars.length : d.series.length),
        },
        {
          k: "Yield",
          v: d.unknownTotal ? "N/A (unknown bins)" : `${d.yieldPct.toFixed(2)}%`,
          tone: "good",
        },
      ];
      if (top) out.push({ k: "Top bin", v: `${binLabel(spec.binCategory, top.code, top.name, false)} · ${top.pct.toFixed(1)}%` });
      if (d.mode === "grouped") out.push({ k: "Groups", v: fmtInt(d.groups.length) });
      if (!facet && spec.groupBy !== "none") {
        out.unshift({ k: "View", v: `Split by ${categoryLabel(spec.groupBy)}` });
      } else if (spec.xAxis !== "none") {
        out.unshift({ k: "X axis", v: categoryLabel(spec.xAxis) });
      }
      return out;
    }
    case "trend": {
      const d = data.data;
      const points = facet ? d.points.filter(p => p.groupLabel === facet.label) : d.points;
      const means = points.map(p => p.mean);
      const avg = means.length ? means.reduce((a, b) => a + b, 0) / means.length : NaN;
      const out: Stat[] = [
        { k: "Points", v: fmtInt(points.length) },
        { k: "Mean", v: fmt(avg) },
      ];
      if (means.length) {
        let min = Infinity;
        let max = -Infinity;
        for (const v of means) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
        out.push({ k: "Min", v: fmt(min) });
        out.push({ k: "Max", v: fmt(max) });
      }
      return out;
    }
    case "scatter": {
      const d = data.data;
      const series = facet ? d.series.filter(s => s.key === facet.key) : d.series;
      const points = series.reduce((n, s) => n + s.points.length, 0);
      const total = facet ? d.groupTotals?.[facet.label] ?? points : d.total;
      const r = facet ? d.groupStatistics?.[facet.label]?.fit?.r : d.r;
      const out: Stat[] = [
        { k: "Dice", v: fmtInt(total) },
        { k: "Displayed points", v: fmtInt(points) },
      ];
      if (r != null && Number.isFinite(r)) {
        out.push({ k: "r", v: fmt(r, 3) });
        out.push({ k: "R²", v: fmt(r * r, 3) });
      }
      if (series.length > 1) out.push({ k: "Groups", v: fmtInt(series.length) });
      if (!facet && d.excluded > 0) out.push({ k: "Excluded", v: fmtInt(d.excluded), tone: "warn" });
      if (points < total) out.push({
        k: "Rendering", v: "Sampled", tone: "warn",
        title: "The fit line, correlation and statistics use all eligible X/Y pairs.",
      });
      return out;
    }
  }
}

import type { CustomFilter, DatasetInfo, Filter } from "../types";
import { categoryName } from "./categoryNames";
import { testLabelWithUnits } from "./format";
import { binColor } from "./theme";

export function categoryPassesCustomFilters(filter: Filter, category: string, value: string): boolean {
  return (filter.custom ?? []).every(rule =>
    rule.kind !== "category" || rule.category !== category || rule.values.includes(value) === rule.keep);
}

export function filterCategories(info: DatasetInfo): string[] {
  return [
    ...(info.sites?.length ? ["site"] : []),
    ...(info.hbins.length ? ["hbin"] : []),
    ...(info.sbins.length ? ["sbin"] : []),
    ...(info.dataCategories ?? []).map(c => c.id),
    ...info.customColumns.map(c => c.name),
  ];
}

export function filterValues(info: DatasetInfo, category: string): { value: string; label: string; color?: string }[] {
  if (category === "site") return (info.sites ?? []).map(code => ({
    value: String(code), label: code === 65535 ? "Unknown site" : `Site ${code}`,
  }));
  if (category === "hbin" || category === "sbin") return info[category === "hbin" ? "hbins" : "sbins"].map(bin => ({
    value: String(bin.code),
    label: bin.code === 65535 ? "Unknown bin" : String(bin.code) + (category === "sbin" && bin.name ? ` · ${bin.name}` : ""),
    color: binColor(bin.code, bin.pass),
  }));
  const data = info.dataCategories?.find(c => c.id === category);
  if (data) return data.values.flatMap((value, i) => data.counts[i] > 0 ? [{ value, label: data.labels[i] }] : []);
  const custom = info.customColumns.find(c => c.name === category);
  if (!custom) return [];
  const used = new Set(custom.waferValues);
  return custom.categories.flatMap((value, i) => used.has(i) ? [{ value, label: value || "Unassigned" }] : []);
}

export function describeCustomFilter(rule: CustomFilter, info: DatasetInfo | null) {
  if (rule.kind === "numeric") {
    const test = info?.tests[rule.test];
    return {
      title: test ? testLabelWithUnits(test) : "Test value",
      detail: `${rule.keep ? "Keep" : "Exclude"} ${rule.includeEnds === false ? "(" : "["}${rule.min}, ${rule.max}${rule.includeEnds === false ? ")" : "]"}`,
    };
  }
  const labels = new Map(info ? filterValues(info, rule.category).map(o => [o.value, o.label]) : []);
  return {
    title: categoryName(rule.category),
    detail: `${rule.keep ? "Keep" : "Exclude"} ${rule.values.map(value => labels.get(value) ?? (value || "Unassigned")).join(", ")}`,
  };
}

export function describeFilters(filter: Filter, info: DatasetInfo | null, measurementPlot = true): string {
  const parts: string[] = [];
  const add = (name: string, values: (string | number)[]) => {
    if (values.length) parts.push(`${name} ${values.slice(0, 4).join(", ")}${values.length > 4 ? ` (+${values.length - 4} more)` : ""}`);
  };
  add("Lot", filter.lots.map(i => info?.lots[i] ?? i));
  add("Wafer", filter.wafers.map(i => {
    const wafer = info?.wafers[i];
    return wafer ? `${info?.lots[wafer.lot]} / ${wafer.name}` : i;
  }));
  add("Site", (filter.sites ?? []).map(code => code === 65535 ? "Unknown" : code));
  add("HBIN", filter.hbins.map(code => code === 65535 ? "Unknown" : code));
  add("SBIN", filter.sbins.map(code => code === 65535 ? "Unknown" : code));
  for (const [category, values] of Object.entries(filter.categories ?? {})) {
    const labels = new Map(info ? filterValues(info, category).map(option => [option.value, option.label]) : []);
    add(categoryName(category), values.map(value => labels.get(value) ?? (value || "Unassigned")));
  }
  if (filter.stat) {
    const { kind, k, perWafer } = filter.stat;
    parts.push(`Outliers ±${k}${kind === "sigma" ? "σ" : " IQR"} (${perWafer ? "per wafer" : "pooled"}${measurementPlot ? "" : ", inactive for this plot"})`);
  }
  for (const rule of filter.custom ?? []) {
    const { title, detail } = describeCustomFilter(rule, info);
    parts.push(`${title} ${detail}`);
  }
  return parts.length ? `Filters · ${parts.join(" · ")}` : "";
}

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

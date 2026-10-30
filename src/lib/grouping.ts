import type { DatasetInfo, Filter } from "../types";

export interface DataGroup {
  key: string;
  label: string;
  /** A single wafer when the group is one wafer; null for lot/custom/mean groups. */
  wafer: number | null;
  filter: Filter;
}

/**
 * Split the selected wafers into the same groups used by the wafer map and
 * Pareto mosaic: all wafers, one group per lot, one per wafer, or one per
 * custom-column category.
 */
export function dataGroups(
  info: DatasetInfo,
  filter: Filter,
  category: string,
  meanLabel = "All wafers (mean)"
): DataGroup[] {
  const candidates = info.wafers
    .map((w, index) => ({ w, index }))
    .filter(({ w, index }) => {
      if (filter.wafers.length && !filter.wafers.includes(index)) return false;
      if (filter.lots.length && !filter.lots.includes(w.lot)) return false;
      return true;
    });
  const kind = category || "none";
  if (kind === "site") {
    return (info.sites ?? []).filter((site) => !filter.sites?.length || filter.sites.includes(site)).map((site) => ({
      key: `site${site}`, label: site === 65535 ? "Unknown site" : `Site ${site}`,
      wafer: null, filter: { ...filter, sites: [site] },
    }));
  }
  if (kind === "none") {
    return [{ key: "all", label: meanLabel, wafer: null, filter }];
  }
  if (kind === "wafer") {
    return candidates.map(({ w, index }) => ({
      key: `w${index}`,
      label: `${info.lots[w.lot] ?? `Lot ${w.lot}`} / ${w.name}`,
      wafer: index,
      filter,
    }));
  }
  if (kind === "lot") {
    const byLot = new Map<number, number[]>();
    for (const { w, index } of candidates) {
      const list = byLot.get(w.lot) ?? [];
      list.push(index);
      byLot.set(w.lot, list);
    }
    return [...byLot.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([lot, indices]) => ({
        key: `lot${lot}`,
        label: info.lots[lot] ?? `Lot ${lot}`,
        wafer: null,
        filter: { ...filter, lots: [lot], wafers: indices },
      }));
  }
  const col = info.customColumns.find((c) => c.name === kind);
  if (!col) {
    return [{ key: "all", label: meanLabel, wafer: null, filter }];
  }
  const byCode = new Map<number, number[]>();
  for (const { index } of candidates) {
    const code = col.waferValues[index] ?? 0;
    const list = byCode.get(code) ?? [];
    list.push(index);
    byCode.set(code, list);
  }
  return [...byCode.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([code, indices]) => ({
      key: `c${code}`,
      label: col.categories[code] || "Unassigned",
      wafer: null,
      filter: { ...filter, wafers: indices },
    }));
}

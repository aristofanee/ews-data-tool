import { useCallback, useEffect, useState, type SetStateAction } from "react";
import type { PlotSpec } from "../types";
import { useStore } from "../store";
import { mapGeneration, rememberMap, rememberedMap } from "./mapCache";

export function usePlotSelection(kind: string, query: unknown) {
  const key = JSON.stringify([mapGeneration(), query]);
  const [state, setState] = useState(() => ({ key, index: rememberedMap(kind, key) }));
  const selected = state.key === key ? state.index : rememberedMap(kind, key);
  useEffect(() => { setState({ key, index: rememberedMap(kind, key) }); }, [kind, key]);
  const select = useCallback((next: SetStateAction<number | null>) => {
    const index = typeof next === "function" ? next(rememberedMap(kind, key)) : next;
    rememberMap(kind, key, index); setState({ key, index });
  }, [kind, key]);
  return [selected, select] as const;
}

export function usePlotViewKey(spec: PlotSpec) {
  const filters = useStore((s) => s.filters);
  const version = useStore((s) => s.dataVersion);
  const test = spec.type === "pareto" || spec.type === "binmap" ? null : spec.test;
  return JSON.stringify([mapGeneration(), version, filters, spec.type, test,
    spec.xAxis, spec.groupBy, spec.splitPlots, spec.binCategory, spec.top, spec.bins,
    spec.scatterX, spec.scatterY, spec.scatterZMode, spec.scatterZTest,
    spec.logY, spec.limitMode, spec.yMin, spec.yMax, spec.lsl, spec.usl]);
}

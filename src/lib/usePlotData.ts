import { useEffect, useState } from "react";
import * as api from "./api";
import { useStore } from "../store";
import type {
  BoxResponse,
  HistResponse,
  MapResponse,
  ParetoResponse,
  TrendResponse,
} from "../types";

export type PlotData =
  | { kind: "box"; data: BoxResponse }
  | { kind: "map"; data: MapResponse }
  | { kind: "pareto"; data: ParetoResponse }
  | { kind: "hist"; data: HistResponse }
  | { kind: "trend"; data: TrendResponse };

export interface PlotDataState {
  data: PlotData | null;
  loading: boolean;
  error: string | null;
}

export function usePlotData(): PlotDataState {
  const info = useStore((s) => s.info);
  const spec = useStore((s) => s.spec);
  const filters = useStore((s) => s.filters);
  const dataVersion = useStore((s) => s.dataVersion);
  const [state, setState] = useState<PlotDataState>({ data: null, loading: false, error: null });

  const key = JSON.stringify({
    type: spec.type,
    test: spec.test,
    groupBy: spec.groupBy,
    mapWafer: spec.mapWafer,
    mapMode: spec.mapMode,
    binCategory: spec.binCategory,
    top: spec.top,
    includePass: spec.includePass,
    bins: spec.bins,
    filters,
    dataVersion,
  });

  useEffect(() => {
    let alive = true;
    if (!info) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const run = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        let result: PlotData;
        switch (spec.type) {
          case "box": {
            if (spec.test === null) throw new Error("Select a test to plot.");
            result = {
              kind: "box",
              data: await api.boxPlot({ test: spec.test, groupBy: spec.groupBy, filter: filters }),
            };
            break;
          }
          case "map": {
            result = {
              kind: "map",
              data: await api.waferMap({
                wafer: spec.mapWafer ?? 0,
                test: spec.test,
                mode: spec.mapMode,
                filter: filters,
              }),
            };
            break;
          }
          case "pareto": {
            result = {
              kind: "pareto",
              data: await api.pareto({
                category: spec.binCategory,
                filter: filters,
                top: spec.top,
                includePass: spec.includePass,
              }),
            };
            break;
          }
          case "hist": {
            if (spec.test === null) throw new Error("Select a test to plot.");
            result = {
              kind: "hist",
              data: await api.histogram({ test: spec.test, filter: filters, bins: spec.bins }),
            };
            break;
          }
          case "trend": {
            if (spec.test === null) throw new Error("Select a test to plot.");
            result = {
              kind: "trend",
              data: await api.trend({ test: spec.test, by: spec.groupBy, filter: filters }),
            };
            break;
          }
          default:
            throw new Error("Unknown plot type");
        }
        if (alive) setState({ data: result, loading: false, error: null });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, loading: false, error: String(e) }));
      }
    };
    void run();
    return () => {
      alive = false;
    };
    // The key captures every query-relevant field; spec/filters are read from
    // the render that produced the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, info]);

  return state;
}

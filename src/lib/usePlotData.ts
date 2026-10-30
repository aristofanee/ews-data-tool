import { useEffect, useState } from "react";
import * as api from "./api";
import { useStore } from "../store";
import { mapGeneration } from "./mapCache";
import type {
  BinOverviewResponse,
  BoxResponse,
  HistResponse,
  MapResponse,
  ParetoResponse,
  ScatterResponse,
  TrendResponse,
} from "../types";

export type PlotData =
  | { kind: "box"; data: BoxResponse }
  | { kind: "map"; data: MapResponse }
  | { kind: "binmap"; data: BinOverviewResponse }
  | { kind: "pareto"; data: ParetoResponse }
  | { kind: "hist"; data: HistResponse }
  | { kind: "trend"; data: TrendResponse }
  | { kind: "scatter"; data: ScatterResponse };

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
  const [responseKey, setResponseKey] = useState<string | null>(null);

  const key = JSON.stringify({
    generation: mapGeneration(),
    type: spec.type,
    test: spec.test,
    xAxis: spec.xAxis,
    groupBy: spec.groupBy,
    mapMode: spec.mapMode,
    mapLsl: spec.type === "map" ? spec.lsl : null,
    mapUsl: spec.type === "map" ? spec.usl : null,
    binCategory: spec.binCategory,
    top: spec.top,
    bins: spec.bins,
    scatterX: spec.scatterX,
    scatterY: spec.scatterY,
    scatterZMode: spec.scatterZMode,
    scatterZTest: spec.scatterZTest,
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
              data: await api.boxPlot({
                test: spec.test,
                xAxis: spec.xAxis,
                groupBy: spec.groupBy,
                filter: filters,
              }),
            };
            break;
          }
          case "map": {
            result = {
              kind: "map",
              data: await api.waferMap({
                lsl: spec.lsl,
                usl: spec.usl,
                wafer: null,
                test: spec.test,
                mode: "value",
                filter: filters,
              }),
            };
            break;
          }
          case "binmap": {
            result = {
              kind: "binmap",
              data: await api.binOverview({ filter: filters, category: spec.binCategory }),
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
                groupBy: spec.xAxis === "none" ? null : spec.xAxis,
              }),
            };
            break;
          }
          case "hist": {
            if (spec.test === null) throw new Error("Select a test to plot.");
            result = {
              kind: "hist",
              data: await api.histogram({
                test: spec.test,
                filter: filters,
                bins: spec.bins,
                groupBy: spec.groupBy,
              }),
            };
            break;
          }
          case "trend": {
            if (spec.test === null) throw new Error("Select a test to plot.");
            result = {
              kind: "trend",
              data: await api.trend({ test: spec.test, by: spec.xAxis, filter: filters }),
            };
            break;
          }
          case "scatter": {
            if (spec.scatterX === null || spec.scatterY === null) {
              throw new Error("Select X and Y tests to plot.");
            }
            result = {
              kind: "scatter",
              data: await api.scatter({
                xTest: spec.scatterX,
                yTest: spec.scatterY,
                zMode: spec.scatterZMode,
                zTest: spec.scatterZTest,
                zCol: null,
                groupBy: spec.groupBy === "none" ? null : spec.groupBy,
                filter: filters,
              }),
            };
            break;
          }
          default:
            throw new Error("Unknown plot type");
        }
        if (alive) {
          setResponseKey(key);
          setState({ data: result, loading: false, error: null });
        }
      } catch (e) {
        if (alive) {
          setResponseKey(key);
          setState({ data: null, loading: false, error: String(e) });
        }
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

  return !info || responseKey === key ? state : { data: null, loading: true, error: null };
}

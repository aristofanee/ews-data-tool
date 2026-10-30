import type {
  BinOverviewResponse,
  BoxResponse,
  CsvInspection,
  CsvMapping,
  CustomColumn,
  DatasetInfo,
  Filter,
  HistResponse,
  MapResponse,
  ParetoResponse,
  ScatterResponse,
  TrendResponse,
} from "../types";
import * as mock from "./mock";
import { cachedMap, cachedPlot, invalidateMaps } from "./mapCache";

/** True when running inside the Tauri shell (real files, real dataset). */
export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ListenFn = <T>(
  event: string,
  handler: (e: { payload: T }) => void
) => Promise<() => void>;

let invokeFn: InvokeFn | null = null;
let listenFn: ListenFn | null = null;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!invokeFn) {
    const mod = await import("@tauri-apps/api/core");
    invokeFn = mod.invoke as InvokeFn;
  }
  return invokeFn<T>(cmd, args);
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

export async function pickFiles(): Promise<string[]> {
  if (!isTauri) return mock.pickFiles();
  return invoke<string[]>("pick_files");
}

export async function pickSavePath(defaultName: string, extensions: string[]): Promise<string | null> {
  if (!isTauri) return mock.pickSavePath(defaultName);
  return invoke<string | null>("pick_save_path", { defaultName, extensions });
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri) return mock.pickFolder();
  return invoke<string | null>("pick_folder");
}

export async function pickTemplate(): Promise<string | null> {
  if (!isTauri) return mock.pickSavePath("template.json");
  return invoke<string | null>("pick_template");
}

export async function openInExplorer(path: string): Promise<void> {
  if (!isTauri) return;
  return invoke<void>("open_in_explorer", { path });
}

/* ------------------------------------------------------------------ */
/* Dataset                                                             */
/* ------------------------------------------------------------------ */

export async function openPaths(
  paths: string[],
  onProgress?: (pct: number, msg: string) => void,
  mapping?: CsvMapping | null
): Promise<DatasetInfo> {
  invalidateMaps();
  const info = !isTauri ? await mock.openPaths(paths, onProgress) : await invoke<DatasetInfo>("open_paths", { paths, mapping: mapping ?? null });
  invalidateMaps();
  return info;
}

export async function inspectCsv(path: string): Promise<CsvInspection> {
  if (!isTauri) return mock.inspectCsv(path);
  return invoke<CsvInspection>("inspect_csv", { path });
}

export async function datasetInfo(): Promise<DatasetInfo | null> {
  if (!isTauri) return null;
  return invoke<DatasetInfo | null>("dataset_info");
}

export async function addCustomColumn(
  name: string,
  assignments: { wafer: number; label: string }[]
): Promise<DatasetInfo> {
  invalidateMaps();
  const info = !isTauri ? await mock.addCustomColumn(name, assignments) : await invoke<DatasetInfo>("add_custom_column", { name, assignments });
  invalidateMaps();
  return info;
}

export async function removeCustomColumn(name: string): Promise<DatasetInfo> {
  invalidateMaps();
  const info = !isTauri ? await mock.removeCustomColumn(name) : await invoke<DatasetInfo>("remove_custom_column", { name });
  invalidateMaps();
  return info;
}

export async function restoreCustomColumns(columns: CustomColumn[]): Promise<DatasetInfo> {
  invalidateMaps();
  const info = !isTauri ? await mock.restoreCustomColumns(columns) : await invoke<DatasetInfo>("restore_custom_columns", { columns });
  invalidateMaps();
  return info;
}

export function onImportProgress(cb: (pct: number, msg: string) => void): () => void {
  if (!isTauri) return mock.onProgress(cb);
  let unlisten: (() => void) | null = null;
  let disposed = false;
  void (async () => {
    if (!listenFn) {
      const mod = await import("@tauri-apps/api/event");
      listenFn = mod.listen as unknown as ListenFn;
    }
    const un = await listenFn<{ pct: number; msg: string }>("import-progress", (e) =>
      cb(e.payload.pct, e.payload.msg)
    );
    if (disposed) un();
    else unlisten = un;
  })();
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function boxPlot(req: {
  test: number;
  xAxis: string;
  groupBy?: string | null;
  filter: Filter;
  maxPoints?: number;
}): Promise<BoxResponse> {
  return cachedPlot("box_plot", req, () => !isTauri ? mock.boxPlot(req) : invoke<BoxResponse>("box_plot", { req }), (d) => 1024 + d.groups.reduce((n, g) => n + g.values.length * 24 + 512, 0));
}

export async function waferMap(req: {
  lsl?: number | null;
  usl?: number | null;
  wafer: number | null;
  test: number | null;
  mode: "value" | "bin";
  filter: Filter;
}): Promise<MapResponse> {
  return cachedMap("map", req, () => !isTauri ? mock.waferMap(req) : invoke<MapResponse>("wafer_map", { req }), (d) => d.dice.length);
}

export async function waferMaps(req: Parameters<typeof waferMap>[0]): Promise<MapResponse[]> {
  return cachedMap("waferMaps", req, async () => {
    if (isTauri) return invoke<MapResponse[]>("wafer_maps", { req });
    const info = mock.getDatasetInfo();
    return Promise.all(info.wafers.flatMap((w, wafer) =>
      (!req.filter.wafers.length || req.filter.wafers.includes(wafer)) &&
      (!req.filter.lots.length || req.filter.lots.includes(w.lot))
        ? [mock.waferMap({ ...req, wafer })] : []));
  }, (maps) => maps.reduce((n, d) => n + d.dice.length, 0));
}

export async function binOverview(req: {
  filter: Filter;
  category: "hard" | "soft";
}): Promise<BinOverviewResponse> {
  return cachedMap("bins", req.filter, () => !isTauri ? mock.binOverview(req) : invoke<BinOverviewResponse>("bin_overview", { req }), (d) => d.wafers.reduce((n, w) => n + w.dice.length, 0));
}

export async function pareto(req: {
  category: "hard" | "soft";
  filter: Filter;
  top?: number;
  groupBy?: string | null;
}): Promise<ParetoResponse> {
  return cachedPlot("pareto", req, () => !isTauri ? mock.pareto(req) : invoke<ParetoResponse>("pareto", { req }), (d) => 1024 + d.bars.length * 128 + d.groups.length * 128 + d.series.reduce((n, s) => n + s.counts.length * 16 + 128, 0));
}

export async function histogram(req: {
  test: number;
  filter: Filter;
  bins?: number | null;
  groupBy?: string | null;
}): Promise<HistResponse> {
  return cachedPlot("histogram", req, () => !isTauri ? mock.histogram(req) : invoke<HistResponse>("histogram", { req }), (d) => 1024 + d.counts.length * 16 + d.groups.reduce((n, g) => n + g.counts.length * 8 + 128, 0));
}

export async function trend(req: {
  test: number;
  by: string;
  filter: Filter;
}): Promise<TrendResponse> {
  return cachedPlot("trend", req, () => !isTauri ? mock.trend(req) : invoke<TrendResponse>("trend", { req }), (d) => 1024 + d.points.length * 128);
}

export async function scatter(req: {
  xTest: number;
  yTest: number;
  zMode: "none" | "continuous" | "category";
  zTest?: number | null;
  zCol?: string | null;
  groupBy?: string | null;
  filter: Filter;
  maxPoints?: number;
}): Promise<ScatterResponse> {
  return cachedPlot("scatter", req, () => !isTauri ? mock.scatter(req) : invoke<ScatterResponse>("scatter", { req }), (d) => 1024 + d.series.reduce((n, s) => n + s.points.length * 160 + 256, 0));
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

export async function exportCsv(path: string, filter: Filter): Promise<string> {
  if (!isTauri) return mock.exportCsv(path, filter);
  return invoke<string>("export_csv", { path, filter });
}

/** Persist a `data:image/...;base64,...` URL to disk. */
export async function saveImage(path: string, dataUrl: string): Promise<void> {
  if (!isTauri) return mock.saveBinary(path, dataUrl);
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return invoke<void>("save_binary", { path, dataBase64: b64 });
}

export async function saveText(path: string, contents: string): Promise<void> {
  if (!isTauri) return mock.saveText(path, contents);
  return invoke<void>("save_text", { path, contents });
}

export async function readText(path: string): Promise<string> {
  if (!isTauri) return mock.readText(path);
  return invoke<string>("read_text", { path });
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

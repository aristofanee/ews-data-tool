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
  if (!isTauri) return mock.openPaths(paths, onProgress);
  return invoke<DatasetInfo>("open_paths", { paths, mapping: mapping ?? null });
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
  if (!isTauri) return mock.addCustomColumn(name, assignments);
  return invoke<DatasetInfo>("add_custom_column", { name, assignments });
}

export async function removeCustomColumn(name: string): Promise<DatasetInfo> {
  if (!isTauri) return mock.removeCustomColumn(name);
  return invoke<DatasetInfo>("remove_custom_column", { name });
}

export async function restoreCustomColumns(columns: CustomColumn[]): Promise<DatasetInfo> {
  if (!isTauri) return mock.restoreCustomColumns(columns);
  return invoke<DatasetInfo>("restore_custom_columns", { columns });
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
  groupBy: "wafer" | "lot";
  filter: Filter;
  maxPoints?: number;
  blockCol?: string;
}): Promise<BoxResponse> {
  if (!isTauri) return mock.boxPlot(req);
  return invoke<BoxResponse>("box_plot", { req });
}

export async function waferMap(req: {
  wafer: number;
  test: number | null;
  mode: "value" | "bin";
  filter: Filter;
}): Promise<MapResponse> {
  if (!isTauri) return mock.waferMap(req);
  return invoke<MapResponse>("wafer_map", { req });
}

export async function binOverview(req: { filter: Filter }): Promise<BinOverviewResponse> {
  if (!isTauri) return mock.binOverview(req);
  return invoke<BinOverviewResponse>("bin_overview", { req });
}

export async function pareto(req: {
  category: "hard" | "soft";
  filter: Filter;
  top?: number;
  groupBy?: string | null;
}): Promise<ParetoResponse> {
  if (!isTauri) return mock.pareto(req);
  return invoke<ParetoResponse>("pareto", { req });
}

export async function histogram(req: {
  test: number;
  filter: Filter;
  bins?: number | null;
}): Promise<HistResponse> {
  if (!isTauri) return mock.histogram(req);
  return invoke<HistResponse>("histogram", { req });
}

export async function trend(req: {
  test: number;
  by: "wafer" | "lot";
  filter: Filter;
}): Promise<TrendResponse> {
  if (!isTauri) return mock.trend(req);
  return invoke<TrendResponse>("trend", { req });
}

export async function scatter(req: {
  xTest: number;
  yTest: number;
  zMode: "none" | "continuous" | "category";
  zTest?: number | null;
  zCol?: string | null;
  filter: Filter;
  maxPoints?: number;
}): Promise<ScatterResponse> {
  if (!isTauri) return mock.scatter(req);
  return invoke<ScatterResponse>("scatter", { req });
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

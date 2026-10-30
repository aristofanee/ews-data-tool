import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter, MapResponse, PlotSpec } from "../types";
import * as api from "../lib/api";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import {
  mapColorLimits,
  renderMapImage,
  type MapOptions,
} from "../charts/waferMap";
import { testLabelWithUnits } from "../lib/format";
import { dataGroups, type DataGroup } from "../lib/grouping";
import { WaferMapView } from "./WaferMapView";
import { MapGallery, useMapSelection } from "./MapGallery";
import { MapDetailView } from "./MapDetailView";
import { mapGeneration } from "../lib/mapCache";

export interface MapFacetExportApi {
  toDataURLs: (
    format?: "jpeg" | "png",
    theme?: Theme,
    width?: number,
    height?: number
  ) => { label: string; url: string }[];
}

interface Props {
  spec: PlotSpec;
  filter: Filter;
  onReady?: (api: MapFacetExportApi | null) => void;
}

interface Entry {
  md: MapResponse;
  label: string;
}

/**
 * One value map per selected group. A single group renders as a full map;
 * several groups render as a mosaic of clickable previews. The previews are
 * static (no legend, hover or zoom) so the grid scrolls normally.
 */
export function MapFacetView({ spec, filter, onReady }: Props) {
  const info = useStore((s) => s.info);
  const theme = useStore((s) => s.theme);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dataVersion = useStore((s) => s.dataVersion);
  const requestKey = JSON.stringify([mapGeneration(), dataVersion, filter, spec.test, spec.groupBy, spec.lsl, spec.usl]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [selected, setSelected] = useMapSelection("value", [dataVersion, filter, spec.test, spec.groupBy, spec.lsl, spec.usl]);

  const groups = useMemo<DataGroup[]>(
    () => (info ? dataGroups(info, filter, spec.groupBy || "none") : []),
    [info, filter, spec.groupBy]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const out: Entry[] = [];
        const batch = spec.groupBy === "wafer" ? await api.waferMaps({
          wafer: null, test: spec.test, mode: "value", filter, lsl: spec.lsl, usl: spec.usl,
        }) : null;
        for (const group of groups) {
          if (!alive) return;
          const md = batch?.find((m) => m.wafer?.name === info?.wafers[group.wafer!]?.name && m.wafer?.lot === info?.wafers[group.wafer!]?.lot) ?? await api.waferMap({
            lsl: spec.lsl,
            usl: spec.usl,
            wafer: group.wafer,
            test: spec.test,
            mode: "value",
            filter: group.filter,
          });
          if (md.dice.length === 0) continue;
          out.push({ md, label: group.label });
        }
        if (alive) {
          setEntries(out);
          setLoadedKey(requestKey);
          setLoading(false);
        }
      } catch (e) {
        if (alive) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [groups, spec.test, spec.lsl, spec.usl, requestKey]);

  useEffect(() => {
    if (!loading && selected !== null && selected >= entries.length) setSelected(null);
  }, [entries.length, selected, loading]);

  const binNames = useMemo(() => {
    const out: Record<number, string> = {};
    for (const b of info?.[spec.binCategory === "soft" ? "sbins" : "hbins"] ?? []) {
      out[b.code] = b.name;
    }
    return out;
  }, [info, spec.binCategory]);

  const binPass = useMemo(
    () =>
      (info?.[spec.binCategory === "soft" ? "sbins" : "hbins"] ?? [])
        .filter((b) => b.pass)
        .map((b) => b.code),
    [info, spec.binCategory]
  );

  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const specRef = useRef(spec);
  specRef.current = spec;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const binNamesRef = useRef(binNames);
  binNamesRef.current = binNames;
  const binPassRef = useRef(binPass);
  binPassRef.current = binPass;

  useEffect(() => {
    readyRef.current?.({
      toDataURLs: (format = "jpeg", themeOverride, width = 2400, height = 1500) => {
        const sp = specRef.current;
        return entriesRef.current.map(({ md, label }) => {
          const title = `${sp.title} · ${label}`;
          const limits = mapColorLimits(sp, md);
          const opts: MapOptions = {
            theme: themeOverride ?? themeRef.current,
            palette: sp.palette,
            mode: "value",
            lsl: sp.showLimits ? (sp.lsl ?? md.lsl) : null,
            usl: sp.showLimits ? (sp.usl ?? md.usl) : null,
            binNames: binNamesRef.current,
            binCategory: sp.binCategory,
            binPass: binPassRef.current,
            vmin: limits.vmin,
            vmax: limits.vmax,
            presentation: sp.presentation,
          };
          const subtitle =
            `${label}` +
            (md.test ? ` · ${testLabelWithUnits(md.test)}` : "") +
            ` · Yield ${md.yieldPct.toFixed(2)}%`;
          return {
            label,
            url: renderMapImage(md, opts, width, height, title, subtitle, format),
          };
        });
      },
    });
    return () => readyRef.current?.(null);
  }, []);

  if (error) return <div className="chart-placeholder">{error}</div>;
  if (loading || loadedKey !== requestKey) return <div className="chart-placeholder">Loading {groups.length} wafer maps…</div>;
  if (entries.length === 0) return <div className="chart-placeholder">No wafers match the current filters.</div>;

  const labels = entries.map((e) => e.label);

  if (selected !== null && entries[selected]) {
    return (
      <MapDetailView
        maps={entries.map((e) => e.md)}
        labels={labels}
        index={selected}
        spec={spec}
        mode="value"
        onIndex={setSelected}
        onBack={() => setSelected(null)}
      />
    );
  }

  if (entries.length === 1) {
    const entry = entries[0];
    return (
      <WaferMapView
        data={entry.md}
        spec={{ ...spec, mapMode: "value", title: `${spec.title} · ${entry.label}` }}
      />
    );
  }

  return <MapGallery entries={entries.map(({ md, label }) => ({ md, label,
    lot: !md.isMean ? md.lotName : spec.groupBy === "lot" ? label : "Grouped maps" }))}
    spec={spec} mode="value" onOpen={setSelected} />;
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter, MapResponse, PlotSpec } from "../types";
import * as api from "../lib/api";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import { renderMapImage, type MapOptions } from "../charts/waferMap";
import { testLabelWithUnits } from "../lib/format";
import { WaferMapView } from "./WaferMapView";
import { MapDetailView } from "./MapDetailView";

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

/**
 * A map split is one value map per wafer. The mosaic tiles are static
 * previews (no legend, hover or zoom) so the grid scrolls normally; clicking
 * one opens the same full-size detail view used by the Bin map mosaic.
 */
export function MapFacetView({ spec, filter, onReady }: Props) {
  const info = useStore((s) => s.info);
  const theme = useStore((s) => s.theme);
  const [maps, setMaps] = useState<MapResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const candidates = useMemo(() => {
    if (!info) return [];
    return info.wafers
      .map((w, index) => ({ w, index }))
      .filter(({ w, index }) => {
        if (filter.wafers.length && !filter.wafers.includes(index)) return false;
        if (filter.lots.length && !filter.lots.includes(w.lot)) return false;
        return true;
      });
  }, [info, filter]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const out: MapResponse[] = [];
        for (const { index } of candidates) {
          const md = await api.waferMap({
            wafer: index,
            test: spec.test,
            mode: "value",
            filter,
          });
          if (!md.wafer || md.dice.length === 0) continue;
          out.push(md);
        }
        if (alive) {
          setMaps(out);
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
  }, [candidates, spec.test, filter]);

  useEffect(() => {
    if (selected !== null && selected >= maps.length) setSelected(null);
  }, [maps.length, selected]);

  const binNames = useMemo(() => {
    const out: Record<number, string> = {};
    for (const b of info?.hbins ?? []) out[b.code] = b.name;
    return out;
  }, [info]);

  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const mapsRef = useRef(maps);
  mapsRef.current = maps;
  const specRef = useRef(spec);
  specRef.current = spec;
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const binNamesRef = useRef(binNames);
  binNamesRef.current = binNames;

  useEffect(() => {
    readyRef.current?.({
      toDataURLs: (format = "jpeg", themeOverride, width = 2400, height = 1500) => {
        const sp = specRef.current;
        return mapsRef.current.map((md) => {
          const label = `${md.lotName} / ${md.wafer?.name ?? "?"}`;
          const title = `${sp.title} · ${label}`;
          const opts: MapOptions = {
            theme: themeOverride ?? themeRef.current,
            palette: sp.palette,
            mode: "value",
            lsl: sp.showLimits ? (sp.lsl ?? md.lsl) : null,
            usl: sp.showLimits ? (sp.usl ?? md.usl) : null,
            binNames: binNamesRef.current,
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
  if (loading) return <div className="chart-placeholder">Loading {candidates.length} wafer maps…</div>;
  if (maps.length === 0) return <div className="chart-placeholder">No wafers match the current filters.</div>;

  if (selected !== null && maps[selected]) {
    return (
      <MapDetailView
        maps={maps}
        index={selected}
        spec={spec}
        mode="value"
        onIndex={setSelected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <div className="facet-grid map-facets">
      {maps.map((md, i) => {
        const label = `${md.lotName} / ${md.wafer?.name ?? "?"}`;
        return (
          <div className="facet-card" key={label}>
            <div className="facet-label">
              {label} · {md.yieldPct.toFixed(1)}%
            </div>
            <div className="facet-map">
              <WaferMapView
                data={md}
                spec={{ ...spec, mapMode: "value", title: `${spec.title} · ${label}` }}
                preview
                onOpen={() => setSelected(i)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

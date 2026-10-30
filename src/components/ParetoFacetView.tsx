import { useEffect, useMemo, useRef, useState } from "react";
import type { Filter, ParetoResponse, PlotSpec } from "../types";
import * as api from "../lib/api";
import { useStore } from "../store";
import type { Theme } from "../lib/theme";
import { figurePareto, type Figure } from "../charts/figures";
import { dataGroups } from "../lib/grouping";
import { PlotlyChart } from "./PlotlyChart";
import { PlotPreviewGrid } from "./PlotPreviewGrid";
import { usePlotSelection, usePlotViewKey } from "../lib/usePlotMemory";
import { IconArrowLeft, IconChevronLeft, IconChevronRight } from "./Icons";

export interface ParetoFacetExportApi {
  figures: (theme?: Theme) => { label: string; figure: Figure }[];
}

interface Props {
  spec: PlotSpec;
  filter: Filter;
  onReady?: (api: ParetoFacetExportApi | null) => void;
}

interface Entry {
  data: ParetoResponse;
  label: string;
}

/**
 * One Pareto per selected group. Several groups are rendered as static,
 * clickable thumbnails; a single group is shown at full size.
 */
export function ParetoFacetView({ spec, filter, onReady }: Props) {
  const info = useStore((s) => s.info);
  const theme = useStore((s) => s.theme);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const viewKey = usePlotViewKey(spec);
  const [selected, setSelected] = usePlotSelection("pareto-split", viewKey);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  const groups = useMemo(
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
        for (const group of groups) {
          if (!alive) return;
          const data = await api.pareto({
            category: spec.binCategory,
            filter: group.filter,
            top: spec.top,
            groupBy: spec.xAxis === "none" ? null : spec.xAxis,
          });
          if (data.total === 0) continue;
          out.push({ data, label: group.label });
        }
        if (alive) {
          setEntries(out);
          setLoadedKey(viewKey);
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
  }, [groups, spec.binCategory, spec.top, spec.xAxis, viewKey]);

  useEffect(() => {
    if (!loading && selected !== null && selected >= entries.length) setSelected(null);
  }, [entries.length, selected, loading]);

  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const specRef = useRef(spec);
  specRef.current = spec;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    readyRef.current?.({
      figures: (themeOverride) => {
        const sp = specRef.current;
        return entriesRef.current.map(({ data, label }) => ({
          label,
          figure: figurePareto(data, {
            theme: themeOverride ?? themeRef.current,
            spec: sp,
            title: `${sp.title} · ${label}`,
          }),
        }));
      },
    });
    return () => readyRef.current?.(null);
  }, []);

  useEffect(() => {
    if (selected === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (target?.isContentEditable || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelected((i) => (i === null ? null : Math.max(0, i - 1)));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelected((i) => (i === null ? null : Math.min(entries.length - 1, i + 1)));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, entries.length]);

  if (error) return <div className="chart-placeholder">{error}</div>;
  if (loading || loadedKey !== viewKey) {
    return (
      <div className="chart-placeholder">
        <div className="spinner" />
        <span>Loading {groups.length} Pareto plots…</span>
      </div>
    );
  }
  if (entries.length === 0) {
    return <div className="chart-placeholder">No dice match the current filters.</div>;
  }

  if (selected !== null && entries[selected]) {
    const entry = entries[selected];
    return (
      <div className="facet-detail">
        <div className="facet-detail-head">
          <button className="btn map-detail-back" onClick={() => setSelected(null)} title="Back to all plots">
            <IconArrowLeft size={14} />
            All plots
          </button>
          <div className="facet-detail-title">{entry.label}</div>
          <div className="map-detail-nav">
            <button
              className="btn icon"
              onClick={() => setSelected(Math.max(0, selected - 1))}
              disabled={selected <= 0}
              title="Previous plot (left arrow)"
            >
              <IconChevronLeft size={16} />
            </button>
            <span className="map-detail-count">
              {selected + 1} / {entries.length}
            </span>
            <button
              className="btn icon"
              onClick={() => setSelected(Math.min(entries.length - 1, selected + 1))}
              disabled={selected >= entries.length - 1}
              title="Next plot (right arrow)"
            >
              <IconChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="facet-detail-body">
          <PlotlyChart
            cacheKey={`${viewKey}:${entries[selected].label}`}
            key={entry.label}
            figure={figurePareto(entry.data, { theme, spec, title: undefined })}
          />
        </div>
      </div>
    );
  }


  return (
    <PlotPreviewGrid>
      {entries.map(({ data, label }, i) => {
        const preview = figurePareto(data, { theme, spec, preview: true });
        return (
          <div
            className="facet-card preview"
            key={label}
            onClick={() => setSelected(i)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelected(i);
              }
            }}
          >
            <div className="facet-label">
              {label} · <span className="yield-value">{data.yieldPct.toFixed(1)}%</span>
            </div>
            <div className="facet-chart-body">
              <PlotlyChart figure={preview} staticPlot />
              <button
                className="facet-open"
                aria-label={`Open ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(i);
                }}
              />
            </div>
          </div>
        );
      })}
    </PlotPreviewGrid>
  );
}

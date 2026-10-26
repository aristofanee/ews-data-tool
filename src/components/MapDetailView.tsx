import { useEffect, useMemo } from "react";
import type { MapResponse, PlotSpec } from "../types";
import { fmtInt, testLabelWithUnits } from "../lib/format";
import { WaferMapView, type MapExportApi } from "./WaferMapView";
import { IconArrowLeft, IconChevronLeft, IconChevronRight } from "./Icons";

interface Props {
  maps: MapResponse[];
  index: number;
  spec: PlotSpec;
  mode: "value" | "bin";
  onBack: () => void;
  onIndex: (index: number) => void;
  onReady?: (api: MapExportApi | null) => void;
}

/**
 * Shared enlarged-map view used by both the Bin map mosaic and the split-map
 * mosaic. It is intentionally not a modal: the detail map gets the same full
 * chart body as the single Wafer map tab.
 */
export function MapDetailView({ maps, index, spec, mode, onBack, onIndex, onReady }: Props) {
  const md = maps[index] ?? null;
  const mapSpec = useMemo(
    () => ({ ...spec, type: "map" as const, mapMode: mode }),
    [spec, mode]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (target?.isContentEditable || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (index > 0) onIndex(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (index < maps.length - 1) onIndex(index + 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, maps.length, onBack, onIndex]);

  if (!md) {
    return (
      <div className="chart-placeholder">
        No wafer maps match the current filters.
      </div>
    );
  }

  const name = md.wafer?.name || "?";
  const scope = mode === "bin" ? "Hard bin map" : md.test ? testLabelWithUnits(md.test) : "Value map";

  return (
    <div className="map-detail">
      <div className="map-detail-head">
        <button className="btn map-detail-back" onClick={onBack} title="Back to all maps">
          <IconArrowLeft size={14} />
          All maps
        </button>
        <div className="map-detail-heading">
          <div className="map-detail-title" title={`Wafer map - ${name}`}>
            Wafer map - {name}
          </div>
          <div className="map-detail-sub">
            {md.lotName} · {scope}
          </div>
        </div>
        <div className="map-detail-stats">
          <div className="map-detail-stat">
            <span>Yield</span>
            <b>{md.yieldPct.toFixed(2)}%</b>
          </div>
          <div className="map-detail-stat">
            <span>Pass</span>
            <b>{fmtInt(md.pass)}</b>
          </div>
          <div className="map-detail-stat">
            <span>Fail</span>
            <b>{fmtInt(md.fail)}</b>
          </div>
          <div className="map-detail-stat">
            <span>Dice</span>
            <b>{fmtInt(md.dice.length)}</b>
          </div>
        </div>
        <div className="map-detail-nav">
          <button
            className="btn icon"
            onClick={() => onIndex(index - 1)}
            disabled={index <= 0}
            title="Previous wafer (left arrow)"
          >
            <IconChevronLeft size={16} />
          </button>
          <span className="map-detail-count">
            {index + 1} / {maps.length}
          </span>
          <button
            className="btn icon"
            onClick={() => onIndex(index + 1)}
            disabled={index >= maps.length - 1}
            title="Next wafer (right arrow)"
          >
            <IconChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className="map-detail-body">
        <WaferMapView data={md} spec={mapSpec} onReady={onReady} />
      </div>
    </div>
  );
}

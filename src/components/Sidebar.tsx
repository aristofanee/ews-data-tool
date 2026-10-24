import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { Filter } from "../types";
import { binColor } from "../lib/theme";
import { fmtInt } from "../lib/format";
import { IconChevronDown, IconChevronUp, IconSearch, IconSliders } from "./Icons";

function FilterPanel() {
  const info = useStore((s) => s.info);
  const filters = useStore((s) => s.filters);
  const patch = useStore((s) => s.patchFilters);
  const toggle = useStore((s) => s.toggleArrayFilter);
  const reset = useStore((s) => s.resetFilters);
  const [wafersOpen, setWafersOpen] = useState(false);

  if (!info) return null;

  const waferItems = info.wafers
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => filters.lots.length === 0 || filters.lots.includes(w.lot));

  const toggleLot = (i: number) => {
    const lots = filters.lots.includes(i) ? filters.lots.filter((x) => x !== i) : [...filters.lots, i];
    patch({ lots, wafers: [] });
  };

  const setStatKind = (kind: "none" | "sigma" | "iqr") => {
    if (kind === "none") {
      patch({ stat: null });
    } else {
      patch({
        stat: {
          kind,
          k: filters.stat?.k ?? (kind === "sigma" ? 3 : 1.5),
          perWafer: filters.stat?.perWafer ?? true,
        },
      });
    }
  };

  const patchStat = (p: Partial<NonNullable<Filter["stat"]>>) => {
    if (!filters.stat) return;
    patch({ stat: { ...filters.stat, ...p } });
  };

  const activeFilters =
    filters.lots.length + filters.wafers.length + filters.hbins.length + (filters.passOnly ? 1 : 0) + (filters.stat ? 1 : 0);

  return (
    <div className="filter-panel">
      <div className="side-section-head">
        <span>
          <IconSliders size={14} /> Filters
        </span>
        {activeFilters > 0 && (
          <button className="link-btn" onClick={reset}>
            Reset
          </button>
        )}
      </div>

      <div className="filter-block">
        <div className="filter-label">
          Lot <span className="filter-count">{filters.lots.length ? `${filters.lots.length} selected` : "all"}</span>
        </div>
        <div className="chip-wrap">
          {info.lots.map((name, i) => (
            <button
              key={i}
              className={"chip" + (filters.lots.includes(i) ? " on" : "")}
              onClick={() => toggleLot(i)}
              title={name}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-block">
        <button className="filter-label as-button" onClick={() => setWafersOpen((v) => !v)}>
          <span>
            Wafers{" "}
            <span className="filter-count">
              {filters.wafers.length ? `${filters.wafers.length} of ${waferItems.length}` : `all ${waferItems.length}`}
            </span>
          </span>
          {wafersOpen ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
        </button>
        {wafersOpen && (
          <>
            <div className="wafer-tools">
              <button className="link-btn" onClick={() => patch({ wafers: [] })}>
                All
              </button>
              <button
                className="link-btn"
                onClick={() =>
                  patch({
                    wafers: waferItems.filter(({ i }) => !filters.wafers.includes(i)).map(({ i }) => i),
                  })
                }
              >
                Invert
              </button>
            </div>
            <div className="chip-wrap wafer-grid">
              {waferItems.map(({ w, i }) => (
                <button
                  key={i}
                  className={"chip wafer" + (filters.wafers.includes(i) ? " on" : "")}
                  onClick={() => toggle("wafers", i)}
                  title={`${info.lots[w.lot]} / ${w.name}`}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="filter-block">
        <div className="filter-label">
          Hard bin <span className="filter-count">{filters.hbins.length ? `${filters.hbins.length} selected` : "all"}</span>
        </div>
        <div className="chip-wrap">
          {info.hbins.map((b) => (
            <button
              key={b.code}
              className={"chip bin-chip" + (filters.hbins.includes(b.code) ? " on" : "")}
              onClick={() => toggle("hbins", b.code)}
              title={`${b.name || `Bin ${b.code}`} · ${fmtInt(b.count)} dice`}
            >
              <span className="bin-dot" style={{ background: binColor(b.code, b.pass) }} />
              {b.code}
              <span className="bin-name">{b.name}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={filters.passOnly}
          onChange={(e) => patch({ passOnly: e.target.checked })}
        />
        Pass dice only
      </label>

      <div className="filter-block">
        <div className="filter-label">Outlier filter</div>
        <select
          className="input"
          value={filters.stat?.kind ?? "none"}
          onChange={(e) => setStatKind(e.target.value as "none" | "sigma" | "iqr")}
        >
          <option value="none">None</option>
          <option value="sigma">k · sigma</option>
          <option value="iqr">IQR fence (k · IQR)</option>
        </select>
        {filters.stat && (
          <div className="stat-row">
            <span className="muted">k</span>
            <input
              className="input tiny"
              type="number"
              step="0.1"
              min="0.1"
              value={filters.stat.k}
              onChange={(e) => patchStat({ k: Number(e.target.value) })}
            />
            <label className="check-row inline">
              <input
                type="checkbox"
                checked={filters.stat.perWafer}
                onChange={(e) => patchStat({ perWafer: e.target.checked })}
              />
              per wafer
            </label>
          </div>
        )}
        <div className="hint">Outliers are removed from every plot, and the count is shown above the chart.</div>
      </div>
    </div>
  );
}

function TestList() {
  const info = useStore((s) => s.info);
  const selected = useStore((s) => s.spec.test);
  const selectTest = useStore((s) => s.selectTest);
  const [q, setQ] = useState("");
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const rows = useMemo(() => {
    if (!info) return [];
    const needle = q.trim().toLowerCase();
    return info.tests
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !needle || t.name.toLowerCase().includes(needle) || t.units.toLowerCase().includes(needle));
  }, [info, q]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!info) return null;

  return (
    <div className="test-panel">
      <div className="side-section-head">
        <span>Tests</span>
        <span className="count-pill">{rows.length === info.tests.length ? info.tests.length : `${rows.length}/${info.tests.length}`}</span>
      </div>
      <div className="search-box">
        <IconSearch size={14} />
        <input placeholder="Search test or unit…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <button className="link-btn" onClick={() => setQ("")}>
            clear
          </button>
        )}
      </div>
      <div className="test-list">
        {rows.map(({ t, i }) => (
          <button
            key={i}
            ref={i === selected ? activeRef : undefined}
            className={"test-row" + (i === selected ? " active" : "")}
            onClick={() => selectTest(i)}
            title={`${t.name}${t.units ? ` [${t.units}]` : ""} · ${fmtInt(t.count)} values`}
          >
            <span className={"test-dot" + (t.count > 0 ? " has" : "")} />
            <span className="test-name">{t.name}</span>
            <span className="test-units">{t.units}</span>
          </button>
        ))}
        {rows.length === 0 && <div className="empty-list">No test matches “{q}”.</div>}
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="side-scroll">
        <FilterPanel />
      </div>
      <TestList />
    </aside>
  );
}

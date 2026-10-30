import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import type { CustomColumn, Filter } from "../types";
import * as api from "../lib/api";
import { binColor } from "../lib/theme";
import { fmtInt, tidyName } from "../lib/format";
import {
  IconChevronDown,
  IconChevronUp,
  IconLayers,
  IconPlus,
  IconSearch,
  IconSliders,
  IconTrash,
  IconX,
} from "./Icons";

function fuzzyMatch(text: string, needle: string): boolean {
  if (!needle) return true;
  const hay = text.toLowerCase();
  if (hay.includes(needle)) return true;
  let pos = 0;
  for (const ch of needle) {
    pos = hay.indexOf(ch, pos);
    if (pos < 0) return false;
    pos++;
  }
  return true;
}

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
    filters.lots.length + filters.wafers.length + filters.hbins.length + (filters.stat ? 1 : 0);

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
          HBIN <span className="filter-count">{filters.hbins.length ? `${filters.hbins.length} selected` : "all"}</span>
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
      </div>
    </div>
  );
}

interface ColumnDraft {
  name: string;
  editing: boolean;
  label: string;
  selected: number[];
  /** Local, uncommitted labels keyed by wafer index. */
  pending: Record<number, string>;
}

function CustomColumnsPanel() {
  const info = useStore((s) => s.info);
  const filters = useStore((s) => s.filters);
  const spec = useStore((s) => s.spec);
  const setInfo = useStore((s) => s.setInfo);
  const patchSpec = useStore((s) => s.patchSpec);
  const setError = useStore((s) => s.setError);
  const notify = useStore((s) => s.notify);
  const [draft, setDraft] = useState<ColumnDraft | null>(null);

  if (!info) return null;

  const openNew = () => {
    setDraft({
      name: "",
      editing: false,
      label: "",
      selected: filters.wafers.length ? [...filters.wafers] : [],
      pending: {},
    });
  };

  const openEdit = (col: CustomColumn) => {
    const selected = col.waferValues
      .map((v, i) => (v !== 0 ? i : -1))
      .filter((i) => i >= 0);
    const pending: Record<number, string> = {};
    col.waferValues.forEach((code, i) => {
      pending[i] = code ? col.categories[code] ?? "" : "";
    });
    setDraft({ name: col.name, editing: true, label: "", selected, pending });
  };

  const currentColumn = draft
    ? info.customColumns.find((c) => c.name === draft.name) ?? null
    : null;

  const labelFor = (wi: number) => {
    if (draft && Object.prototype.hasOwnProperty.call(draft.pending, wi)) {
      return draft.pending[wi] ?? "";
    }
    if (!currentColumn) return "";
    const code = currentColumn.waferValues[wi] ?? 0;
    return code ? currentColumn.categories[code] ?? "" : "";
  };

  const toggleWafer = (wi: number) => {
    if (!draft) return;
    setDraft({
      ...draft,
      selected: draft.selected.includes(wi)
        ? draft.selected.filter((x) => x !== wi)
        : [...draft.selected, wi],
    });
  };

  const selectUnassigned = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      selected: info.wafers.map((_, i) => i).filter((i) => !labelFor(i)),
    });
  };

  /** Stage a label for the selected wafers; nothing is sent to Rust yet. */
  const assignToSelected = () => {
    if (!draft) return;
    if (!draft.selected.length) {
      setError("Select at least one wafer first.");
      return;
    }
    const label = draft.label.trim();
    const pending = { ...draft.pending };
    for (const wi of draft.selected) pending[wi] = label;
    setDraft({ ...draft, pending, label: "" });
    setError(null);
  };

  const apply = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setError("Enter a column name.");
      return;
    }
    // Saving also commits a label that is currently typed but not yet staged,
    // so the quick one-label workflow still works without an extra click.
    const pending = { ...draft.pending };
    if (draft.label.trim() && draft.selected.length) {
      for (const wi of draft.selected) pending[wi] = draft.label.trim();
    }
    const assignments = Object.entries(pending).map(([wafer, label]) => ({
      wafer: Number(wafer),
      label,
    }));
    if (!assignments.length) {
      setError("Assign a label to at least one wafer.");
      return;
    }
    if (!draft.editing && !assignments.some((a) => a.label.trim())) {
      setError("Assign a label to at least one wafer.");
      return;
    }
    try {
      const before = useStore.getState();
      const title = before.spec.title;
      const updated = await api.addCustomColumn(name, assignments);
      before.setInfo(updated, { keepFilters: true });
      useStore.getState().patchSpec({ title });
      const assigned = assignments.filter((a) => a.label.trim()).length;
      notify(
        `Label column "${name}" saved · ${assigned} labelled wafer${
          assigned === 1 ? "" : "s"
        }`
      );
      setDraft(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const remove = async (col: CustomColumn) => {
    if (!window.confirm(`Delete the label column “${col.name}”?`)) return;
    try {
      const updated = await api.removeCustomColumn(col.name);
      setInfo(updated, { keepFilters: true });
      if (spec.groupBy === col.name) patchSpec({ groupBy: "none" });
      notify(`Deleted label column “${col.name}”.`);
    } catch (e) {
      setError(String(e));
    }
  };

  const labels = currentColumn
    ? currentColumn.categories.filter((c, i) => i > 0 && c.length > 0)
    : [];

  return (
    <div className="filter-panel custom-panel">
      <div className="side-section-head">
        <span>
          <IconLayers size={14} /> Custom labels
        </span>
        <button className="link-btn" onClick={openNew}>
          + Add column
        </button>
      </div>
      {info.customColumns.length === 0 ? (
        <div className="empty-list">No custom columns yet.</div>
      ) : (
        <div className="custom-column-list">
          {info.customColumns.map((c) => (
            <div className="custom-column-row" key={c.name}>
              <button className="custom-column-main" onClick={() => openEdit(c)} title="Edit labels">
                <span className="custom-column-name">{c.name}</span>
                <span className="custom-column-count">
                  {c.categories.length - 1} label{c.categories.length === 2 ? "" : "s"}
                </span>
              </button>
              <button className="mini danger" onClick={() => void remove(c)} title="Delete column">
                <IconTrash size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {draft && (
        <div className="modal-backdrop" onClick={() => setDraft(null)}>
          <div className="modal column-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">
                  {draft.editing ? "Edit label column" : "New label column"}
                </div>
              </div>
              <button className="btn icon ghost" onClick={() => setDraft(null)} title="Close">
                <IconX size={15} />
              </button>
            </div>
            <div className="modal-body">
              <label className="modal-field">
                <span>Column name</span>
                <input
                  className="input"
                  value={draft.name}
                  disabled={draft.editing}
                  autoFocus={!draft.editing}
                  placeholder="e.g. Split"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label className="modal-field">
                <span>Label for selected wafers</span>
                <div className="label-assign-row">
                  <input
                    className="input"
                    value={draft.label}
                    autoFocus={draft.editing}
                    placeholder={draft.editing ? "e.g. Split A (blank clears)" : "e.g. Split A"}
                    list="custom-label-options"
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        assignToSelected();
                      }
                    }}
                  />
                  <button className="btn" onClick={assignToSelected} type="button">
                    Assign
                  </button>
                </div>
                <datalist id="custom-label-options">
                  {labels.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </label>
              <div className="column-tools">
                <span className="muted">
                  {draft.selected.length} selected ·{" "}
                  {Object.values(draft.pending).filter((v) => v.trim()).length} labels staged
                </span>
                <button
                  className="link-btn"
                  onClick={() =>
                    setDraft({ ...draft, selected: info.wafers.map((_, i) => i) })
                  }
                >
                  All
                </button>
                <button className="link-btn" onClick={() => setDraft({ ...draft, selected: [] })}>
                  None
                </button>
                {draft.editing && (
                  <button className="link-btn" onClick={selectUnassigned}>
                    Unassigned
                  </button>
                )}
              </div>
              <div className="column-wafer-list">
                {info.wafers.map((w, i) => {
                  const current = labelFor(i);
                  return (
                    <label
                      key={i}
                      className={
                        "wafer-check" + (draft.selected.includes(i) ? " on" : "")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={draft.selected.includes(i)}
                        onChange={() => toggleWafer(i)}
                      />
                      <span className="wafer-check-name">
                        {info.lots[w.lot]} / {w.name}
                      </span>
                      {current && <span className="wafer-check-label">{current}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void apply()}>
                {draft.editing ? "Save labels" : "Create column"}
              </button>
            </div>
          </div>
        </div>
      )}
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
    const tokens = needle.split(/\s+/).filter(Boolean);
    return info.tests
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => {
        if (!tokens.length) return true;
        const hay = `${tidyName(t.name)} ${t.units}`.toLowerCase();
        return tokens.every((token) => fuzzyMatch(hay, token));
      });
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
            title={`${tidyName(t.name)}${t.units ? ` [${t.units}]` : ""} · ${fmtInt(t.count)} values`}
          >
            <span className={"test-dot" + (t.count > 0 ? " has" : "")} />
            <span className="test-name">{tidyName(t.name)}</span>
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
        <CustomColumnsPanel />
      </div>
      <TestList />
    </aside>
  );
}

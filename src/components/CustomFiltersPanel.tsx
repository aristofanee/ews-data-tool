import { useEffect, useMemo, useState } from "react";
import type { CustomFilter, DatasetInfo, TestDistribution } from "../types";
import { useStore } from "../store";
import { categoryName } from "../lib/categoryNames";
import { describeCustomFilter, filterCategories, filterValues } from "../lib/customFilters";
import { IconSliders, IconTrash, IconX } from "./Icons";
import { SearchCombobox } from "./SearchCombobox";
import { FilterRange, measurementText } from "./FilterRange";
import { testLabelWithUnits } from "../lib/format";
import { testDistribution } from "../lib/api";

function AddFilterDialog({ info, close, add }: {
  info: DatasetInfo;
  close: () => void;
  add: (rule: CustomFilter) => void;
}) {
  const fields = useMemo(() => [
    ...filterCategories(info).map(id => ({ value: `category:${id}`, label: categoryName(id) })),
    ...info.tests.map((test, i) => ({ value: `test:${i}`, label: testLabelWithUnits(test) })),
  ], [info]);
  const [field, setField] = useState<string | null>(null);
  const test = field?.startsWith("test:") ? Number(field.slice(5)) : null;
  const category = field?.startsWith("category:") ? field.slice(9) : null;
  const [values, setValues] = useState<string[]>([]);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [exclude, setExclude] = useState(false);
  const [includeEnds, setIncludeEnds] = useState(true);
  const [range, setRange] = useState<{ test: number; data: TestDistribution | null; failed?: boolean } | null>(null);
  const loading = test !== null && range?.test !== test;
  const lower = Number(min), upper = Number(max);
  const validRange = min !== "" && max !== "" && Number.isFinite(lower) && Number.isFinite(upper) && lower <= upper;
  const canAdd = test !== null ? !loading && validRange : !!category && values.length > 0;
  useEffect(() => {
    if (test === null) return;
    let active = true;
    void testDistribution(test).then(data => {
      if (!active) return;
      setRange({ test, data });
      if (data) {
        setMin(measurementText(data.min));
        setMax(measurementText(data.max));
      }
    }, () => { if (active) setRange({ test, data: null, failed: true }); });
    return () => { active = false; };
  }, [test]);

  return <div className="modal-backdrop" onClick={close}>
    <form className="modal custom-filter-modal" role="dialog" aria-modal="true" aria-label="Add custom filter"
      onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented) close(); }}
      onSubmit={e => {
        e.preventDefault();
        if (!canAdd) return;
        if (test !== null) add({ kind: "numeric", test, min: lower, max: upper, keep: !exclude, includeEnds });
        else if (category) add({ kind: "category", category, values, keep: !exclude });
      }}>
      <div className="modal-head">
        <div className="modal-title">Add custom filter</div>
        <button type="button" className="btn icon ghost" onClick={close} aria-label="Close"><IconX size={15} /></button>
      </div>
      <div className="modal-body">
        <SearchCombobox label="Filter field" placeholder="Search tests or categories…" options={fields} value={field}
          onChange={value => {
            if (value === field) return;
            setField(value);
            setValues([]);
            setMin("");
            setMax("");
            setRange(null);
            setExclude(false);
            setIncludeEnds(true);
          }} />
        {test !== null && (
          <>
            <FilterRange distribution={loading ? null : range?.data ?? null} loading={loading} exclude={exclude} includeEnds={includeEnds}
              lower={min} upper={max} setLower={setMin} setUpper={setMax} />
            {!loading && !range?.data && <div className="modal-sub">{range?.failed ? "Range preview unavailable" : "No measured values"}</div>}
            {min && max && lower > upper && <div className="modal-sub">Minimum exceeds maximum.</div>}
          </>
        )}
        {category && (
          <div className="chip-wrap">
            {filterValues(info, category).map(option => {
              const selected = values.includes(option.value);
              return <button type="button" className={"chip" + (option.color ? " bin-chip" : "") + (selected ? " on" : "")} aria-pressed={selected}
                key={option.value} onClick={() => setValues(selected ? values.filter(v => v !== option.value) : [...values, option.value])}>
                {option.color && <span className="bin-dot" style={{ background: option.color }} />}
                {option.label}
              </button>;
            })}
          </div>
        )}
        {field && <div className="custom-filter-options">
          <label><input type="checkbox" checked={exclude} onChange={e => setExclude(e.target.checked)} /> Exclude</label>
          {test !== null && <label><input type="checkbox" checked={includeEnds} onChange={e => setIncludeEnds(e.target.checked)} /> Include endpoints</label>}
        </div>}
      </div>
      <div className="modal-foot">
        <button type="button" className="btn" onClick={close}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!canAdd}>Add filter</button>
      </div>
    </form>
  </div>;
}

export function CustomFiltersPanel() {
  const info = useStore(s => s.info);
  const rules = useStore(s => s.filters.custom);
  const patchFilters = useStore(s => s.patchFilters);
  const [open, setOpen] = useState(false);
  if (!info) return null;

  return <div className="filter-panel custom-panel">
    <div className="side-section-head">
      <span><IconSliders size={14} /> Custom filters</span>
      <button className="link-btn" onClick={() => setOpen(true)}>+ Add filter</button>
    </div>
    {rules?.length ? <div className="custom-column-list">
      {rules.map((rule, index) => {
        const { title, detail } = describeCustomFilter(rule, info);
        const selected = rule.kind === "category"
          ? filterValues(info, rule.category).filter(option => rule.values.includes(option.value)) : null;
        return <div className="custom-column-row" key={index}>
          <div className="custom-filter-summary" title={`${title} · ${detail}`}>
            <span className="custom-column-name">{title}</span>
            {selected?.length ? <div className="custom-filter-values">
              {!rule.keep && <span>Exclude</span>}
              {selected.slice(0, 3).map(option => <span className="custom-filter-value" key={option.value}>
                {option.color && <span className="bin-dot" style={{ background: option.color }} />}
                <span>{option.label}</span>
              </span>)}
              {selected.length > 3 && <span>+{selected.length - 3}</span>}
            </div> : <span className="custom-column-count">{detail}</span>}
          </div>
          <button className="mini danger" onClick={() => patchFilters({ custom: rules.filter((_, i) => i !== index) })}
            title="Delete filter" aria-label={`Delete filter for ${title}`}><IconTrash size={12} /></button>
        </div>;
      })}
    </div> : <div className="empty-list">No custom filters yet.</div>}
    {open && <AddFilterDialog info={info} close={() => setOpen(false)} add={rule => {
      patchFilters({ custom: [...(useStore.getState().filters.custom ?? []), rule] });
      setOpen(false);
    }} />}
  </div>;
}

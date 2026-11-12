import { useStore } from "../store";
import { defaultSpec, scatterLimitsFor, type LimitMode, type PlotLimits, type PlotType, type ScatterAxis } from "../types";
import { PALETTES, paletteGradient } from "../lib/theme";
import { fmt, fmtInt, statisticalRangeLabels, testLabelWithUnits } from "../lib/format";
import { Fragment, useState, type ReactNode } from "react";
import { TestCombobox } from "./TestCombobox";
import { testIqrLimits } from "../lib/api";

function specLimitStep(value: number | null): number {
  return value ? 10 ** (Math.floor(Math.log10(Math.abs(value))) - 1) : 0.1;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="insp-section">
      <div className="insp-title">{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-control">{children}</div>
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Num({
  value,
  onChange,
  placeholder,
  step = "any",
  disabled,
  min,
  stepFromValue,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: string;
  disabled?: boolean;
  min?: number;
  stepFromValue?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="input"
      type="number"
      step={step}
      min={min}
      disabled={disabled}
      value={draft ?? (value === null || !Number.isFinite(value) ? "" : value)}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        // Keep the native spinner's step base at the last entered value.
        if (stepFromValue) e.target.defaultValue = v;
        if (min === undefined) { onChange(v === "" ? null : Number(v)); return; }
        setDraft(v);
        if (v !== "" && Number(v) >= min) onChange(Number(v));
      }}
      onBlur={() => {
        if (draft !== null && draft !== "" && min !== undefined && Number(draft) < min) onChange(min);
        setDraft(null);
      }}
      onKeyDown={e => { if (min !== undefined && e.key === "Enter") e.currentTarget.blur(); }}
    />
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className="check-row" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

const RANGE_OPTIONS: { v: LimitMode; label: string }[] = [
  { v: "auto", label: "Auto" },
  { v: "manual", label: "Manual" },
  { v: "sigma", label: statisticalRangeLabels.sigma.range },
  { v: "iqr", label: statisticalRangeLabels.iqr.range },
  { v: "spec", label: "USL/LSL" },
];

export function Inspector({ autoBins }: { autoBins: number }) {
  const info = useStore((s) => s.info);
  const spec = useStore((s) => s.spec);
  const patch = useStore((s) => s.patchSpec);
  const show = useStore((s) => s.showInspector);
  const [pendingLimits, setPendingLimits] = useState<Set<string>>(() => new Set());

  if (!show) return null;
  if (!info) return null;
  const test = spec.test !== null ? info.tests[spec.test] : null;
  const isScatter = spec.type === "scatter";
  const scatterX = spec.scatterX !== null ? info.tests[spec.scatterX] : null;
  const scatterY = spec.scatterY !== null ? info.tests[spec.scatterY] : null;
  const showTest = spec.type !== "binmap" && spec.type !== "pareto";
  const showLimits =
    spec.type === "box" || spec.type === "hist" || spec.type === "trend" || spec.type === "map" || isScatter;
  const suggestLimit = async (side: "usl" | "lsl", key: string, index: number, settings: PlotLimits,
    change: (value: Partial<PlotLimits>) => void, axis?: ScatterAxis) => {
    setPendingLimits(current => new Set(current).add(key));
    try {
      const limits = await testIqrLimits(index);
      const current = useStore.getState();
      const currentTest = axis === "x" ? current.spec.scatterX : axis === "y" ? current.spec.scatterY
        : axis === "z" ? current.spec.scatterZTest : current.spec.test;
      const currentLimits = axis ? scatterLimitsFor(current.spec, axis) : current.spec;
      if (current.info !== info || current.spec.type !== spec.type || currentTest !== index ||
          currentLimits[side] !== settings[side]) return;
      if (!limits) {
        current.notify("No measured values to suggest a limit.");
        return;
      }
      const edge = limits[side === "usl" ? 1 : 0];
      const step = specLimitStep(edge);
      const rounded = side === "usl" ? Math.ceil(edge / step) : Math.floor(edge / step);
      change({ [side]: Number((rounded * step).toPrecision(15)), [side === "usl" ? "noUsl" : "noLsl"]: false });
    } catch (error) {
      useStore.getState().setError(String(error));
    } finally {
      setPendingLimits(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };
  const limitControls = (settings: PlotLimits, testIndex: number | null, axis?: ScatterAxis) => {
    const axisTest = testIndex === null ? null : info.tests[testIndex];
    const colour = spec.type === "map" || axis === "z";
    const name = axis ? axis.toUpperCase() : "";
    const rangeLabel = axis ? `${name} range` : colour ? "Range" : spec.type === "hist" ? "Value axis range" : "Y axis range";
    const change = (values: Partial<PlotLimits>) => {
      if (!axis) { patch(values); return; }
      const current = useStore.getState().spec;
      patch({ scatterLimits: { ...current.scatterLimits, [axis]: { ...scatterLimitsFor(current, axis), ...values } } });
    };
    const showLog = axis === "y" || (!axis && !colour);
    return <>
      <Check label={colour ? "Show spec ticks (USL/LSL)" : "Show spec limits (USL/LSL)"}
        checked={settings.showLimits} onChange={showLimits => change({ showLimits })} />
      {(settings.showLimits || settings.limitMode === "spec") && <>
        {(["usl", "lsl"] as const).map(side => {
          const none = side === "usl" ? "noUsl" : "noLsl";
          const imported = side === "usl" ? axisTest?.hiSpec : axisTest?.loSpec;
          const limit = settings[side] ?? imported ?? null;
          const pendingKey = `${spec.type}:${axis ?? ""}:${testIndex}:${side}`;
          const pending = pendingLimits.has(pendingKey);
          const label = side.toUpperCase();
          return <Row key={side} label={label}>
            <div className="spec-limit-control">
              <Num value={settings[none] ? null : limit} disabled={limit !== null && settings[none]}
                onChange={value => change({ [side]: value, [none]: false })}
                placeholder={pending ? "Loading…" : "None"} step={String(specLimitStep(limit))} stepFromValue />
              <input type="checkbox" aria-label={`Enable ${name ? `${name} ` : ""}${label}`} title={`Enable ${label}`}
                checked={limit !== null && !settings[none]} disabled={pending || testIndex === null}
                onChange={e => {
                  if (e.target.checked && limit === null && testIndex !== null)
                    void suggestLimit(side, pendingKey, testIndex, settings, change, axis);
                  else change({ [none]: !e.target.checked });
                }} />
            </div>
          </Row>;
        })}
        <button className="link-btn" onClick={() => change({ lsl: null, usl: null, noLsl: false, noUsl: false })}
          disabled={settings.lsl === null && settings.usl === null && !settings.noLsl && !settings.noUsl}>
          Use limits from the test
        </button>
      </>}
      <Row label={rangeLabel}>
        <select className="input" aria-label={rangeLabel} value=""
          onChange={e => { if (e.target.value) change({ limitMode: e.target.value as LimitMode }); }}>
          {RANGE_OPTIONS.map(option => <Fragment key={option.v}>
            <option value={option.v}>{option.label}</option>
            {option.v === settings.limitMode && <option value="" hidden disabled>{option.label}</option>}
          </Fragment>)}
        </select>
      </Row>
      {(settings.limitMode === "sigma" || settings.limitMode === "iqr") && (
        <Row label={statisticalRangeLabels[settings.limitMode].multiplier}>
          <Num value={settings.limitK} onChange={value => { if (value !== null) change({ limitK: value }); }} step="0.1" min={0.1} />
        </Row>
      )}
      {settings.limitMode === "manual" && <>
        <Row label="Max"><Num value={settings.yMax} onChange={yMax => change({ yMax })} placeholder="auto" /></Row>
        <Row label="Min"><Num value={settings.yMin} onChange={yMin => change({ yMin })} placeholder="auto" /></Row>
      </>}
      {showLog && <Check label={spec.type === "hist" ? "Logarithmic count axis" : "Logarithmic Y axis"}
        checked={spec.logY} onChange={logY => patch({ logY })} />}
      <button className="link-btn" onClick={() => change({ limitMode: "auto", yMin: null, yMax: null })}
        disabled={settings.limitMode === "auto" && settings.yMin === null && settings.yMax === null}>
        Reset limits
      </button>
    </>;
  };
  const categoryOptions = (noneLabel?: string) => (
    <>
      {noneLabel !== undefined && <option value="none">{noneLabel}</option>}
      <option value="lot">Lot</option>
      <option value="wafer">Wafer ID (OCR)</option>
      <option value="hbin">HBIN</option>
      <option value="sbin">SBIN</option>
      <option value="site">Site</option>
      {info.dataCategories?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      {info.customColumns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </>
  );

  const mapCategoryOptions = (
    <>
      <option value="none">None</option>
      <option value="wafer">Wafer ID (OCR)</option>
      <option value="lot">Lot</option>
      {info.dataCategories?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      {info.customColumns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </>
  );

  const paretoGroupOptions = (
    <>
      <option value="none">None</option>
      <option value="lot">Lot</option>
      <option value="wafer">Wafer ID (OCR)</option>
      <option value="site">Site</option>
      {info.dataCategories?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      {info.customColumns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </>
  );

  const reset = () => {
    const fresh = defaultSpec(spec.type as PlotType, spec.test, spec.title);
    patch({
      ...fresh,
      presentation: useStore.getState().presentation,
      id: spec.id,
      scatterX: spec.scatterX,
      scatterY: spec.scatterY,
      scatterLimits: undefined,
    });
  };

  return (
    <aside className="inspector">
      <div className="insp-head">Plot settings</div>

      {showTest && (
        <Section title={isScatter ? "Scatter tests" : "Test"}>
          <div className="test-card">
            <div className="test-card-name">
              {isScatter
                ? `${scatterX ? testLabelWithUnits(scatterX) : "X"} vs ${scatterY ? testLabelWithUnits(scatterY) : "Y"}`
                : test
                  ? testLabelWithUnits(test)
                  : "No test selected"}
            </div>
            <div className="test-card-meta">
              {isScatter ? (
                <>
                  <span>X: {scatterX?.units || "no units"}</span>
                  <span>·</span>
                  <span>Y: {scatterY?.units || "no units"}</span>
                </>
              ) : (
                <>
                  {test?.units ? <span>{test.units}</span> : <span>no units</span>}
                  <span>·</span>
                  <span>{test ? fmtInt(test.count) : "0"} values</span>
                </>
              )}
            </div>
            {!isScatter && test && (test.loSpec !== null || test.hiSpec !== null) && (
              <div className="test-card-limits">
                USL/LSL {test.hiSpec !== null ? fmt(test.hiSpec) : "—"} /{" "}
                {test.loSpec !== null ? fmt(test.loSpec) : "—"}
              </div>
            )}
          </div>
        </Section>
      )}

      {spec.type === "box" && (
        <Section title="Box plot">
          <Row label="X axis">
            <select
              className="input"
              value={spec.xAxis}
              onChange={(e) => patch({ xAxis: e.target.value })}
            >
              {categoryOptions()}
            </select>
          </Row>
          <Row label="Group by">
            <select
              className="input"
              value={spec.groupBy}
              onChange={(e) => patch({ groupBy: e.target.value })}
            >
              {categoryOptions("None")}
            </select>
          </Row>
          <Check
            label="Split into different plots"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
          />
          <Row label="Points">
            <Seg
              value={spec.showPoints}
              options={[
                { v: "outliers", label: "Outliers" },
                { v: "all", label: "All" },
                { v: "none", label: "None" },
              ]}
              onChange={(v) => patch({ showPoints: v })}
            />
          </Row>
          <Check
            label="Display all data"
            checked={spec.displayAllData}
            onChange={(v) => patch({ displayAllData: v })}
            title="In All points mode, draw every eligible dot in full-size plots and exports. Split thumbnails still sample regular dots."
          />
        </Section>
      )}

      {spec.type === "map" && (
        <Section title="Wafer map">
          <Row label="Group by">
            <select
              className="input"
              value={spec.groupBy}
              onChange={(e) =>
                patch({
                  groupBy: e.target.value,
                  // A grouping with several values is most useful as a mosaic.
                  splitPlots: e.target.value !== "none",
                })
              }
            >
              {mapCategoryOptions}
            </select>
          </Row>
          <Row label="Palette">
            <select
              className="input"
              value={spec.palette}
              onChange={(e) => patch({ palette: e.target.value })}
            >
              {PALETTES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          <div className="palette-preview" style={{ background: paletteGradient(spec.palette) }} />
        </Section>
      )}

      {spec.type === "binmap" && (
        <Section title="Bin map">
          <Row label="Bin type">
            <Seg
              value={spec.binCategory}
              options={[
                { v: "hard", label: "HBIN" },
                { v: "soft", label: "SBIN" },
              ]}
              onChange={(v) => patch({ binCategory: v })}
            />
          </Row>
        </Section>
      )}

      {spec.type === "pareto" && (
        <Section title="Pareto">
          <Row label="Bin type">
            <Seg
              value={spec.binCategory}
              options={[
                { v: "hard", label: "HBIN" },
                { v: "soft", label: "SBIN" },
              ]}
              onChange={(v) => patch({ binCategory: v })}
            />
          </Row>
          <Row label="Top bins">
            <Num value={spec.top} onChange={(v) => { if (v !== null) patch({ top: Math.round(v) }); }} step="1" min={1} />
          </Row>
          <Row label="X axis">
            <select
              className="input"
              value={spec.xAxis}
              onChange={(e) => patch({ xAxis: e.target.value })}
            >
              {categoryOptions("None (global)")}
            </select>
          </Row>
          <Row label="Group by">
            <select
              className="input"
              value={spec.groupBy}
              onChange={(e) => patch({ groupBy: e.target.value })}
            >
              {paretoGroupOptions}
            </select>
          </Row>
        </Section>
      )}

      {spec.type === "hist" && (
        <Section title="Histogram">
          <Row label="Group by">
            <select
              className="input"
              value={spec.groupBy}
              onChange={(e) => patch({ groupBy: e.target.value })}
            >
              {categoryOptions("None")}
            </select>
          </Row>
          <Check
            label="Split into different plots"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
          />
          <Row label="Bins">
            <select className="input" aria-label="Bins" value={spec.bins === null ? "auto" : "manual"}
              onChange={e => patch({ bins: e.target.value === "auto" ? null : autoBins })}>
              <option value="auto">Auto</option>
              <option value="manual" disabled={spec.bins === null && !autoBins}>Manual</option>
            </select>
          </Row>
          {spec.bins !== null && (
            <Row label="Bin count">
              <Num value={spec.bins} step="1" min={1}
                onChange={v => { if (v !== null) patch({ bins: Math.round(v) }); }} />
            </Row>
          )}
          <Check
            label="Normal curve overlay"
            checked={spec.showNormal}
            onChange={(v) => patch({ showNormal: v })}
            disabled={spec.groupBy !== "none" && !spec.splitPlots}
          />
        </Section>
      )}

      {spec.type === "trend" && (
        <Section title="Trend">
          <Row label="X axis">
            <select
              className="input"
              value={spec.xAxis}
              onChange={(e) => patch({ xAxis: e.target.value })}
            >
              {categoryOptions()}
            </select>
          </Row>
          <Row label="Group by">
            <select className="input" value={spec.groupBy}
              onChange={(e) => patch({ groupBy: e.target.value })}>
              {categoryOptions("None")}
            </select>
          </Row>
          <Check label="Split into different plots" checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })} />
          <Check label="±1 σ band" checked={spec.showBand} onChange={(v) => patch({ showBand: v })} />
        </Section>
      )}

      {isScatter && (
        <Section title="Scatter">
          <Row label="Y test">
            <TestCombobox tests={info.tests} value={spec.scatterY} onChange={(value) => patch({ scatterY: value })} />
          </Row>
          <Row label="Group by">
            <select
              className="input"
              value={spec.groupBy}
              onChange={(e) => patch({ groupBy: e.target.value })}
            >
              {categoryOptions("None")}
            </select>
          </Row>
          <Check
            label="Split into different plots"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
          />
          <Row label="Z colour">
            <Seg
              value={spec.scatterZMode}
              options={[
                { v: "none", label: "None" },
                { v: "continuous", label: "Value" },
              ]}
              onChange={(v) =>
                patch({
                  scatterZMode: v,
                  scatterZTest:
                    v === "continuous"
                      ? (spec.scatterZTest ?? spec.scatterY ?? spec.scatterX)
                      : spec.scatterZTest,
                })
              }
            />
          </Row>
          {spec.scatterZMode === "continuous" && (
            <Row label="Z test">
              <TestCombobox label="Z test" tests={info.tests} value={spec.scatterZTest} onChange={(value)=>patch({scatterZTest:value})} />
            </Row>
          )}
          <Check
            label="Fit line and R²"
            checked={spec.scatterFit}
            onChange={(v) => patch({ scatterFit: v })}
          />
          <Check
            label="Display all data"
            checked={spec.displayAllData}
            onChange={(v) => patch({ displayAllData: v })}
            title="Draw every eligible X/Y pair. Large datasets may take longer to render."
          />
        </Section>
      )}

      {showLimits && (
        <Section title={spec.type === "map" ? "Colour limits" : "Limits"}>
          {isScatter ? <>
            <div className="axis-limits"><h4>X axis</h4>{limitControls(scatterLimitsFor(spec, "x"), spec.scatterX, "x")}</div>
            <div className="axis-limits"><h4>Y axis</h4>{limitControls(scatterLimitsFor(spec, "y"), spec.scatterY, "y")}</div>
            {spec.scatterZMode === "continuous" && spec.scatterZTest !== null && (
              <div className="axis-limits"><h4>Z colour scale</h4>{limitControls(scatterLimitsFor(spec, "z"), spec.scatterZTest, "z")}</div>
            )}
          </> : limitControls(spec, spec.test)}
        </Section>
      )}

      <div className="insp-foot">
        <button className="btn" onClick={reset}>
          Reset plot settings
        </button>
      </div>
    </aside>
  );
}

import { useStore } from "../store";
import { defaultSpec, type LimitMode, type PlotType } from "../types";
import { PALETTES, paletteGradient } from "../lib/theme";
import { fmt, fmtInt, testLabelWithUnits } from "../lib/format";
import type { ReactNode } from "react";

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
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <input
      className="input"
      type="number"
      step={step}
      disabled={disabled}
      value={value === null || !Number.isFinite(value) ? "" : value}
      placeholder={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : Number(v));
      }}
    />
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check-row">
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
  { v: "sigma", label: "±kσ" },
  { v: "iqr", label: "±k IQR" },
  { v: "spec", label: "LSL/USL" },
];

export function Inspector() {
  const info = useStore((s) => s.info);
  const spec = useStore((s) => s.spec);
  const patch = useStore((s) => s.patchSpec);
  const show = useStore((s) => s.showInspector);

  if (!show) return null;
  if (!info) return null;
  const test = spec.test !== null ? info.tests[spec.test] : null;
  const isScatter = spec.type === "scatter";
  const scatterX = spec.scatterX !== null ? info.tests[spec.scatterX] : null;
  const scatterY = spec.scatterY !== null ? info.tests[spec.scatterY] : null;
  const showTest = spec.type !== "binmap" && spec.type !== "pareto";
  const showLimits =
    spec.type === "box" || spec.type === "hist" || spec.type === "trend" || spec.type === "map" || isScatter;
  const supportsSpec = spec.type === "box" || spec.type === "hist" || spec.type === "trend";
  const supportsSpecRange = supportsSpec || spec.type === "map";
  const supportsLog = spec.type === "box" || spec.type === "hist" || spec.type === "trend" || isScatter;
  const valueAxis = spec.type === "map" ? "Colour scale" : spec.type === "hist" ? "Value axis" : "Y axis";
  const testOptions = info.tests.map((t, i) => (
    <option key={i} value={i}>
      {testLabelWithUnits(t)}
    </option>
  ));

  const categoryOptions = (noneLabel?: string) => (
    <>
      {noneLabel !== undefined && <option value="none">{noneLabel}</option>}
      <option value="lot">Lot</option>
      <option value="wafer">Wafer ID (OCR)</option>
      <option value="hbin">HBIN</option>
      <option value="sbin">SBIN</option>
      <option value="site">Site</option>
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
                spec {test.loSpec !== null ? fmt(test.loSpec) : "—"} …{" "}
                {test.hiSpec !== null ? fmt(test.hiSpec) : "—"}
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
            label="Split into different plots"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
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
            <Num value={spec.top} onChange={(v) => patch({ top: v ?? 20 })} step="1" />
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
          <Row label="Bins">
            <Num value={spec.bins} onChange={(v) => patch({ bins: v })} placeholder="auto" step="1" />
          </Row>
          <Check
            label="Normal curve overlay"
            checked={spec.showNormal}
            onChange={(v) => patch({ showNormal: v })}
          />
          <Check
            label="Split into different plots"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
            disabled={spec.groupBy === "none"}
          />
        </Section>
      )}

      {spec.type === "trend" && (
        <Section title="Trend">
          <Row label="Group by">
            <select
              className="input"
              value={spec.xAxis}
              onChange={(e) => patch({ xAxis: e.target.value })}
            >
              {categoryOptions()}
            </select>
          </Row>
          <Check label="±1 σ band" checked={spec.showBand} onChange={(v) => patch({ showBand: v })} />
        </Section>
      )}

      {isScatter && (
        <Section title="Scatter">
          <Row label="X test">
            <select
              className="input"
              value={spec.scatterX ?? ""}
              onChange={(e) => patch({ scatterX: e.target.value === "" ? null : Number(e.target.value) })}
            >
              {spec.scatterX === null && <option value="">Select…</option>}
              {testOptions}
            </select>
          </Row>
          <Row label="Y test">
            <select
              className="input"
              value={spec.scatterY ?? ""}
              onChange={(e) => patch({ scatterY: e.target.value === "" ? null : Number(e.target.value) })}
            >
              {spec.scatterY === null && <option value="">Select…</option>}
              {testOptions}
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
              <select
                className="input"
                value={spec.scatterZTest ?? ""}
                onChange={(e) =>
                  patch({ scatterZTest: e.target.value === "" ? null : Number(e.target.value) })
                }
              >
                {spec.scatterZTest === null && <option value="">Select…</option>}
                {testOptions}
              </select>
            </Row>
          )}
          <Check
            label="Fit line and R²"
            checked={spec.scatterFit}
            onChange={(v) => patch({ scatterFit: v })}
          />
          <Check
            label="Split into different plots"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
            disabled={spec.groupBy === "none"}
          />
        </Section>
      )}

      {showLimits && (
        <Section title={spec.type === "map" ? "Colour limits" : "Limits"}>
          {supportsSpec && (
            <Check
              label="Show spec limits (LSL/USL)"
              checked={spec.showLimits}
              onChange={(v) => patch({ showLimits: v })}
            />
          )}
          {((supportsSpec && spec.showLimits) ||
            (spec.type === "map" && spec.limitMode === "spec")) && (
            <>
              <Row label="LSL">
                <Num
                  value={spec.lsl}
                  onChange={(v) => patch({ lsl: v })}
                  placeholder={test?.loSpec != null ? fmt(test.loSpec) : "none"}
                />
              </Row>
              <Row label="USL">
                <Num
                  value={spec.usl}
                  onChange={(v) => patch({ usl: v })}
                  placeholder={test?.hiSpec != null ? fmt(test.hiSpec) : "none"}
                />
              </Row>
              <button
                className="link-btn"
                onClick={() => patch({ lsl: null, usl: null })}
                disabled={spec.lsl === null && spec.usl === null}
              >
                Use limits from the test
              </button>
            </>
          )}
          <Row label={spec.type === "map" ? "Range" : `${valueAxis} range`}>
            <select
              className="input"
              value={spec.limitMode}
              onChange={(e) => patch({ limitMode: e.target.value as LimitMode })}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.v} value={o.v} disabled={o.v === "spec" && !supportsSpecRange}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
          {(spec.limitMode === "sigma" || spec.limitMode === "iqr") && (
            <Row label={spec.limitMode === "sigma" ? "k (σ)" : "k (IQR)"}>
              <Num
                value={spec.limitK}
                onChange={(v) => patch({ limitK: v ?? 3 })}
                step="0.1"
              />
            </Row>
          )}
          {spec.limitMode === "manual" && (
            <>
              <Row label="Min">
                <Num
                  value={spec.yMin}
                  onChange={(v) => patch({ yMin: v })}
                  placeholder="auto"
                />
              </Row>
              <Row label="Max">
                <Num
                  value={spec.yMax}
                  onChange={(v) => patch({ yMax: v })}
                  placeholder="auto"
                />
              </Row>
            </>
          )}
          {supportsLog && (
            <Check
              label={spec.type === "hist" ? "Logarithmic count axis" : "Logarithmic Y axis"}
              checked={spec.logY}
              onChange={(v) => patch({ logY: v })}
            />
          )}
          <button
            className="link-btn"
            onClick={() =>
              patch({
                limitMode: "auto",
                yMin: null,
                yMax: null,
              })
            }
            disabled={spec.limitMode === "auto" && spec.yMin === null && spec.yMax === null}
          >
            Reset limits
          </button>
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

import { useStore } from "../store";
import { defaultSpec, type PlotType } from "../types";
import { PALETTES, paletteGradient } from "../lib/theme";
import { fmt, fmtInt, testLabelWithUnits } from "../lib/format";
import type { ReactNode } from "react";

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div className="insp-section">
      <div className="insp-title">{title}</div>
      {children}
      {hint && <div className="hint">{hint}</div>}
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
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  step?: string;
}) {
  return (
    <input
      className="input"
      type="number"
      step={step}
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
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

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
  const isCartesian = spec.type === "box" || spec.type === "hist" || spec.type === "trend";
  const testOptions = info.tests.map((t, i) => (
    <option key={i} value={i}>
      {testLabelWithUnits(t)}
    </option>
  ));
  const categoryOptions = (
    <>
      <option value="lot">Lot</option>
      <option value="wafer">Wafer ID (OCR)</option>
      <option value="hbin">Hard bin</option>
      <option value="sbin">Soft bin</option>
      {info.customColumns.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </>
  );

  return (
    <aside className="inspector">
      <div className="insp-head">Plot settings</div>

      <Section title={isScatter ? "Scatter tests" : "Test"}>
        <div className="test-card">
          <div className="test-card-name">
            {isScatter
              ? `${scatterX ? testLabelWithUnits(scatterX) : "X"} vs ${scatterY ? testLabelWithUnits(scatterY) : "Y"}`
              : test ? testLabelWithUnits(test) : "No test selected"}
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
              spec {test.loSpec !== null ? fmt(test.loSpec) : "—"} … {test.hiSpec !== null ? fmt(test.hiSpec) : "—"}
            </div>
          )}
        </div>
      </Section>

      {spec.type === "box" && (
        <Section title="Box plot">
          <Row label="Group by">
            <Seg
              value={spec.groupBy}
              options={[
                { v: "wafer", label: "Wafer" },
                { v: "lot", label: "Lot" },
              ]}
              onChange={(v) => patch({ groupBy: v })}
            />
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
          <Row label="Colour / block">
            <select
              className="input"
              value={spec.blockCol}
              onChange={(e) => patch({ blockCol: e.target.value })}
            >
              <option value="">Lot</option>
              <option value="__wafer">Wafer ID</option>
              {info.customColumns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <Check label="Logarithmic Y axis" checked={spec.logY} onChange={(v) => patch({ logY: v })} />
          <Check
            label="Split into one plot per block"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
          />
          <div className="hint">
            Colour by a custom Split column to compare labels across wafers. Lot-level boxes show
            “Mixed” when wafers in the lot have different labels. Split plots are exported as a
            cluster in reports.
          </div>
        </Section>
      )}

      {spec.type === "map" && (
        <Section title="Wafer map">
          <Row label="Wafer">
            <select
              className="input"
              value={spec.mapWafer ?? 0}
              onChange={(e) => patch({ mapWafer: Number(e.target.value) })}
            >
              {info.lots.map((lot, li) => (
                <optgroup key={li} label={lot}>
                  {info.wafers.map((w, wi) =>
                    w.lot === li ? (
                      <option key={wi} value={wi}>
                        {lot} / {w.name}
                      </option>
                    ) : null
                  )}
                </optgroup>
              ))}
            </select>
          </Row>
          <Check
            label="Split into one map per wafer"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
          />
          <div className="hint">
            Split maps show every wafer matching the filters and export as a report cluster. The
            Wafer selector is used when the split is off.
          </div>
          <Row label="Colour">
            <Seg
              value={spec.mapMode}
              options={[
                { v: "value", label: "Value" },
                { v: "bin", label: "Bin" },
              ]}
              onChange={(v) => patch({ mapMode: v })}
            />
          </Row>
          {spec.mapMode === "value" && (
            <>
              <div className="field">
                <span className="field-label">Palette</span>
              </div>
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
              <div className="palette-preview" style={{ background: paletteGradient(spec.palette) }} />
            </>
          )}
          <div className="hint">Hover a die for its value, bin and coordinates. Scroll to zoom.</div>
        </Section>
      )}

      {spec.type === "binmap" && (
        <Section title="Bin map">
          <div className="hint">
            All wafers matching the current filters are shown side by side and grouped by lot.
            Click any map to enlarge it.
          </div>
          <Check
            label="One report image per lot"
            checked={spec.splitPlots}
            onChange={(v) => patch({ splitPlots: v })}
          />
        </Section>
      )}

      {spec.type === "pareto" && (
        <Section title="Pareto">
          <Row label="Bin type">
            <Seg
              value={spec.binCategory}
              options={[
                { v: "hard", label: "Hard" },
                { v: "soft", label: "Soft" },
              ]}
              onChange={(v) => patch({ binCategory: v })}
            />
          </Row>
          <Row label="Top bins">
            <Num value={spec.top} onChange={(v) => patch({ top: v ?? 20 })} step="1" />
          </Row>
          <Row label="Grouped by">
            <select
              className="input"
              value={spec.paretoGroup}
              onChange={(e) => patch({ paretoGroup: e.target.value })}
            >
              <option value="none">None (global)</option>
              <option value="lot">Lot</option>
              <option value="wafer">Wafer ID</option>
              {info.customColumns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Row>
          <div className="hint">
            Global mode includes the pass bin and shows percentages of all tested dice. Grouped
            mode stacks non-pass bins and puts good-bin yield on a secondary axis.
          </div>
        </Section>
      )}

      {spec.type === "hist" && (
        <Section title="Histogram">
          <Row label="Bins">
            <Num value={spec.bins} onChange={(v) => patch({ bins: v })} placeholder="auto" step="1" />
          </Row>
          <Check label="Normal curve overlay" checked={spec.showNormal} onChange={(v) => patch({ showNormal: v })} />
        </Section>
      )}

      {spec.type === "trend" && (
        <Section title="Trend">
          <Row label="Group by">
            <Seg
              value={spec.groupBy}
              options={[
                { v: "wafer", label: "Wafer" },
                { v: "lot", label: "Lot" },
              ]}
              onChange={(v) => patch({ groupBy: v })}
            />
          </Row>
          <Check label="±1 σ band" checked={spec.showBand} onChange={(v) => patch({ showBand: v })} />
          <Check label="Logarithmic Y axis" checked={spec.logY} onChange={(v) => patch({ logY: v })} />
        </Section>
      )}

      {isScatter && (
        <Section title="Scatter" hint="Z colour can be continuous or categorical. Category “Wafer ID (OCR)” comes from the STDF wafer id.">
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
          <Row label="Z colour">
            <Seg
              value={spec.scatterZMode}
              options={[
                { v: "none", label: "None" },
                { v: "continuous", label: "Value" },
                { v: "category", label: "Category" },
              ]}
              onChange={(v) =>
                patch({
                  scatterZMode: v,
                  scatterZTest:
                    v === "continuous"
                      ? spec.scatterZTest ?? spec.scatterY ?? spec.scatterX
                      : spec.scatterZTest,
                  scatterZCol: v === "category" && !spec.scatterZCol ? "lot" : spec.scatterZCol,
                })
              }
            />
          </Row>
          {spec.scatterZMode === "continuous" && (
            <Row label="Z test">
              <select
                className="input"
                value={spec.scatterZTest ?? ""}
                onChange={(e) => patch({ scatterZTest: e.target.value === "" ? null : Number(e.target.value) })}
              >
                {spec.scatterZTest === null && <option value="">Select…</option>}
                {testOptions}
              </select>
            </Row>
          )}
          {spec.scatterZMode === "category" && (
            <Row label="Z category">
              <select
                className="input"
                value={spec.scatterZCol || "lot"}
                onChange={(e) => patch({ scatterZCol: e.target.value })}
              >
                {categoryOptions}
              </select>
            </Row>
          )}
          <Check label="Fit line and R²" checked={spec.scatterFit} onChange={(v) => patch({ scatterFit: v })} />
          {spec.scatterZMode === "category" && (
            <Check
              label="Split into one plot per category"
              checked={spec.splitPlots}
              onChange={(v) => patch({ splitPlots: v })}
            />
          )}
        </Section>
      )}

      {isCartesian && (
        <Section title="Limits">
          <Check
            label="Show spec limits (LSL/USL)"
            checked={spec.showLimits}
            onChange={(v) => patch({ showLimits: v })}
          />
          <Check
            label="Show control limits (LCL/UCL)"
            checked={spec.showControlLimits}
            onChange={(v) => patch({ showControlLimits: v })}
          />
          {spec.showLimits && (
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
          {spec.showControlLimits && test && (test.loLimit !== null || test.hiLimit !== null) && (
            <div className="hint">
              Control limits: {test.loLimit !== null ? fmt(test.loLimit) : "—"} …{" "}
              {test.hiLimit !== null ? fmt(test.hiLimit) : "—"}
            </div>
          )}
          {test?.limitConflict && (
            <div className="hint warn">
              Imported files disagree on this test's limits. The first non-empty LSL/USL is
              shown; set LSL/USL above to apply a common limit to the current view.
            </div>
          )}
        </Section>
      )}

      {isCartesian && (
        <Section title="Y axis">
          <Row label="Min">
            <Num value={spec.yMin} onChange={(v) => patch({ yMin: v })} placeholder="auto" />
          </Row>
          <Row label="Max">
            <Num value={spec.yMax} onChange={(v) => patch({ yMax: v })} placeholder="auto" />
          </Row>
          <button
            className="link-btn"
            onClick={() => patch({ yMin: null, yMax: null })}
            disabled={spec.yMin === null && spec.yMax === null}
          >
            Reset axis range
          </button>
        </Section>
      )}

      <Section title="Presentation">
        <Check
          label="Slide-sized fonts and markers"
          checked={spec.presentation}
          onChange={(v) => patch({ presentation: v })}
        />
        <div className="hint">
          Optimised for roughly six plots per slide. Turn it off for dense on-screen exploration.
        </div>
      </Section>

      <div className="insp-foot">
        <button
          className="btn"
          onClick={() => {
            const fresh = defaultSpec(spec.type as PlotType, spec.test, spec.title);
            patch({
              ...fresh,
              id: spec.id,
              scatterX: spec.scatterX,
              scatterY: spec.scatterY,
            });
          }}
        >
          Reset plot settings
        </button>
      </div>
    </aside>
  );
}

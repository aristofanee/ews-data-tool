import { useStore } from "../store";
import { defaultSpec, type PlotType } from "../types";
import { PALETTES, paletteGradient } from "../lib/theme";
import { fmt, fmtInt } from "../lib/format";
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
  const isCartesian = spec.type === "box" || spec.type === "hist" || spec.type === "trend";

  return (
    <aside className="inspector">
      <div className="insp-head">Plot settings</div>

      <Section title="Test">
        <div className="test-card">
          <div className="test-card-name">{test?.name ?? "No test selected"}</div>
          <div className="test-card-meta">
            {test?.units ? <span>{test.units}</span> : <span>no units</span>}
            <span>·</span>
            <span>{test ? fmtInt(test.count) : "0"} values</span>
          </div>
          {test && (test.loSpec !== null || test.hiSpec !== null) && (
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
          <Check label="Logarithmic Y axis" checked={spec.logY} onChange={(v) => patch({ logY: v })} />
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
          <Check label="Include pass bin" checked={spec.includePass} onChange={(v) => patch({ includePass: v })} />
          <Check label="Cumulative line" checked={spec.cumulative} onChange={(v) => patch({ cumulative: v })} />
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

      {isCartesian && (
        <Section title="Limits">
          <Check
            label="Show spec limits"
            checked={spec.showLimits}
            onChange={(v) => patch({ showLimits: v })}
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
              {test && (test.loLimit !== null || test.hiLimit !== null) && (
                <div className="hint">
                  Control limits: {test.loLimit !== null ? fmt(test.loLimit) : "—"} …{" "}
                  {test.hiLimit !== null ? fmt(test.hiLimit) : "—"}
                </div>
              )}
            </>
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

      <div className="insp-foot">
        <button
          className="btn"
          onClick={() => {
            const fresh = defaultSpec(spec.type as PlotType, spec.test, spec.title);
            patch({ ...fresh, id: spec.id });
          }}
        >
          Reset plot settings
        </button>
      </div>
    </aside>
  );
}

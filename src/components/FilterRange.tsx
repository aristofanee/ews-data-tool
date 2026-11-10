import type { TestDistribution } from "../types";

const STEPS = 1000;

/** Short decimal that still round-trips to the stored measurement. */
export function measurementText(value: number): string {
  const stored = Math.fround(value);
  for (let precision = 1; precision <= 9; precision++) {
    const rounded = Number(stored.toPrecision(precision));
    if (Math.fround(rounded) === stored) return String(rounded);
  }
  return String(stored);
}

export function FilterRange({ distribution, loading, exclude, includeEnds, lower, upper, setLower, setUpper }: {
  distribution: TestDistribution | null;
  loading: boolean;
  exclude: boolean;
  includeEnds: boolean;
  lower: string;
  upper: string;
  setLower: (value: string) => void;
  setUpper: (value: string) => void;
}) {
  const span = distribution ? distribution.max - distribution.min : 0;
  const position = (text: string, fallback: number) => {
    if (!distribution || span === 0 || text === "" || !Number.isFinite(Number(text))) return fallback;
    return Math.max(0, Math.min(STEPS, Math.round((Number(text) - distribution.min) / span * STEPS)));
  };
  const lo = position(lower, 0);
  const hi = position(upper, STEPS);
  const from = Math.min(lo, hi) / 10;
  const to = Math.max(lo, hi) / 10;
  const shade = "var(--blue-soft)";
  const base = "var(--panel-2)";
  const band = (active: string, inactive: string) => {
    const [inside, outside] = exclude ? [inactive, active] : [active, inactive];
    return `linear-gradient(to right, ${outside} ${from}%, ${inside} ${from}% ${to}%, ${outside} ${to}%)`;
  };
  const update = (raw: number, endpoint: "lower" | "upper") => {
    if (!distribution) return;
    const step = endpoint === "lower" ? Math.min(raw, hi) : Math.max(raw, lo);
    const value = measurementText(distribution.min + span * step / STEPS);
    (endpoint === "lower" ? setLower : setUpper)(value);
  };
  const peak = Math.max(1, ...(distribution?.counts ?? []));

  return <>
    {distribution && <div className="filter-distribution">
      <svg viewBox={`0 0 ${distribution.counts.length} 40`} preserveAspectRatio="none"
        className="filter-distribution-bars" style={{ background: band(shade, base) }} role="img" aria-label="Test value distribution">
        {distribution.counts.map((count, i) => {
          const height = count ? Math.max(1, count / peak * 36) : 0;
          const position = (i + 0.5) / distribution.counts.length * 100;
          const retained = (position >= from && position <= to) !== exclude;
          return <rect key={i} x={i + 0.08} y={40 - height} width={0.84} height={height} opacity={retained ? 1 : 0.28} />;
        })}
      </svg>
      {span > 0 && <div className={`filter-range-slider${lo === hi ? " coincident" : ""}${includeEnds ? "" : " open-ends"}`}>
        <div className="filter-range-track" style={{ background: band("var(--blue)", "var(--border)") }} />
        <input type="range" min={0} max={STEPS} value={lo} aria-label="Minimum slider" aria-valuetext={lower}
          onChange={e => update(Number(e.target.value), "lower")} />
        <input type="range" min={0} max={STEPS} value={hi} aria-label="Maximum slider" aria-valuetext={upper}
          onChange={e => update(Number(e.target.value), "upper")} />
      </div>}
      <div className="filter-distribution-axis">
        <span>{measurementText(distribution.min)}</span>
        {span > 0 && <span>{measurementText(distribution.max)}</span>}
      </div>
    </div>}
    {loading && <div className="modal-sub" role="status">Loading range…</div>}
    <div className="custom-filter-bounds">
      <label className="modal-field"><span>Minimum</span><input className="input" type="number" step="any" value={lower}
        disabled={loading} onChange={e => setLower(e.target.value)} /></label>
      <label className="modal-field"><span>Maximum</span><input className="input" type="number" step="any" value={upper}
        disabled={loading} onChange={e => setUpper(e.target.value)} /></label>
    </div>
  </>;
}

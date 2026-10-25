export function fmt(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e6 || a < 1e-4) {
    return v.toExponential(Math.min(3, digits)).replace("e+", "e");
  }
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(Math.min(3, digits));
  return v.toFixed(Math.min(5, digits + 1));
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return Math.round(v).toLocaleString("en-US");
}

export function pct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`;
}

/** STDF test names are fixed-width and often contain long runs of padding. */
export function tidyName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function withUnits(name: string, units: string): string {
  const n = tidyName(name);
  return units ? `${n} [${units}]` : n;
}

export function axisTitle(name: string, units: string, unitSize = 10): string {
  const n = tidyName(name);
  return units ? `${n}<br><span style="font-size:${Math.round(unitSize)}px">${units}</span>` : n;
}

export function safeName(s: string): string {
  return (
    s
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s*·\s*/g, "_")
      .replace(/[^\x20-\x7E]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "plot"
  );
}

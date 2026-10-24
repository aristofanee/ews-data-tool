export type Theme = "light" | "dark";

export const colors = {
  blue: "#2563eb",
  blueSoft: "#3b82f6",
  bluePale: "#93c5fd",
  yellow: "#f5b301",
  yellowSoft: "#fbbf24",
  red: "#e11d48",
  green: "#10b981",
  purple: "#8b5cf6",
  orange: "#f97316",
  teal: "#06b6d4",
  slate: "#64748b",
};

export interface Palette {
  id: string;
  label: string;
  stops: [number, string][];
}

export const PALETTES: Palette[] = [
  {
    id: "brand",
    label: "Blue → Yellow",
    stops: [
      [0, "#0b2a6b"],
      [0.2, "#1d4ed8"],
      [0.4, "#3b82f6"],
      [0.55, "#93c5fd"],
      [0.7, "#fde68a"],
      [0.85, "#f5b301"],
      [1, "#b45309"],
    ],
  },
  {
    id: "viridis",
    label: "Viridis",
    stops: [
      [0, "#440154"],
      [0.125, "#482878"],
      [0.25, "#3e4989"],
      [0.375, "#31688e"],
      [0.5, "#26828e"],
      [0.625, "#1f9e89"],
      [0.75, "#35b779"],
      [0.875, "#6ece58"],
      [1, "#fde725"],
    ],
  },
  {
    id: "inferno",
    label: "Inferno",
    stops: [
      [0, "#000004"],
      [0.125, "#1b0c41"],
      [0.25, "#4a0c6b"],
      [0.375, "#781c6d"],
      [0.5, "#a52c60"],
      [0.625, "#cf4446"],
      [0.75, "#ed6925"],
      [0.875, "#fb9b06"],
      [1, "#f7d13d"],
    ],
  },
  {
    id: "plasma",
    label: "Plasma",
    stops: [
      [0, "#0d0887"],
      [0.125, "#41049d"],
      [0.25, "#6a00a8"],
      [0.375, "#8f0da4"],
      [0.5, "#b12a90"],
      [0.625, "#cc4778"],
      [0.75, "#e16462"],
      [0.875, "#f2844b"],
      [1, "#fca636"],
    ],
  },
  {
    id: "turbo",
    label: "Turbo",
    stops: [
      [0, "#30123b"],
      [0.1, "#4145ab"],
      [0.2, "#4675ed"],
      [0.3, "#39a2fc"],
      [0.4, "#1bcfd4"],
      [0.5, "#24eca6"],
      [0.6, "#61fc6c"],
      [0.7, "#a4fc3b"],
      [0.8, "#d1e834"],
      [0.9, "#f3c63a"],
      [1, "#fe9b2d"],
    ],
  },
  {
    id: "mono",
    label: "Monochrome",
    stops: [
      [0, "#f1f5f9"],
      [0.5, "#94a3b8"],
      [1, "#0f172a"],
    ],
  },
];

export const BIN_COLORS = [
  "#2563eb",
  "#f5b301",
  "#ef4444",
  "#10b981",
  "#8b5cf6",
  "#f97316",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#64748b",
  "#0ea5e9",
  "#a855f7",
];

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function paletteRgb(id: string, t: number): [number, number, number] {
  const p = PALETTES.find((x) => x.id === id) ?? PALETTES[0];
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  let i = 0;
  while (i < p.stops.length - 2 && u > p.stops[i + 1][0]) i++;
  const [t0, c0] = p.stops[i];
  const [t1, c1] = p.stops[i + 1];
  const f = t1 === t0 ? 0 : (u - t0) / (t1 - t0);
  const a = hexToRgb(c0);
  const b = hexToRgb(c1);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function paletteGradient(id: string): string {
  const p = PALETTES.find((x) => x.id === id) ?? PALETTES[0];
  return `linear-gradient(90deg, ${p.stops.map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`).join(", ")})`;
}

export function paletteColor(id: string, t: number): string {
  const [r, g, b] = paletteRgb(id, t);
  return rgbToHex(r, g, b);
}

export function binColor(code: number, pass: boolean): string {
  if (pass) return BIN_COLORS[0];
  const idx = 1 + (Math.abs(code * 7 + 3) % (BIN_COLORS.length - 1));
  return BIN_COLORS[idx];
}

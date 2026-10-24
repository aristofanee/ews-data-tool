// Generate synthetic EWS data for testing the CSV importer.
//
//   node tools/make-sample-data.mjs          # 2 lots x 10 wafers (~30k rows)
//   node tools/make-sample-data.mjs --full   # 2 lots x 25 wafers (~232k rows)
//
// Writes sample-wide.csv (one column per test, units in the header) and
// sample-long.csv (one row per measurement) into ./sample-data.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const full = process.argv.includes("--full");
const outDir = "sample-data";
mkdirSync(outDir, { recursive: true });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20261024);
const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const tests = [
  { name: "Vt_nch", unit: "V", base: 0.416, sd: 0.011, edge: 0.006, drift: 0.0007, radial: 0.0022, az: 0.0012, digits: 5 },
  { name: "Idsat", unit: "uA/um", base: 520, sd: 16, edge: -18, drift: -1.2, radial: 9, az: 5, digits: 2 },
  { name: "Rds_on", unit: "ohm", base: 12.4, sd: 0.34, edge: 0.55, drift: 0.03, radial: 0.2, az: 0.12, digits: 3 },
];

const lots = ["L24-0417", "L24-0421"];
const waferCount = full ? 25 : 10;
const R = full ? 38.5 : 22;
const lim = Math.ceil(R);

const header = [
  "Lot",
  "Wafer",
  "X",
  "Y",
  "HBIN",
  "SBIN",
  ...tests.map((t) => `${t.name} [${t.unit}]`),
].join(",");

const wide = [header];
const long = ["Lot,Wafer,X,Y,HBIN,SBIN,Test,Value"];

for (let li = 0; li < lots.length; li++) {
  for (let wi = 0; wi < waferCount; wi++) {
    const wafer = String(wi + 1).padStart(2, "0");
    const lot = lots[li];
    const lotOffset = li * 0.003;
    for (let y = -lim; y <= lim; y++) {
      for (let x = -lim; x <= lim; x++) {
        const r = Math.hypot(x, y);
        if (r > R) continue;
        const edge = r > R - 2.5;
        const angle = Math.atan2(y, x);
        const p = rng();
        let hbin = 1;
        if (edge && p < 0.045) hbin = 20;
        else if (p < 0.006) hbin = 2;
        else if (p < 0.009) hbin = 5;
        else if (p < 0.011) hbin = 8;
        const sbin = hbin;
        const values = tests.map((t) => {
          const v =
            t.base +
            lotOffset +
            wi * t.drift +
            Math.cos((r / R) * Math.PI * 1.5) * t.radial +
            Math.sin(angle * 3 + wi) * t.az +
            (edge ? t.edge : 0) +
            gauss() * t.sd;
          return v.toFixed(t.digits);
        });
        wide.push([lot, wafer, x, y, hbin, sbin, ...values].join(","));

        // A small long-format subset: first lot, first two wafers, every 3rd die.
        if (li === 0 && wi < 2 && (Math.abs(x) + Math.abs(y)) % 3 === 0) {
          for (let ti = 0; ti < tests.length; ti++) {
            long.push([lot, wafer, x, y, hbin, sbin, tests[ti].name, values[ti]].join(","));
          }
        }
      }
    }
  }
}

const widePath = join(outDir, full ? "sample-wide-full.csv" : "sample-wide.csv");
writeFileSync(widePath, wide.join("\n") + "\n");
writeFileSync(join(outDir, "sample-long.csv"), long.join("\n") + "\n");

console.log(
  `${widePath}: ${(wide.length - 1).toLocaleString()} dice, ${tests.length} tests, ` +
    `${((wide.join("\n").length / 1024 / 1024).toFixed(1))} MB`
);
console.log(
  `${join(outDir, "sample-long.csv")}: ${(long.length - 1).toLocaleString()} measurements`
);

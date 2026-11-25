// Shared paths for historical diagnostic scripts being transferred to new PCs.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repoPath = (...parts) => resolve(repoRoot, ...parts);

export function desktopExecutable() {
  const exe = process.env.EWS_DESKTOP_EXE
    ? resolve(process.env.EWS_DESKTOP_EXE)
    : repoPath("src-tauri", "target", "release", "ews-data-tool.exe");
  if (!existsSync(exe)) throw new Error(`Missing desktop executable: ${exe}. Build with npm run tauri build or set EWS_DESKTOP_EXE.`);
  return exe;
}

export function referenceStdfFiles() {
  const directory = process.env.EWS_STDF_FIXTURE_DIR;
  if (!directory) throw new Error("Set EWS_STDF_FIXTURE_DIR to an approved reference fixture directory containing demofile.stdf.Z, lot2.stdf, and lot3.stdf. See tools/README.md.");
  return ["demofile.stdf.Z", "lot2.stdf", "lot3.stdf"].map((name) => {
    const file = resolve(directory, name);
    if (!existsSync(file)) throw new Error(`Missing reference fixture: ${file}`);
    return file;
  });
}

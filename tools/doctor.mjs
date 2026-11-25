// Read-only environment checks. Works before npm ci; no third-party imports.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
function report(level, message) {
  console.log(`[${level}] ${message}`);
  if (level === "FAIL") failures++;
}

console.log("EWS Data Tool environment check (no installation or configuration changes)");
const [major, minor] = process.versions.node.split(".").map(Number);
const supportedNode = (major === 20 && minor >= 19) ||
  (major === 22 && minor >= 12) || major > 22;
report(supportedNode ? "OK" : "FAIL",
  `Node ${process.versions.node}; Vite requires ^20.19.0 or >=22.12.0.`);

for (const command of ["rustc", "cargo"]) {
  const result = spawnSync(command, ["--version"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  report(result.status === 0 ? "OK" : "FAIL",
    result.status === 0 ? result.stdout.trim() : `${command} unavailable; install Rust and restart the terminal.`);
}

for (const file of ["package-lock.json", "src-tauri/Cargo.lock"]) {
  report(existsSync(join(root, file)) ? "OK" : "FAIL", `Dependency lockfile: ${file}`);
}
report(existsSync(join(root, "node_modules/vite/package.json")) ? "OK" : "WARN",
  "Frontend dependencies: run npm ci after cloning or when package-lock.json changes.");

if (process.platform === "win32") {
  const edgePaths = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA]
    .filter(Boolean).map((base) => join(base, "Microsoft/Edge/Application/msedge.exe"));
  const edge = edgePaths.find(existsSync);
  report(edge ? "OK" : "WARN", edge ? "Microsoft Edge found for browser checks."
    : "Edge not found in standard locations; browser checks require installed Microsoft Edge.");
  const rust = spawnSync("rustc", ["-vV"], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  const msvc = rust.status === 0 && /host: .*windows-msvc/.test(rust.stdout);
  report(msvc ? "OK" : "WARN", msvc ? "Rust host uses Windows MSVC."
    : "Windows desktop builds require a Windows MSVC Rust host toolchain.");
} else {
  report("WARN", "The documented desktop target is Windows; native build prerequisites differ on this OS.");
}
console.log("This checks tool discovery, not build readiness. It does not verify C++/SDK/WebView2 installation,");
console.log("registry access, corporate proxy/certificates, or successful compilation. See docs/HANDOVER.md.");
process.exitCode = failures ? 1 : 0;

import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { useOpenFiles } from "../lib/useData";
import type { CsvMapping } from "../types";

type Key = keyof CsvMapping;

const FIELDS: { key: Key; label: string; required: boolean }[] = [
  { key: "lot", label: "Lot", required: true },
  { key: "wafer", label: "Wafer / OCR", required: true },
  { key: "x", label: "X coordinate", required: true },
  { key: "y", label: "Y coordinate", required: true },
  { key: "hbin", label: "Hard bin", required: false },
  { key: "sbin", label: "Soft bin", required: false },
];

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function CsvMappingDialog() {
  const prompt = useStore((s) => s.csvPrompt);
  const setCsvPrompt = useStore((s) => s.setCsvPrompt);
  const open = useOpenFiles();
  const [mapping, setMapping] = useState<CsvMapping | null>(null);

  useEffect(() => {
    setMapping(prompt?.inspection.mapping ?? null);
  }, [prompt]);

  const canApply = useMemo(
    () =>
      !!mapping &&
      FIELDS.filter((f) => f.required).every((f) => mapping[f.key] !== null),
    [mapping]
  );

  if (!prompt || !mapping) return null;
  const { inspection, path } = prompt;

  const setField = (key: Key, value: string) => {
    setMapping((m) => (m ? { ...m, [key]: value === "" ? null : Number(value) } : m));
  };

  return (
    <div className="modal-backdrop" onClick={() => setCsvPrompt(null)}>
      <div className="modal column-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title">Map CSV columns</div>
            <div className="modal-sub">
              {baseName(path)} · header on line {inspection.headerLine} · delimiter “
              {inspection.delimiter === "\t" ? "tab" : inspection.delimiter}”
            </div>
          </div>
          <button className="btn icon" onClick={() => setCsvPrompt(null)} title="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="hint">
            Automatic detection could not find {inspection.missing.join(", ")}. Choose the
            matching column for each key. Metadata rows and test columns are detected separately.
          </div>
          {FIELDS.map((f) => (
            <label className="modal-field" key={f.key}>
              <span>
                {f.label}
                {f.required ? " *" : ""}
              </span>
              <select
                className="input"
                value={mapping[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
              >
                <option value="">Not mapped</option>
                {inspection.headers.map((h, i) => (
                  <option key={`${f.key}-${i}`} value={i}>
                    {i + 1}. {h || "(blank)"}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setCsvPrompt(null)}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!canApply}
            onClick={() => void open(prompt.paths, mapping)}
          >
            Import with these columns
          </button>
        </div>
      </div>
    </div>
  );
}

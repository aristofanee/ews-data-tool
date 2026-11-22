import { useStore } from "../store";
import { demoFontOffset, setDemoFontOffset } from "../lib/demoFonts";
import { useEffect, useRef, useState } from "react";

// Installed families checked on the development PC. Keep this demo list to
// readable UI/sans-serif faces rather than decorative, symbol or coding fonts.
const UI_FONTS = [
  "Alef", "Arial", "Bahnschrift", "Calibri", "Candara", "Carlito", "Corbel",
  "DejaVu Sans", "Ebrima", "Gadugi", "HarmonyOS Sans SC", "Leelawadee UI",
  "Liberation Sans", "Linux Biolinum G", "Lucida Sans Unicode", "Malgun Gothic",
  "Microsoft Sans Serif", "Microsoft YaHei UI", "Miriam Libre", "Nirmala UI",
  "Noto Sans", "Rubik", "Segoe UI", "Segoe UI Variable Small", "Tahoma",
  "Trebuchet MS", "Verdana", "Yu Gothic UI",
];

export function DemoFontControls() {
  const [uiFont, setUiFont] = useState("");
  const uiFontSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const select = uiFontSelect.current;
    if (!select) return;
    const fonts = ["", ...UI_FONTS];
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      const direction = Math.sign(event.deltaY);
      setUiFont(current => fonts[Math.max(0, Math.min(fonts.length - 1, fonts.indexOf(current) + direction))]);
    };
    select.addEventListener("wheel", wheel, { passive: false });
    return () => select.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const style = document.documentElement.style;
    if (uiFont) style.setProperty("--demo-ui-font", `"${uiFont}", sans-serif`);
    else style.removeProperty("--demo-ui-font");
    return () => { style.removeProperty("--demo-ui-font"); };
  }, [uiFont]);
  const [offset, setOffset] = useState(demoFontOffset);
  const density = useStore(s => s.demoXLabelDensity);
  const hasData = useStore(s => !!s.info);
  const apply = (value: number) => {
    setOffset(value);
    setDemoFontOffset(value);
    const store = useStore.getState();
    store.patchSpec({});
    // Maps also observe this revision to redraw their canvas text.
    useStore.setState({ demoFontRevision: value });
  };
  const simulateCsvWarning = () => {
    const { info } = useStore.getState();
    if (!info) return;
    const csvWarnings = Array.from({ length: 7 }, (_, file) => ({
      file: `demo_wafer_${file + 1}.csv`,
      lines: Array.from({ length: 30 + file * 25 }, (_, row) => 999_982 + file * 100_000 + row * (file + 3)),
    }));
    useStore.setState({ info: { ...info, csvWarnings } });
  };
  return <div className="demo-font-controls">
    <div className="demo-ui-font">
      <label htmlFor="demo-ui-font">UI font</label>
      <select ref={uiFontSelect} id="demo-ui-font" className="input" value={uiFont}
        title="Scroll to try the previous or next font" onChange={e => setUiFont(e.target.value)}>
        <option value="">Default (Segoe UI Variable Text)</option>
        {UI_FONTS.map(font => <option key={font} value={font} style={{ fontFamily: `"${font}", sans-serif` }}>{font}</option>)}
      </select>
    </div>
    <label htmlFor="demo-font-size">Demo graph text</label>
    <input id="demo-font-size" type="range" min="-2" max="10" step="1" value={offset}
      onChange={(e) => apply(Number(e.target.value))} />
    <output htmlFor="demo-font-size">{18 + offset}px ticks · {19 + offset}px axis titles ({offset >= 0 ? "+" : ""}{offset}px)</output>
    <button className="btn" onClick={() => apply(0)}>Reset</button>
    <div className="demo-label-density">
      <label htmlFor="demo-x-label-density">X-label density</label>
      <input id="demo-x-label-density" type="range" min="70" max="500" step="5" value={density}
        onChange={e => useStore.setState({ demoXLabelDensity: Number(e.target.value) })} />
      <output htmlFor="demo-x-label-density">{density}%</output>
    </div>
    <button className="btn" disabled={!hasData} onClick={simulateCsvWarning}>Simulate CSV warning</button>
  </div>;
}

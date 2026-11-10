import { useStore } from "../store";
import { demoFontOffset, setDemoFontOffset } from "../lib/demoFonts";
import { useState } from "react";

export function DemoFontControls() {
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

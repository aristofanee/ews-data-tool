import { useStore } from "../store";
import { demoFontOffset, setDemoFontOffset } from "../lib/demoFonts";
import { useState } from "react";

export function DemoFontControls() {
  const [offset, setOffset] = useState(demoFontOffset);
  const apply = (value: number) => {
    setOffset(value);
    setDemoFontOffset(value);
    const store = useStore.getState();
    store.patchSpec({});
    // Maps also observe this revision to redraw their canvas text.
    useStore.setState({ demoFontRevision: value });
  };
  return <div className="demo-font-controls">
    <label htmlFor="demo-font-size">Demo graph text</label>
    <input id="demo-font-size" type="range" min="-2" max="10" step="1" value={offset}
      onChange={(e) => apply(Number(e.target.value))} />
    <output htmlFor="demo-font-size">{18 + offset}px ticks · {19 + offset}px axis titles ({offset >= 0 ? "+" : ""}{offset}px)</output>
    <button className="btn" onClick={() => apply(0)}>Reset</button>
  </div>;
}

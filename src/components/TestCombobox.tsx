import { useLayoutEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TestInfo } from "../types";
import { testLabelWithUnits } from "../lib/format";
import { matchesSearch } from "../lib/search";

/** One editable selection field, with the same fuzzy search as the test list. */
export function TestCombobox({ tests, value, onChange, label:fieldLabel="Y test" }: {
  tests: TestInfo[]; value: number | null; onChange: (value: number) => void; label?:string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false), [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, maxHeight: 240, transform: "none" });
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = root.current?.getBoundingClientRect(); if (!r) return;
      // Native selects sized their popup to the option text. Match that
      // compact content width rather than the former fixed wide panel.
      const context = document.createElement("canvas").getContext("2d");
      if (context) context.font = getComputedStyle(root.current!.querySelector("input")!).font;
      const textWidth = tests.reduce((width, t) => Math.max(width, context?.measureText(testLabelWithUnits(t)).width ?? 0), 0);
      const width = Math.min(Math.max(r.width, Math.ceil(textWidth) + 32), window.innerWidth - 24);
      const below = window.innerHeight - r.bottom - 16;
      const height = Math.min(260, Math.max(100, below >= 140 ? below : r.top - 16));
      setPosition({ left: Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12)),
        top: below >= 140 ? r.bottom + 4 : r.top - 4, width, maxHeight: height,
        transform: below >= 140 ? "none" : "translateY(-100%)" });
    };
    measure(); window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, tests]);
  const label = value !== null && tests[value] ? testLabelWithUnits(tests[value]) : "";
  const rows = tests.map((t, i) => ({ label: testLabelWithUnits(t), i })).filter((t) => matchesSearch(t.label, query));
  const openAtSelection = () => { setOpen(true); setQuery(""); setSearching(false); setActive(value !== null && tests[value] ? value : 0); };
  const close = () => { setOpen(false); setQuery(""); setSearching(false); };
  const choose = (index: number) => { onChange(index); close(); };
  useLayoutEffect(() => {
    const menu=list.current,row=menu?.querySelector<HTMLElement>('[aria-selected="true"]');
    if(!open||!menu||!row)return;
    // Scroll only the popup, after its final width is applied. Text wrapping
    // changes row heights; scrollIntoView can also move ancestor containers.
    const top=row.offsetTop,bottom=top+row.offsetHeight;
    if(top<menu.scrollTop)menu.scrollTop=top;
    else if(bottom>menu.scrollTop+menu.clientHeight)menu.scrollTop=bottom-menu.clientHeight;
  }, [active,open,query,position.width,position.maxHeight]);
  return <div className="test-combobox" ref={root} onBlur={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) close();
  }}>
    <input className="input" role="combobox" aria-label={fieldLabel} aria-expanded={open}
      aria-autocomplete="list" aria-controls={id} aria-activedescendant={open && rows[active] ? `${id}-${rows[active].i}` : undefined}
      value={open && searching ? query : label} placeholder="Select or type to search…"
      onFocus={(e) => { openAtSelection(); e.currentTarget.select(); }}
      onClick={(e) => { if (!open) openAtSelection(); if(!searching)e.currentTarget.select(); }}
      onChange={(e) => { setQuery(e.target.value); setSearching(true); setOpen(true); setActive(0); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); close(); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); if(!open){openAtSelection();return;} setActive((i) => Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
        }
        if (e.key === "Enter" && open && rows[active]) { e.preventDefault(); choose(rows[active].i); }
      }} />
    {open && createPortal(<div ref={list} id={id} role="listbox" aria-label={`${fieldLabel} matches`} className="test-combobox-list" style={position}>
      {rows.map((row, index) => <button type="button" tabIndex={-1} role="option" id={`${id}-${row.i}`} key={row.i}
        title={row.label} aria-selected={index === active} onMouseDown={(e) => e.preventDefault()}
        onClick={() => choose(row.i)}>{row.label}</button>)}
      {!rows.length && <div className="empty-list">No matching tests</div>}
    </div>, document.body)}
  </div>;
}

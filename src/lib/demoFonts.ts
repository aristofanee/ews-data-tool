// The browser demo can tune text without changing production defaults.
let offset = 0;
export function demoFontOffset() { return offset; }
export const DEFAULT_FONT_INCREASE = 5;
export function graphFontOffset() { return DEFAULT_FONT_INCREASE + offset; }
export function setDemoFontOffset(value: number) {
  offset = value;
  document.documentElement.style.setProperty("--demo-font-offset", `${value}px`);
}

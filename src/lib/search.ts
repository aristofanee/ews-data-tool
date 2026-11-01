export function fuzzyMatch(text: string, needle: string): boolean {
  if (!needle) return true;
  const hay = text.toLowerCase();
  if (hay.includes(needle)) return true;
  let pos = 0;
  for (const ch of needle) { pos = hay.indexOf(ch, pos); if (pos < 0) return false; pos++; }
  return true;
}
export function matchesSearch(text: string, query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every((token) => fuzzyMatch(text, token));
}

export function fuzzyMatch(text: string, needle: string): boolean {
  if (!needle) return true;
  return text.toLowerCase().includes(needle.toLowerCase());
}
export function matchesSearch(text: string, query: string) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every((token) => fuzzyMatch(text, token));
}

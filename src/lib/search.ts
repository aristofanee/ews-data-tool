/** Case-insensitive subsequence matching. Spaces never restart the search. */
export function matchesSearch(text: string, query: string): boolean {
  const needle = query.replace(/\s+/g, "").toLowerCase();
  const haystack = text.toLowerCase();
  let position = 0;
  for (const character of needle) {
    const match = haystack.indexOf(character, position);
    if (match < 0) return false;
    position = match + 1;
  }
  return true;
}

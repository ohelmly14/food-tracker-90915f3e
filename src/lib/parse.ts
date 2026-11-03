/** "200 chicken", "200g chicken", "chicken 150 g" -> {grams, query}. */
export function parseShortcut(input: string): { grams?: number; query: string } {
  const s = input.trim();
  let m = s.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|grams?)?\s+(.+)$/i);
  if (m) return { grams: parseFloat(m[1].replace(',', '.')), query: m[2].trim() };
  m = s.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:g|gr|grams?)$/i);
  if (m) return { grams: parseFloat(m[2].replace(',', '.')), query: m[1].trim() };
  return { query: s };
}
export const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

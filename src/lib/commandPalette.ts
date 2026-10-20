/**
 * Matching for the command palette.
 *
 * Small on purpose: the palette holds tens of actions, not thousands, so
 * ranking clarity beats algorithmic cleverness. Every term of the query must
 * match somewhere; the rank prefers how a person abbreviates ("new ta" for
 * New task) over incidental substring hits.
 */

export type PaletteItem = {
  id: string;
  title: string;
  /** Section label in the list: "Go to", "Actions", "Sessions"… */
  group: string;
  /** Extra words the item should answer to but not display. */
  keywords?: string;
  /** Shown right-aligned: a shortcut, a status, a project name. */
  hint?: string;
};

/** How well one term matches one text. Higher is better; -1 is no match. */
export function scoreTerm(term: string, text: string): number {
  const t = text.toLowerCase();
  const q = term.toLowerCase();
  if (!q) return 0;
  if (t.startsWith(q)) return 100;
  // A word boundary start: "ta" hitting "New task".
  const word = t.search(new RegExp(`(?:^|[\\s\\-_/·.])${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  if (word >= 0) return 80;
  if (t.includes(q)) return 50;
  // Subsequence, the way launchers abbreviate: "nts" → "New task session".
  let index = 0;
  for (const ch of q) {
    index = t.indexOf(ch, index);
    if (index < 0) return -1;
    index += 1;
  }
  return 20;
}

export function scoreItem(query: string, item: PaletteItem): number {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const haystack = item.keywords ? `${item.title} ${item.keywords}` : item.title;
  let total = 0;
  for (const term of terms) {
    const score = Math.max(scoreTerm(term, item.title), scoreTerm(term, haystack) - 5);
    if (score < 0) return -1;   // every term must land somewhere
    total += score;
  }
  // Shorter titles win ties: "New task" above "New task session" for "new".
  return total - item.title.length * 0.1;
}

export function searchPalette<T extends PaletteItem>(items: T[], query: string, limit = 14): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: scoreItem(query, item) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

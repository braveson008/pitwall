/**
 * Matching what someone said against what actually exists.
 *
 * Speech does not arrive as identifiers. "the app component" has to find
 * `src/App.tsx`, "the frontend one" has to find a project named `web-frontend`,
 * and the transcriber will spell the same word differently on different days.
 *
 * The rule throughout is that an ambiguous match is *no* match. Opening the
 * wrong file is a small annoyance; switching to the wrong project and then
 * running a command against it is not. Returning null lets the assistant ask,
 * which is always recoverable.
 */

const NOISE = new Set([
  "the", "a", "an", "my", "our", "this", "that", "one", "project", "repo",
  "repository", "folder", "file", "please", "open", "to", "of", "in", "on",
  "component", "module", "switch", "go",
]);

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function meaningfulWords(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length > 1 && !NOISE.has(word));
}

/** Compact form used for "vscode" vs "vs code" style comparisons. */
function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface MatchResult<T> {
  item: T;
  score: number;
}

/**
 * Score a candidate against spoken words. Higher is better; 0 means no match.
 * Exported for tests — the scoring is the part worth pinning down.
 */
export function scoreCandidate(query: string, candidate: string): number {
  const wantedSquash = squash(query);
  const candidateSquash = squash(candidate);
  if (!wantedSquash || !candidateSquash) return 0;

  if (candidateSquash === wantedSquash) return 1000;
  // The basename matters more than the path: "app tsx" should prefer
  // `src/App.tsx` over `src/components/AppShell.tsx`. The extension is stripped
  // before squashing — squashing first removes the dot, so the suffix could
  // never be found.
  const rawBase = candidate.split("/").pop() || candidate;
  if (squash(rawBase) === wantedSquash) return 900;
  if (squash(rawBase.replace(/\.[a-z0-9]+$/i, "")) === wantedSquash) return 850;

  const words = meaningfulWords(query);
  if (!words.length) return 0;

  let score = 0;
  for (const word of words) {
    if (candidateSquash.includes(squash(word))) score += 100;
  }
  if (!score) return 0;

  // Every spoken word landing is a much stronger signal than some landing.
  if (score === words.length * 100) score += 200;
  // Prefer the shorter of two otherwise-equal candidates: it is the more
  // specific answer to a short spoken phrase.
  return score + Math.max(0, 60 - candidate.length);
}

/**
 * Pick the single best candidate, or null when nothing matched or the top two
 * are too close to call.
 */
export function bestMatch<T>(query: string, items: T[], toText: (item: T) => string): T | null {
  if (!query?.trim() || !items.length) return null;

  const scored: MatchResult<T>[] = items
    .map((item) => ({ item, score: scoreCandidate(query, toText(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].item;
}

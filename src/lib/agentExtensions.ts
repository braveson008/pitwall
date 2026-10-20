/**
 * Shared shaping for the extensions catalogue.
 *
 * The matcher is a copy of the one in `electron/lib/extensionCatalog.cjs`
 * rather than an import: that module is CommonJS in the main process, and the
 * search runs on every keystroke in the renderer against a few thousand rows.
 * Round-tripping that through IPC to reuse one function would make typing feel
 * broken.
 */

export type ExtensionTab = "plugins" | "skills" | "mcp";

/** The three tabs, in the order they are read. */
export const EXTENSION_TABS: Array<{ id: ExtensionTab; label: string }> = [
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "mcp", label: "MCP servers" },
];

/**
 * Whether a row matches what someone typed.
 *
 * Matches the name, the description and — for a skill — the plugin carrying it,
 * because "figma" should find `figma-use` whether that word is in the skill's
 * own name or only in the plugin's. Every word must match, so a second word
 * narrows the list rather than widening it.
 */
export function matchesQuery(
  row: { name?: string; description?: string; pluginName?: string; marketplace?: string; author?: string; category?: string },
  query: string,
): boolean {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  const haystack = [row?.name, row?.description, row?.pluginName, row?.marketplace, row?.author, row?.category]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

/**
 * A token count, said the way a person would.
 *
 * The figures run from tens to tens of thousands, and the difference between
 * 800 and 40,000 is the difference between "fine" and "a third of the context
 * before you have typed anything" — so the unit has to be visible at a glance
 * rather than counted in digits.
 */
export function formatTokens(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  if (value < 1000) return `${Math.round(value)}`;
  const thousands = value / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}k`;
}

/**
 * How many people use it, rounded to the honest precision.
 *
 * 1,193,335 is not a more useful number than 1.2M, and it is a much wider
 * column.
 */
export function formatInstalls(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

/**
 * What installing a skill actually brings.
 *
 * A skill is not installable by itself — installing one installs the plugin
 * carrying it, and every other skill in that plugin comes too. Saying so on the
 * row is the difference between an expected outcome and a confusing one.
 */
export function skillInstallNote(skill: { pluginName: string; siblings: number }): string {
  return skill.siblings > 1
    ? `Installs ${skill.pluginName}, with ${skill.siblings - 1} more skill${skill.siblings === 2 ? "" : "s"}`
    : `Installs ${skill.pluginName}`;
}

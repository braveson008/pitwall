/**
 * A Claude model's id from the name Pitwall shows for it.
 *
 * Sessions store the display name ("Opus 5.5"). When the discovered model list
 * did not have it at launch — restored before discovery finished, or the
 * CLI's cache had moved on — the display name went to the CLI as the model,
 * which it rejects. A session can run like that for hours, until compaction
 * asks for the model by name and the session ends at "Prompt is too long".
 */
export function claudeModelIdFromLabel(label: string): string | null {
  const match = String(label || "").trim().match(/^(Fable|Opus|Sonnet|Haiku) (\d+(?:\.\d+)*)( · 1M context)?$/i);
  if (!match) return null;
  return `claude-${match[1].toLowerCase()}-${match[2].replace(/\./g, "-")}${match[3] ? "[1m]" : ""}`;
}

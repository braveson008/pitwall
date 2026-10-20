import { TASK_SUMMARY_MARKER, parseTaskSummary } from "./taskSummary";
import { DEV_PREVIEW_MARKER, MOBILE_PREVIEW_MARKER } from "./devPreview";

/**
 * The protocol lines an agent prints for Pitwall, separated from its prose.
 *
 * A session ends by printing a summary as one line of JSON and its preview as
 * a marker and a URL. Those are addressed to the app, not to the reader — the
 * terminal shows them because the terminal shows whatever the CLI writes, but
 * chat is Pitwall's own rendering, and there a wall of escaped JSON at the end
 * of a turn is the least readable thing on the screen.
 *
 * The data is already parsed elsewhere to fill the task's completion summary.
 * This only decides what the reader sees in its place.
 */

export type AgentMarker =
  | { kind: "summary"; what: string; how: string; components: string[] }
  | { kind: "preview"; label: string; url: string };

export type MarkedText = { prose: string; markers: AgentMarker[] };

const PREVIEW_LINE = new RegExp(
  `(?:${DEV_PREVIEW_MARKER}|${MOBILE_PREVIEW_MARKER})\\s+(\\S+)`,
);

/**
 * Splits a message into what a person should read and what the app was told.
 *
 * Returns the prose unchanged when there is nothing to lift out, so ordinary
 * messages cost one scan and no allocation.
 */
export function extractAgentMarkers(text: string): MarkedText {
  const source = String(text || "");
  if (!source.includes(TASK_SUMMARY_MARKER) && !source.includes(DEV_PREVIEW_MARKER) && !source.includes(MOBILE_PREVIEW_MARKER)) {
    return { prose: source, markers: [] };
  }

  const markers: AgentMarker[] = [];
  const kept: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    if (line.includes(TASK_SUMMARY_MARKER)) {
      const summary = parseTaskSummary(line);
      if (summary) {
        markers.push({ kind: "summary", what: summary.what, how: summary.how, components: summary.components });
        continue;
      }
      // Unparseable: drop it anyway. A half-written JSON line is noise to a
      // reader whichever way it failed, and the terminal still has the truth.
      continue;
    }
    const preview = PREVIEW_LINE.exec(line);
    if (preview) {
      markers.push({
        kind: "preview",
        label: line.includes(MOBILE_PREVIEW_MARKER) ? "Mobile preview" : "Preview",
        url: preview[1],
      });
      continue;
    }
    kept.push(line);
  }

  return { prose: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), markers };
}

import type { PitwallTaskSummary } from "../domain/types";
import { markerPattern } from "./legacyNames";

export const TASK_SUMMARY_MARKER = "PITWALL_TASK_SUMMARY";
export const TASK_SUMMARY_PATTERN = new RegExp(markerPattern(TASK_SUMMARY_MARKER));

const clean = (value: unknown, limit: number) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

export function parseTaskSummary(output: string): Omit<PitwallTaskSummary, "reportedAt"> | null {
  const normalized = String(output || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  const lines = normalized.split(/\r?\n/).reverse();
  const marker = lines.map((candidate) => TASK_SUMMARY_PATTERN.exec(candidate)).find(Boolean);
  if (!marker) return null;
  const raw = marker.input.slice(marker.index + marker[0].length).trim();
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const what = clean(value.what, 1200);
  const how = clean(value.how, 1600);
  const components: string[] = Array.isArray(value.components)
    ? Array.from(new Set<string>(value.components.map((item: unknown) => clean(item, 240)).filter((item: string) => Boolean(item)))).slice(0, 40)
    : [];
  if (!what || !how) return null;
  return { what, how, components, source: "agent" };
}

export function mergeTaskSummaryComponents(
  summary: Omit<PitwallTaskSummary, "reportedAt">,
  changedFiles: string[],
) {
  return {
    ...summary,
    components: Array.from(new Set([...summary.components, ...changedFiles.map((file) => clean(file, 240)).filter(Boolean)])).slice(0, 40),
  };
}

import type { BraveliTaskSummary } from "../domain/types";

export const TASK_SUMMARY_MARKER = "BRAVELI_TASK_SUMMARY";

const clean = (value: unknown, limit: number) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

export function parseTaskSummary(output: string): Omit<BraveliTaskSummary, "reportedAt"> | null {
  const normalized = String(output || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  const lines = normalized.split(/\r?\n/).reverse();
  const line = lines.find((candidate) => candidate.includes(TASK_SUMMARY_MARKER));
  if (!line) return null;
  const raw = line.slice(line.indexOf(TASK_SUMMARY_MARKER) + TASK_SUMMARY_MARKER.length).trim();
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
  summary: Omit<BraveliTaskSummary, "reportedAt">,
  changedFiles: string[],
) {
  return {
    ...summary,
    components: Array.from(new Set([...summary.components, ...changedFiles.map((file) => clean(file, 240)).filter(Boolean)])).slice(0, 40),
  };
}

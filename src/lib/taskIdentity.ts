import type { BraveliTask } from "../domain/types";

const TASK_IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export function normalizeTaskIdentifier(value: string) {
  return value.trim().toLowerCase();
}

export function validateTaskIdentifier(value: string): string | null {
  const identifier = normalizeTaskIdentifier(value);
  if (!identifier) return "Task ID is required.";
  if (!TASK_IDENTIFIER_PATTERN.test(identifier) || identifier.includes("..") || identifier.endsWith(".lock")) {
    return "Use 1–64 letters, numbers, dots, underscores, or hyphens.";
  }
  return null;
}

export function taskBranchName(task: Pick<BraveliTask, "identifier" | "worktree">) {
  return task.identifier ? normalizeTaskIdentifier(task.identifier) : task.worktree;
}

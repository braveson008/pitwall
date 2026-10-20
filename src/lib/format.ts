import type { BraveliTask } from "../domain/types";
import type { ValidationResult } from "../domain/contracts";

export function nowIso() {
  return new Date().toISOString();
}

export function formatActivityTime(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function getTaskStatusLabel(status: BraveliTask["status"]) {
  return status.replace("-", " ");
}

export function getLanguageForFile(filePath: string) {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".ts")) return "typescript";
  if (filePath.endsWith(".jsx") || filePath.endsWith(".js")) return "javascript";
  if (filePath.endsWith(".css")) return "css";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".md")) return "markdown";
  if (filePath.endsWith(".html")) return "html";
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".rs")) return "rust";
  if (filePath.endsWith(".go")) return "go";
  if (filePath.endsWith(".yml") || filePath.endsWith(".yaml")) return "yaml";
  return "plaintext";
}

export function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function splitArgs(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * How long since a row last moved, in one column's width.
 *
 * `now` is a parameter so the tests do not depend on the clock. A clock skew
 * clamps to zero rather than printing a negative age, which would read as a
 * bug in the row rather than in the timestamp behind it.
 */
export function formatAge(value: string, now = Date.now()): string {
  const then = Date.parse(String(value || ""));
  if (!Number.isFinite(then)) return "\u2014";
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** What the project's own checks said, in one word. */
export function checkLabel(result?: ValidationResult): string {
  if (!result) return "\u2014";
  return result.ok ? "pass" : "fail";
}

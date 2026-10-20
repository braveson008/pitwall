import { writeStoredJson } from "../lib/storage";
import type { TaskRun } from "./contracts";
import type { AttemptOutcome } from "../lib/modelHistory";

/**
 * Runs, and the record they leave behind.
 *
 * Two stores rather than one, because they answer different questions and
 * have different lifetimes. A run is the state of one task moving through the
 * loop, and stops mattering once it has settled. An outcome is one line of
 * evidence about how a model does on work like this, and is the only reason
 * routing is ever better than a guess — so outcomes outlive the runs that
 * produced them and are never pruned with them.
 *
 * Without this file the router asks `modelHistory` a question nothing has ever
 * answered, and gets "No record here yet" forever.
 */

const RUNS_KEY = "braveli-task-runs";
const OUTCOMES_KEY = "braveli-model-outcomes";

/**
 * How many settled runs are kept.
 *
 * The transcripts and contracts live in the repository under `.braveli`; this
 * is the index over them, and an index that grows without bound in local
 * storage eventually costs more than it explains.
 */
const KEEP_SETTLED = 50;

function readArray<T>(key: string, valid: (item: unknown) => boolean): T[] {
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? (parsed.filter(valid) as T[]) : [];
  } catch {
    // Unreadable storage is an empty history, not a crash on boot.
    return [];
  }
}

export function readTaskRuns(): TaskRun[] {
  return readArray<TaskRun>(
    RUNS_KEY,
    (item) => Boolean(item && typeof item === "object" && (item as TaskRun).id && (item as TaskRun).taskId),
  );
}

export function writeTaskRuns(runs: TaskRun[]): void {
  // Newest first, and only the settled ones are trimmed: a run still moving is
  // never dropped for being old.
  const ordered = [...runs].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const live = ordered.filter((run) => !isSettled(run));
  const settled = ordered.filter(isSettled).slice(0, KEEP_SETTLED);
  writeStoredJson(RUNS_KEY, [...live, ...settled]);
}

function isSettled(run: TaskRun): boolean {
  return run.stage === "passed" || run.stage === "blocked";
}

/** Replaces one run, or adds it. */
export function upsertRun(runs: TaskRun[], next: TaskRun): TaskRun[] {
  const index = runs.findIndex((run) => run.id === next.id);
  if (index === -1) return [next, ...runs];
  return runs.map((run) => (run.id === next.id ? next : run));
}

export function readOutcomes(): AttemptOutcome[] {
  return readArray<AttemptOutcome>(
    OUTCOMES_KEY,
    (item) => Boolean(item && typeof item === "object" && typeof (item as AttemptOutcome).model === "string"),
  );
}

export function writeOutcomes(outcomes: AttemptOutcome[]): void {
  writeStoredJson(OUTCOMES_KEY, outcomes);
}

/**
 * The evidence a settled run leaves behind.
 *
 * One outcome per run rather than one per attempt: the question routing asks
 * is "how often does this model clear review on work like this", and an
 * attempt that was superseded by a fix from a different model is not an answer
 * to it. The model credited is the one that made the first attempt, since that
 * is the choice being judged.
 */
export function outcomeFor(run: TaskRun): AttemptOutcome | null {
  const first = run.attempts[0];
  if (!first) return null;
  if (run.stage !== "passed" && run.stage !== "blocked") return null;

  return {
    projectId: run.projectId,
    provider: first.provider,
    model: first.model,
    riskLevel: run.riskLevel,
    passed: run.stage === "passed",
    // Rejections, so a run that passed with no fix round counts as first time.
    rounds: run.qaRounds + 1,
    at: run.updatedAt,
  };
}

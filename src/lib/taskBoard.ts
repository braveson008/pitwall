import type { BraveliTask, BraveliTaskStatus } from "../domain/types";

/**
 * The board's columns, taken from wherever each task came from.
 *
 * Everything imported used to land in one "Ready" pile, so twenty-three tickets
 * that Jira knew as Backlog, To Do, Ready for QA and Failed on prod arrived
 * indistinguishable from each other — the board threw away the one thing the
 * tracker was certain about.
 *
 * The column is Pitwall's own, seeded from the source status. That distinction
 * matters: dragging a card here never touches the ticket, so a column cannot
 * claim to be what Jira currently says. It is this board's view, which started
 * as the tracker's.
 */

/** Pitwall's own states, for a task that came from nowhere else. */
const LOCAL_COLUMNS: Record<BraveliTaskStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  running: "In progress",
  review: "Review",
  completed: "Done",
  cancelled: "Cancelled",
};

/**
 * Where a status sits in a pipeline, for ordering columns left to right.
 *
 * Matched on words rather than exact names because every tracker spells these
 * differently — "To Do", "todo", "Selected for development". An unranked column
 * sorts after the known ones rather than being dropped: a team's custom state is
 * still part of their flow.
 */
const RANKS: Array<[RegExp, number]> = [
  [/backlog|icebox|triage/i, 10],
  [/to.?do|selected|ready for dev|^ready$|\bopen|\bnew\b/i, 20],
  [/in.?progress|doing|develop|wip/i, 30],
  [/review|code.?review|\bprs?\b/i, 40],
  [/qa|test|verif/i, 50],
  [/fail|blocked|reopen/i, 55],
  [/deploy|staging|release|\bprod/i, 60],
  [/done|closed|complete|shipped|live/i, 70],
  [/cancel|won.?t|abandon/i, 80],
];

/** What an unrecognised column scores: between review and QA, and not merged. */
export const UNRANKED = 45;

export function columnRank(name: string) {
  for (const [pattern, rank] of RANKS) if (pattern.test(name)) return rank;
  return UNRANKED;
}

/** The column a task belongs in: its own, else the tracker's, else Pitwall's. */
export function columnFor(task: BraveliTask) {
  const moved = task.boardColumn?.trim();
  if (moved) return moved;
  const source = task.source?.status?.trim();
  if (source) return normaliseStatus(source);
  return LOCAL_COLUMNS[task.status] ?? "Ready";
}

/**
 * A status as the tracker means it.
 *
 * Only machine spellings are rewritten — `READY_FOR_QA`, `in-progress` — because
 * those are identifiers, not labels. Anything a person wrote is left exactly as
 * they wrote it: title-casing it turned "Ready for QA" into "Ready For Qa",
 * which is both wrong and rude about their acronym.
 */
export function normaliseStatus(value: string) {
  const text = value.trim().replace(/\s+/g, " ");
  const machineSpelled = /[_-]/.test(text) || (text === text.toUpperCase() && /[A-Z]/.test(text));
  if (!machineSpelled) return text;
  return text
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

export type BoardColumn = { name: string; tasks: BraveliTask[] };

/**
 * Columns in pipeline order, with the tasks in each.
 *
 * `always` keeps a column on the board once it exists even when it empties out,
 * so a card dragged out of the last slot does not take its destination with it.
 */
export function buildBoard(tasks: BraveliTask[], always: string[] = []): BoardColumn[] {
  /*
   * The tracker's columns are the board, and Pitwall's own only fill what the
   * tracker does not cover.
   *
   * Both used to be added blind and keyed by their exact spelling, so a project
   * synced from Jira got two columns called "in progress" — Pitwall's, and the
   * tracker's "In Progress", differing by one capital letter — and an empty
   * "Review" sitting next to the tracker's "Code review" saying the same thing.
   * The board showed a pipeline the team does not have.
   *
   * So: match on the name case-insensitively, take the tracker's spelling when
   * they collide, and drop one of Pitwall's defaults when the tracker already
   * has a column at that point in the pipeline. A column the team invented is
   * never dropped — only Pitwall's own suggestions are.
   */
  const columns = new Map<string, BoardColumn>();
  for (const task of tasks) {
    const name = columnFor(task);
    const key = name.toLowerCase();
    const existing = columns.get(key);
    if (existing) existing.tasks.push(task);
    else columns.set(key, { name, tasks: [task] });
  }

  const occupied = new Set([...columns.values()].map((column) => columnRank(column.name)));
  for (const name of always) {
    if (columns.has(name.toLowerCase())) continue;
    // An unranked column is a custom one, and two custom columns sharing the
    // fallback rank say nothing about each other — so only a recognised stage
    // suppresses one of Pitwall's defaults.
    const rank = columnRank(name);
    if (rank !== UNRANKED && occupied.has(rank)) continue;
    columns.set(name.toLowerCase(), { name, tasks: [] });
  }

  return [...columns.values()]
    .sort((left, right) => columnRank(left.name) - columnRank(right.name) || left.name.localeCompare(right.name));
}

/** Pitwall's own state, said plainly, for the badge on a card. */
export function localStateLabel(status: BraveliTaskStatus) {
  return LOCAL_COLUMNS[status] ?? status;
}

/**
 * Whether a task's Pitwall state is worth showing next to its column.
 *
 * Only when the two disagree. A card sitting in "In progress" does not need a
 * badge that says "in progress"; one sitting in Jira's "Backlog" while Pitwall
 * has a run going very much does.
 */
export function showsLocalState(task: BraveliTask) {
  if (task.status === "backlog" || task.status === "ready") return false;
  return columnFor(task).toLowerCase() !== localStateLabel(task.status).toLowerCase();
}

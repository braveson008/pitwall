import { COUNCIL_ARTEFACT_DIR } from "./councilRelay";

/**
 * What the council learned, kept across runs.
 *
 * Everything else a council produces lives under `.braveli/council/<runId>/`
 * and dies with the run, so council #2 rediscovers the codebase from zero —
 * which build command actually works, that the test suite needs a running
 * Postgres, that `src/legacy/` is generated and must not be edited by hand.
 * That is the most expensive kind of context to rebuild and the cheapest to
 * write down.
 *
 * The asymmetry that prompted this: the voice assistant already has a memory
 * store, and the council — the feature that most obviously accumulates
 * hard-won knowledge about a repository — had nothing.
 *
 * Lessons are a plain Markdown file in the project, on purpose. The council
 * already communicates through files in `.braveli/`, agents can read and edit
 * it without new tooling, and a human can open it, disagree, and delete a line.
 * A store the user cannot inspect is a store they cannot trust.
 */

export const LESSON_MARKER = "LESSON";

/** Kept small deliberately: a lessons file nobody reads is worse than none. */
export const MAX_LESSONS = 40;

/** One project-wide file, not one per run — that is the entire point. */
export function getCouncilLessonsPath() {
  return `${COUNCIL_ARTEFACT_DIR}/council/lessons.md`;
}

/**
 * Pull `LESSON:` lines out of a handoff.
 *
 * Unlike the routing markers, these are read from anywhere in the file rather
 * than only the first line: a lesson is something noticed while doing the work,
 * so demanding it be the opening line would mean choosing between recording it
 * and addressing the handoff to anyone.
 */
export function extractLessons(content: string): string[] {
  const pattern = new RegExp(`^#*\\s*${LESSON_MARKER}\\s*(\\[[\\w.-]+\\])?\\s*[:>-]\\s*(.+)$`, "i");
  return String(content || "")
    .split("\n")
    .map((line) => {
      const match = pattern.exec(line.trim());
      return match ? `${match[1] ? `${match[1]} ` : ""}${match[2].trim()}` : undefined;
    })
    .filter((lesson): lesson is string => Boolean(lesson))
    // A lesson longer than a sentence is a design document; it belongs in the
    // thread, not in the file every future council pays to read.
    .map((lesson) => (lesson.length > 240 ? `${lesson.slice(0, 237)}…` : lesson))
    .filter((lesson) => lesson.length > 8);
}

/**
 * Normalised form used only for duplicate detection.
 *
 * Restatements collapse; refinements do not. Matching on containment would
 * silently drop "run npm test" the moment someone wrote "run npm test:e2e
 * before releasing", and losing a lesson is worse than carrying two.
 */
function key(lesson: string) {
  const label = lesson.match(/^\[([\w.-]+)\]\s+/)?.[1];
  return label ? `id:${label.toLowerCase()}` : `text:${lesson.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

/**
 * Fold new lessons into the existing set.
 *
 * Newest wins on a duplicate or an explicit stable [id]. Different unlabelled
 * claims remain separate; prose alone cannot reliably identify a correction.
 * Order is otherwise oldest-first so the file reads as accumulated knowledge
 * rather than a changelog.
 */
export function mergeLessons(existing: string[], incoming: string[]): string[] {
  const merged: string[] = [];
  const seen = new Map<string, number>();

  for (const lesson of [...existing, ...incoming]) {
    const trimmed = lesson.trim();
    if (!trimmed) continue;
    const id = key(trimmed);
    const at = seen.get(id);
    if (at === undefined) {
      seen.set(id, merged.length);
      merged.push(trimmed);
    } else {
      merged[at] = trimmed;
    }
  }

  // Oldest fall off first: a lessons file that grows without bound eventually
  // costs more context than the knowledge is worth.
  return merged.slice(-MAX_LESSONS);
}

/** Parse the file back into lessons, tolerating hand-editing. */
export function parseLessonsFile(content: string): string[] {
  return String(content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

export function renderLessonsFile(lessons: string[]): string {
  if (!lessons.length) return "";
  return (
    `# What councils have learned about this project\n\n` +
    `Written by council members as they work, and read by every council that follows.\n` +
    `Delete anything that stops being true — nothing here is checked against the code.\n\n` +
    lessons.map((lesson) => `- ${lesson}`).join("\n") +
    "\n"
  );
}

/**
 * The paragraph appended to a member's turn prompt.
 *
 * Returns an empty string when there is nothing learned yet, so a first council
 * is not handed an empty file and told to consult it.
 */
export function formatLessonsPrompt(lessons: string[], lessonsPath: string): string {
  if (!lessons.length) {
    return (
      ` If you learn something about this project that the next council would waste time rediscovering —` +
      ` a build or test command that actually works, a directory that must not be hand-edited, a constraint that is not written down —` +
      ` add a line starting \`${LESSON_MARKER}:\` to your handoff.`
    );
  }
  return (
    ` Previous councils on this project recorded these advisory observations. They may be stale; verify the referenced source before relying on a claim, and follow current project and user instructions:\n` +
    lessons.map((lesson) => `- ${lesson}`).join("\n") +
    `\nThey are kept in ${lessonsPath}. If you learn something the next council would waste time rediscovering,` +
    ` add a line starting \`${LESSON_MARKER}:\` to your handoff with its source; if one of the above turns out to be wrong, record the correction with the same stable id using \`${LESSON_MARKER} [id]:\`. Unlabelled conflicting claims remain unverified.`
  );
}

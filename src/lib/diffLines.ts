/**
 * A unified diff, turned into lines a person can read.
 *
 * Rendering `git diff` verbatim shows five lines of plumbing before the first
 * real change — `diff --git`, `index 00000000..c1c20ca6`, `--- /dev/null`,
 * `+++ b/…` — none of which says anything the file list has not already said.
 * And without line numbers a diff cannot be talked about: "it breaks near the
 * top" is not a place.
 *
 * So the preamble is dropped, hunks become a marker rather than a line of
 * `@@` arithmetic, and every line carries the numbers it has on each side.
 */

export type DiffLineKind = "add" | "del" | "context" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  /** Line number in the original file, absent for an addition. */
  oldNo?: number;
  /** Line number in the new file, absent for a deletion. */
  newNo?: number;
  /** The line without its leading +/-/space. */
  text: string;
  /** For a hunk, what it says about where you are. */
  label?: string;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Lines git prints about the file rather than about the change. */
const PREAMBLE = /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to |Binary files )/;

export function parseUnifiedDiff(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;

  for (const raw of String(patch || "").split(/\r?\n/)) {
    const hunk = raw.match(HUNK);
    if (hunk) {
      oldNo = Number.parseInt(hunk[1], 10);
      newNo = Number.parseInt(hunk[3], 10);
      out.push({
        kind: "hunk",
        // The function or section git found for this hunk, when it found one.
        // More use than the arithmetic, which the line numbers already give.
        label: hunk[5]?.trim() || "",
        text: "",
      });
      continue;
    }

    // Dropped: it describes the file, and the file is named above the patch.
    if (PREAMBLE.test(raw)) continue;

    // Before the first hunk there is nothing to number.
    if (!out.length && !raw.trim()) continue;

    if (raw.startsWith("+")) {
      out.push({ kind: "add", newNo, text: raw.slice(1) });
      newNo += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      out.push({ kind: "del", oldNo, text: raw.slice(1) });
      oldNo += 1;
      continue;
    }
    if (raw.startsWith("\\")) {
      // "\ No newline at end of file" — true, and not a line of the file.
      out.push({ kind: "meta", text: raw.slice(2) });
      continue;
    }

    out.push({ kind: "context", oldNo, newNo, text: raw.startsWith(" ") ? raw.slice(1) : raw });
    oldNo += 1;
    newNo += 1;
  }

  // A trailing blank from the final newline is not a line of the diff.
  while (out.length && out[out.length - 1].kind === "context" && out[out.length - 1].text === "") out.pop();
  return out;
}

/** The widest line number, so the gutter can be sized once rather than jump. */
export function gutterWidth(lines: DiffLine[]): number {
  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, String(line.oldNo ?? "").length, String(line.newNo ?? "").length);
  }
  return Math.max(2, widest);
}

import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { ThreadMessage } from "./ThreadMessage";
import { summariseTool } from "../lib/toolSummary";
import type { TranscriptEntry } from "../lib/agentStream";

/**
 * One session, read as a conversation.
 *
 * The same thread the Council is read as — same cards, same folding, same
 * shared component — because reading back what an agent did is one act, and
 * having it look like two different things in two places would be a choice
 * nobody made on purpose.
 *
 * What a solo session has that a Council turn does not is the work between the
 * sentences: the thinking, and every tool call. Both are collapsed by default.
 * A turn is a handful of sentences and a hundred tool calls, and a transcript
 * that shows all of them is a log — which the terminal already is, better.
 */

/** Prose is the thread; everything else is what happened between the prose. */
function isSaid(entry: TranscriptEntry) {
  return entry.kind === "user" || entry.kind === "text";
}

export function SessionThread({
  entries,
  agent,
  cwd,
}: {
  entries: TranscriptEntry[];
  agent: string;
  cwd?: string;
}) {
  // Whatever was said last is what the reader came for, so it is the one card
  // that starts open. Everything above it is history they can unfold.
  const lastSaidId = [...entries].reverse().find(isSaid)?.id;

  // Runs of work are folded as a unit rather than one line each: forty tool
  // calls between two sentences should read as "it did forty things", not as
  // forty things to scroll past.
  const groups: Array<{ kind: "said"; entry: TranscriptEntry } | { kind: "work"; id: string; entries: TranscriptEntry[] }> = [];
  for (const entry of entries) {
    if (isSaid(entry)) {
      groups.push({ kind: "said", entry });
      continue;
    }
    if (entry.kind === "notice" || entry.kind === "queued") continue;
    const last = groups[groups.length - 1];
    if (last?.kind === "work") last.entries.push(entry);
    else groups.push({ kind: "work", id: entry.id, entries: [entry] });
  }

  if (groups.length === 0) return null;

  // The agent is named once per turn, where its turn begins, rather than above
  // every paragraph it writes between tool calls.
  const opensTurn = (index: number) => {
    const before = groups[index - 1];
    return !before || (before.kind === "said" && before.entry.kind === "user");
  };

  return (
    <div className="dk-thread">
      {groups.map((group, index) =>
        group.kind === "said" ? (
          <ThreadMessage
            key={group.entry.id}
            tone={group.entry.kind === "user" ? "user" : "member"}
            who={group.entry.kind === "user" ? "You" : agent}
            content={"text" in group.entry ? group.entry.text : ""}
            openByDefault={group.entry.id === lastSaidId}
            continued={group.entry.kind !== "user" && !opensTurn(index)}
          />
        ) : (
          <div className="dk-msg" key={group.id}>
            {opensTurn(index) ? (
              <header className="dk-msg-head">
                <span className="dk-msg-tile" aria-hidden="true">{agent.charAt(0).toUpperCase()}</span>
                <strong className="dk-msg-who">{agent}</strong>
              </header>
            ) : null}
            <Work entries={group.entries} cwd={cwd} />
          </div>
        ),
      )}
    </div>
  );
}

type ToolEntry = Extract<TranscriptEntry, { kind: "tool" }>;
type Activity = "read" | "edit" | "run" | "search" | "think" | "ask" | "other";

const ACTIVITY_BY_TOOL: Record<string, Activity> = {
  read: "read", notebookread: "read", read_file: "read",
  edit: "edit", multiedit: "edit", write: "edit", notebookedit: "edit", apply_patch: "edit",
  bash: "run", shell: "run", exec_command: "run", local_shell: "run",
  grep: "search", glob: "search", ls: "search", websearch: "search", webfetch: "search",
};

function activityOf(entry: TranscriptEntry): Activity {
  if (entry.kind === "thinking") return "think";
  if (entry.kind === "question") return "ask";
  if (entry.kind !== "tool") return "other";
  return ACTIVITY_BY_TOOL[entry.name.toLowerCase()] ?? "other";
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const lineCount = (value: unknown) => (typeof value === "string" && value ? value.split("\n").length : 0);

/** Lines added and removed by an edit, read off its own input. */
function editStat(entry: ToolEntry) {
  const input = (entry.input && typeof entry.input === "object" ? entry.input : {}) as Record<string, unknown>;
  const pairs = Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]) : [input];
  let added = lineCount(input.content);
  let removed = 0;
  for (const pair of pairs) {
    added += lineCount(pair.new_string);
    removed += lineCount(pair.old_string);
  }
  const patch = typeof entry.input === "string" ? entry.input : typeof input.input === "string" ? input.input : "";
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path;

/** One line per kind of work: what a reader would say it did. */
function describeActivity(kind: Activity, entries: TranscriptEntry[], cwd?: string) {
  const tools = entries.filter((entry): entry is ToolEntry => entry.kind === "tool");
  const details = tools.map((tool) => summariseTool(tool.name, tool.input, cwd).detail).filter(Boolean);
  const files = new Set(details);
  if (kind === "read") {
    const first = details[0] ? basename(details[0]) : "";
    return { label: `Read ${plural(files.size || tools.length, "file")}`, detail: first && files.size > 1 ? `${first} +${files.size - 1}` : first };
  }
  if (kind === "edit") {
    const stat = tools.map(editStat).reduce((sum, next) => ({ added: sum.added + next.added, removed: sum.removed + next.removed }), { added: 0, removed: 0 });
    return { label: `Edited ${plural(files.size || tools.length, "file")}`, detail: "", stat };
  }
  if (kind === "run") {
    const command = details[details.length - 1] ?? "";
    if (tools.length === 1 && command.length <= 48) return { label: `Ran ${command}`.trim(), detail: "" };
    return { label: `Ran ${plural(tools.length, "command")}`, detail: command };
  }
  if (kind === "search") return { label: `Searched ${plural(tools.length, "time")}`, detail: details[details.length - 1] ?? "" };
  if (kind === "think") return { label: entries.length === 1 ? "Thought" : `Thought ${entries.length} times`, detail: "" };
  if (kind === "ask") return { label: entries.length === 1 ? "Asked you a question" : `Asked you ${entries.length} times`, detail: "" };
  const names = [...new Set(tools.map((tool) => tool.name))];
  return { label: names.length === 1 ? `Used ${names[0]}` : `Used ${plural(tools.length, "tool")}`, detail: names.length > 1 ? names.join(", ") : "" };
}

/**
 * What the agent did between saying things.
 *
 * One card, one row per kind of work — "Read 4 files", "Edited 2 files +14 −3"
 * — each openable. The count is the useful part at a glance; the detail is for
 * when something looks wrong.
 */
function Work({ entries, cwd }: { entries: TranscriptEntry[]; cwd?: string }) {
  const rows: Array<{ kind: Activity; entries: TranscriptEntry[] }> = [];
  for (const entry of entries) {
    const kind = activityOf(entry);
    const row = rows.find((item) => item.kind === kind);
    if (row) row.entries.push(entry);
    else rows.push({ kind, entries: [entry] });
  }
  if (rows.length === 0) return null;

  return (
    <div className="dk-tool-card">
      {rows.map((row) => (
        <WorkRow key={row.kind} kind={row.kind} entries={row.entries} cwd={cwd} />
      ))}
    </div>
  );
}

function WorkRow({ kind, entries, cwd }: { kind: Activity; entries: TranscriptEntry[]; cwd?: string }) {
  const [open, setOpen] = useState(false);
  const { label, detail, stat } = describeActivity(kind, entries, cwd);
  const failed = entries.filter((entry) => "state" in entry && entry.state === "error").length;

  return (
    <div className={`dk-tool-row${open ? " is-open" : ""}`}>
      <button type="button" className="dk-tool-toggle" aria-expanded={open} onClick={() => setOpen((now) => !now)}>
        <ChevronRight size={14} className={open ? "is-open" : undefined} aria-hidden="true" />
        <span className="dk-tool-label">{label}</span>
        {detail ? <span className="dk-tool-detail dk-mono">{detail}</span> : <span className="dk-spacer" />}
        {stat && stat.added ? <span className="dk-tool-added dk-mono">+{stat.added}</span> : null}
        {stat && stat.removed ? <span className="dk-tool-removed dk-mono">−{stat.removed}</span> : null}
        {failed ? <span className="dk-badge dk-badge--red">{failed} failed</span> : null}
      </button>

      {open ? (
        <ol className="dk-tool-list">
          {entries.map((entry) =>
            entry.kind === "thinking" ? (
              <li className="dk-tool-thought" key={entry.id}>{entry.text}</li>
            ) : entry.kind === "tool" ? (
              <li className={entry.state === "error" ? "is-failed" : undefined} key={entry.id}>
                <span className="dk-tool-name">{entry.name}</span>
                {/* The part of a call worth reading — the path, the command —
                    rather than its whole argument object. */}
                <code className="dk-mono">{summariseTool(entry.name, entry.input, cwd).detail}</code>
                {entry.state === "error" && entry.result ? <em>{entry.result.slice(0, 200)}</em> : null}
              </li>
            ) : entry.kind === "question" ? (
              <li key={entry.id}>
                <code className="dk-mono">asked you {entry.questions.length === 1 ? "a question" : `${entry.questions.length} questions`}</code>
              </li>
            ) : null,
          )}
        </ol>
      ) : null}
    </div>
  );
}

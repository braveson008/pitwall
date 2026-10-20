/**
 * Claude's own protocol, reduced into something renderable.
 *
 * A terminal pane shows whatever the CLI painted on a screen, which is why
 * nothing in the app can tell a tool call from a sentence, or know that a run
 * has finished. Claude records the structured form of the same conversation in
 * its session file, and this turns those records into a list of entries a
 * component can draw.
 *
 * This used to reduce a *live* stream from a second headless process running
 * beside the terminal's. That process is gone — two agents on one conversation
 * can disagree about it — and the reducer stayed, because the file holds the
 * same shapes and cannot disagree with the CLI that wrote it.
 *
 * Every shape here was taken from a real session rather than from the docs:
 * text is `{type,text}`, thinking is `{type,thinking,signature}`, a call is
 * `{type,id,name,input}`, and its result comes back on a *user* message as
 * `{type,tool_use_id,content}` — which is why results are matched by id rather
 * than by position.
 */

export type ToolState = "running" | "ok" | "error";

/** The tool the agent uses to put a choice to the user. */
export const QUESTION_TOOL = "AskUserQuestion";

export type QuestionOption = { label: string; description: string };
export type AgentQuestion = { question: string; header: string; multiSelect: boolean; options: QuestionOption[] };

/**
 * The questions inside an AskUserQuestion call, or null for anything else.
 * Shape taken from a real session: `{questions:[{question,header,multiSelect,
 * options:[{label,description}]}]}`.
 */
export function readQuestions(name: string, input: unknown): AgentQuestion[] | null {
  if (name !== QUESTION_TOOL || !input || typeof input !== "object") return null;
  const questions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return null;
  const parsed = questions
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .map((entry) => ({
      question: String(entry.question ?? ""),
      header: String(entry.header ?? ""),
      multiSelect: Boolean(entry.multiSelect),
      options: Array.isArray(entry.options)
        ? entry.options
            .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === "object")
            .map((option) => ({ label: String(option.label ?? ""), description: String(option.description ?? "") }))
            .filter((option) => option.label)
        : [],
    }))
    .filter((entry) => entry.question || entry.options.length);
  return parsed.length ? parsed : null;
}

/** When an entry happened, where the record says so. */
export type Timed = { at?: string };

export type TranscriptEntry = Timed & (
  | { kind: "user"; id: string; text: string }
  | { kind: "text"; id: string; text: string }
  | { kind: "thinking"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; state: ToolState; result: string }
  | { kind: "question"; id: string; questions: AgentQuestion[]; state: ToolState; result: string }
  | { kind: "queued"; id: string; text: string }
  | { kind: "notice"; id: string; tone: "info" | "error"; text: string }
);

export type TranscriptState = {
  entries: TranscriptEntry[];
  sessionId: string;
  model: string;
  /** What the CLI reports it can do, for a palette that is not guesswork. */
  slashCommands: string[];
  tools: string[];
  /** A turn is in flight: the agent owes us a result. */
  busy: boolean;
  lastResult: { ok: boolean; turns: number; costUsd: number | null } | null;
};

export const EMPTY_TRANSCRIPT: TranscriptState = {
  entries: [],
  sessionId: "",
  model: "",
  slashCommands: [],
  tools: [],
  busy: false,
  lastResult: null,
};

type Block = Record<string, unknown>;

/** Tool results arrive as text or as a list of blocks; both render as text. */
function readToolResult(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && typeof block === "object" ? String((block as Block).text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

function blocksOf(message: unknown): Block[] {
  const content = (message as { content?: unknown })?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as Block[]) : [];
}

/**
 * Replaces an entry with the same id rather than appending a second copy, so
 * replaying a stream — reconnecting, resuming, re-reading a journal — lands on
 * the same transcript instead of a doubled one.
 */
function put(entries: TranscriptEntry[], entry: TranscriptEntry): TranscriptEntry[] {
  const index = entries.findIndex((item) => item.id === entry.id);
  if (index === -1) return [...entries, entry];
  const next = [...entries];
  next[index] = entry;
  return next;
}

export function reduceAgentEvent(state: TranscriptState, event: unknown): TranscriptState {
  if (!event || typeof event !== "object") return state;
  const record = event as Record<string, unknown>;

  switch (record.type) {
    case "system": {
      if (record.subtype !== "init") return state;
      return {
        ...state,
        sessionId: String(record.session_id ?? state.sessionId),
        model: String(record.model ?? state.model),
        slashCommands: Array.isArray(record.slash_commands) ? record.slash_commands.map(String) : state.slashCommands,
        tools: Array.isArray(record.tools) ? record.tools.map(String) : state.tools,
      };
    }

    case "user": {
      let entries = state.entries;
      let busy = state.busy;
      const at = typeof record.timestamp === "string" ? record.timestamp : undefined;
      blocksOf(record.message).forEach((block, index) => {
        if (block.type === "tool_result") {
          const id = String(block.tool_use_id ?? "");
          const existing = entries.find((item) => item.id === id);
          if (existing?.kind !== "tool" && existing?.kind !== "question") return;
          entries = put(entries, {
            ...existing,
            state: block.is_error ? "error" : "ok",
            result: readToolResult(block.content),
          });
          return;
        }
        if (block.type === "text") {
          // The echo of what we sent, via --replay-user-messages: the app's own
          // acknowledgement that the turn actually reached the agent.
          entries = put(entries, {
            kind: "user",
            id: `${record.uuid ?? "user"}:${index}`,
            text: String(block.text ?? ""),
            at,
          });
          busy = true;
        }
      });
      return { ...state, entries, busy };
    }

    case "assistant": {
      const message = record.message as Record<string, unknown> | undefined;
      /**
       * Whether the agent still owes us work, taken from the message itself.
       *
       * `busy` used to clear only on a `result` event — and `result` is part of
       * the streaming protocol, not the session history. Read through the
       * history file there is no such record, so the state never cleared and a
       * finished session sat there saying "Thinking" indefinitely.
       *
       * `stop_reason` is the honest signal: "tool_use" means another turn is
       * coming, "end_turn" means it is done. Absent means mid-flight.
       */
      const stopReason = message?.stop_reason;
      const stillWorking = stopReason === null || stopReason === undefined || stopReason === "tool_use";
      const at = typeof record.timestamp === "string" ? record.timestamp : undefined;
      const messageId = String(message?.id ?? record.uuid ?? "assistant");
      // Every assistant message names its model. `init` carries it too, but init
      // only exists in the streaming protocol — read through the history file it
      // never arrives, so anything that waits for it stays empty forever.
      //
      // A message the CLI wrote itself rather than asked a model for — "No
      // response requested." and friends — is marked `<synthetic>`. That is a
      // marker, not a model, and showing it in place of one reads as though the
      // session had switched to something called "<synthetic>".
      const named = typeof message?.model === "string" ? message.model : "";
      const model = named && !named.startsWith("<") ? named : state.model;
      let entries = state.entries;
      blocksOf(message).forEach((block, index) => {
        const fallbackId = `${messageId}:${index}`;
        if (block.type === "text") {
          entries = put(entries, { kind: "text", id: fallbackId, text: String(block.text ?? ""), at });
        } else if (block.type === "thinking") {
          entries = put(entries, { kind: "thinking", id: fallbackId, text: String(block.thinking ?? ""), at });
        } else if (block.type === "tool_use") {
          const id = String(block.id ?? fallbackId);
          const name = String(block.name ?? "tool");
          const questions = readQuestions(name, block.input);
          // A question is not a tool call to read past; it is the agent waiting
          // on the user, and it gets a shape that says so.
          entries = put(entries, questions
            ? { kind: "question", id, questions, state: "running", result: "" }
            : {
                kind: "tool",
                id,
                name,
                input: block.input ?? {},
                state: "running",
                result: "",
              });
        }
      });
      return { ...state, entries, model, busy: stillWorking };
    }

    case "result": {
      return {
        ...state,
        busy: false,
        lastResult: {
          ok: !record.is_error,
          turns: Number(record.num_turns ?? 0),
          costUsd: typeof record.total_cost_usd === "number" ? record.total_cost_usd : null,
        },
        entries: record.is_error
          ? put(state.entries, {
              kind: "notice",
              id: `result:${record.uuid ?? state.entries.length}`,
              tone: "error",
              text: String(record.result ?? "The run ended with an error."),
            })
          : state.entries,
      };
    }

    /**
     * A prompt typed while the agent was busy. It is not a turn yet — the CLI
     * holds it and takes it when the current one finishes — so it is shown as
     * waiting rather than as something already said. `remove` fires both when it
     * is picked up and when it is cancelled; either way it stops waiting.
     */
    case "queue-operation": {
      const text = String(record.content ?? "").trim();
      if (!text) return state;
      const id = `queued:${text}`;
      if (record.operation === "remove") {
        return { ...state, entries: state.entries.filter((entry) => entry.id !== id) };
      }
      if (record.operation !== "enqueue") return state;
      return { ...state, entries: put(state.entries, { kind: "queued", id, text }) };
    }

    case "rate_limit_event": {
      return {
        ...state,
        entries: put(state.entries, {
          kind: "notice",
          id: `rate-limit:${record.uuid ?? state.entries.length}`,
          tone: "info",
          text: "Rate limited — the agent is waiting before it continues.",
        }),
      };
    }

    default:
      return state;
  }
}

export function reduceAgentEvents(state: TranscriptState, events: unknown[]): TranscriptState {
  return events.reduce<TranscriptState>(reduceAgentEvent, state);
}


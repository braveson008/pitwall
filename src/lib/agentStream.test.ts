import { describe, expect, it } from "vitest";
import {
  EMPTY_TRANSCRIPT,
  readQuestions,
  reduceAgentEvent,
  reduceAgentEvents,
  type TranscriptState,
} from "./agentStream";

// The shapes below are copied from a real `--output-format stream-json` run,
// not from documentation: thinking carries `thinking`, a call carries `id` and
// `input`, and its result comes back on a *user* message quoting `tool_use_id`.
const init = {
  type: "system",
  subtype: "init",
  session_id: "sess-1",
  model: "claude-sonnet-5",
  slash_commands: ["config", "permissions"],
  tools: ["Read", "Bash"],
};
const userTurn = {
  type: "user",
  uuid: "u1",
  message: { role: "user", content: [{ type: "text", text: "Read note.txt" }] },
};
const assistantWork = {
  type: "assistant",
  message: {
    id: "msg-1",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "The file is small.", signature: "sig" },
      { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "note.txt" } },
    ],
  },
};
const toolResult = {
  type: "user",
  uuid: "u2",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "hello from a file" }],
  },
};
const answer = {
  type: "assistant",
  message: { id: "msg-2", role: "assistant", content: [{ type: "text", text: "Greeting sent from a file." }] },
};
const done = { type: "result", subtype: "success", is_error: false, num_turns: 2, total_cost_usd: 0.1 };

const run = (events: unknown[]): TranscriptState => reduceAgentEvents(EMPTY_TRANSCRIPT, events);

describe("reduceAgentEvent", () => {
  it("takes the session's own account of itself from init", () => {
    const state = run([init]);
    expect(state.sessionId).toBe("sess-1");
    expect(state.model).toBe("claude-sonnet-5");
    expect(state.slashCommands).toEqual(["config", "permissions"]);
  });

  it("builds a transcript in the order the work happened", () => {
    const state = run([init, userTurn, assistantWork, toolResult, answer, done]);
    expect(state.entries.map((entry) => entry.kind)).toEqual(["user", "thinking", "tool", "text"]);
  });

  it("attaches a result to its own call rather than the most recent one", () => {
    const twoCalls = {
      type: "assistant",
      message: {
        id: "msg-1",
        content: [
          { type: "tool_use", id: "toolu_a", name: "Read", input: {} },
          { type: "tool_use", id: "toolu_b", name: "Glob", input: {} },
        ],
      },
    };
    // The second call answers first, which is exactly when matching by
    // position instead of by id puts the output under the wrong tool.
    const state = run([
      twoCalls,
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_b", content: "glob output" }] } },
    ]);
    const tools = state.entries.filter((entry) => entry.kind === "tool");
    expect(tools).toMatchObject([
      { name: "Read", state: "running", result: "" },
      { name: "Glob", state: "ok", result: "glob output" },
    ]);
  });

  it("marks a failed call as failed", () => {
    const state = run([
      assistantWork,
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "no such file", is_error: true }],
        },
      },
    ]);
    expect(state.entries.find((entry) => entry.kind === "tool")).toMatchObject({ state: "error", result: "no such file" });
  });

  it("reads a result delivered as blocks rather than as a string", () => {
    const state = run([
      assistantWork,
      {
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "toolu_1",
            content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }],
          }],
        },
      },
    ]);
    expect(state.entries.find((entry) => entry.kind === "tool")).toMatchObject({ result: "line one\nline two" });
  });

  it("ignores a result quoting a call it never saw", () => {
    const state = run([
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "ghost", content: "x" }] } },
    ]);
    expect(state.entries).toEqual([]);
  });

  it("is busy from the turn until the result", () => {
    expect(run([userTurn]).busy).toBe(true);
    expect(run([userTurn, assistantWork]).busy).toBe(true);
    expect(run([userTurn, assistantWork, toolResult, answer, done]).busy).toBe(false);
  });

  it("records what the run cost", () => {
    expect(run([userTurn, done]).lastResult).toEqual({ ok: true, turns: 2, costUsd: 0.1 });
  });

  it("surfaces a failed run as a notice", () => {
    const state = run([{ type: "result", is_error: true, result: "Exceeded turn limit", uuid: "r1" }]);
    expect(state.entries).toMatchObject([{ kind: "notice", tone: "error", text: "Exceeded turn limit" }]);
    expect(state.lastResult?.ok).toBe(false);
  });

  it("says so when the agent is being rate limited", () => {
    const state = run([{ type: "rate_limit_event", uuid: "rl1" }]);
    expect(state.entries).toMatchObject([{ kind: "notice", tone: "info" }]);
  });

  it("replaying the same stream gives the same transcript", () => {
    const events = [init, userTurn, assistantWork, toolResult, answer, done];
    // Reconnecting or resuming replays events that were already applied. An
    // entry that appends instead of replacing turns that into a doubled
    // transcript, which is worse than showing nothing.
    expect(run([...events, ...events])).toEqual(run(events));
  });

  it("shrugs off events it does not model", () => {
    const before = run([init]);
    expect(reduceAgentEvent(before, { type: "system", subtype: "thinking_tokens" })).toEqual(before);
    expect(reduceAgentEvent(before, null)).toEqual(before);
    expect(reduceAgentEvent(before, { type: "who_knows" })).toEqual(before);
  });
});


describe("readQuestions", () => {
  // Shape copied from a real AskUserQuestion call in a live session.
  const input = {
    questions: [{
      question: "How should I handle the dead prototype?",
      header: "Dead code",
      multiSelect: false,
      options: [
        { label: "Delete it (Recommended)", description: "Removes ~9 files." },
        { label: "Leave it in place", description: "Smaller diff." },
      ],
    }],
  };

  it("reads a question the agent is waiting on", () => {
    expect(readQuestions("AskUserQuestion", input)).toEqual([{
      question: "How should I handle the dead prototype?",
      header: "Dead code",
      multiSelect: false,
      options: [
        { label: "Delete it (Recommended)", description: "Removes ~9 files." },
        { label: "Leave it in place", description: "Smaller diff." },
      ],
    }]);
  });

  it("ignores every other tool", () => {
    expect(readQuestions("Bash", { command: "ls" })).toBeNull();
    expect(readQuestions("AskUserQuestion", { notQuestions: [] })).toBeNull();
    expect(readQuestions("AskUserQuestion", null)).toBeNull();
    expect(readQuestions("AskUserQuestion", { questions: [] })).toBeNull();
  });

  it("drops options with no label rather than rendering blank rows", () => {
    const parsed = readQuestions("AskUserQuestion", {
      questions: [{ question: "Pick", options: [{ label: "" }, { label: "Real" }, null] }],
    });
    expect(parsed?.[0].options).toEqual([{ label: "Real", description: "" }]);
  });
});

describe("questions in a transcript", () => {
  const asking = {
    type: "assistant",
    message: {
      id: "msg-q",
      content: [{
        type: "tool_use",
        id: "toolu_q",
        name: "AskUserQuestion",
        input: { questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A" }] }] },
      }],
    },
  };

  it("becomes a question entry rather than a tool call", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [asking]);
    expect(state.entries).toMatchObject([{ kind: "question", state: "running" }]);
  });

  it("closes when the answer comes back", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      asking,
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "toolu_q", content: "A" }] } },
    ]);
    expect(state.entries).toMatchObject([{ kind: "question", state: "ok", result: "A" }]);
  });
});

describe("queued prompts", () => {
  const enqueue = { type: "queue-operation", operation: "enqueue", content: "also please run the app" };

  it("shows a prompt typed while the agent was busy as waiting", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [userTurn, enqueue]);
    expect(state.entries.map((entry) => entry.kind)).toEqual(["user", "queued"]);
    expect(state.entries[1]).toMatchObject({ text: "also please run the app" });
  });

  it("stops showing it once the agent takes it", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      enqueue,
      { type: "queue-operation", operation: "remove", content: "also please run the app" },
    ]);
    expect(state.entries).toEqual([]);
  });

  it("does not stack the same queued prompt twice", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [enqueue, enqueue]);
    expect(state.entries).toHaveLength(1);
  });

  it("ignores an empty or unknown queue operation", () => {
    expect(reduceAgentEvents(EMPTY_TRANSCRIPT, [{ type: "queue-operation", operation: "enqueue", content: "  " }]).entries).toEqual([]);
    expect(reduceAgentEvents(EMPTY_TRANSCRIPT, [{ type: "queue-operation", operation: "reorder", content: "x" }]).entries).toEqual([]);
  });
});

describe("busy without a result event", () => {
  // The mirror reads the session history, which contains no `result` records —
  // that is a streaming-protocol event. Clearing `busy` only on `result` left a
  // finished session saying "Thinking" forever.
  const turn = { type: "user", uuid: "u9", message: { content: [{ type: "text", text: "delete the svg too" }] } };

  it("is idle once the agent has ended its turn", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      turn,
      { type: "assistant", message: { id: "m1", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] } },
    ]);
    expect(state.busy).toBe(false);
  });

  it("stays busy while the agent is calling tools", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      turn,
      {
        type: "assistant",
        message: { id: "m1", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
      },
    ]);
    expect(state.busy).toBe(true);
  });

  it("stays busy for a message still in flight", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      turn,
      { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "partial" }] } },
    ]);
    expect(state.busy).toBe(true);
  });

  it("goes busy again on the next turn", () => {
    const finished = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      { type: "assistant", message: { id: "m1", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] } },
    ]);
    expect(finished.busy).toBe(false);
    expect(reduceAgentEvent(finished, turn).busy).toBe(true);
  });
});

describe("state the streaming protocol would have carried", () => {
  // `system/init` names the session and model, and it does not exist in the
  // session history. Anything that only reads init is empty through the mirror,
  // which is how the status line ended up saying "Not started" about a live
  // conversation and never showed a model.
  it("takes the model from the assistant's own message", () => {
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      { type: "assistant", message: { id: "m1", model: "claude-opus-5", stop_reason: "end_turn", content: [{ type: "text", text: "hi" }] } },
    ]);
    expect(state.model).toBe("claude-opus-5");
  });

  it("does not mistake the synthetic marker for a model", () => {
    // The CLI marks messages it wrote itself — "No response requested." — as
    // `<synthetic>`. Shown in the status line it read as though the session had
    // switched to a model by that name.
    const state = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      { type: "assistant", message: { id: "m1", model: "claude-opus-5", content: [] } },
      { type: "assistant", message: { id: "m2", model: "<synthetic>", content: [{ type: "text", text: "No response requested." }] } },
    ]);
    expect(state.model).toBe("claude-opus-5");
  });

  it("keeps the model it already knew when a message omits it", () => {
    const first = reduceAgentEvents(EMPTY_TRANSCRIPT, [
      { type: "assistant", message: { id: "m1", model: "claude-opus-5", content: [] } },
    ]);
    const second = reduceAgentEvent(first, { type: "assistant", message: { id: "m2", content: [] } });
    expect(second.model).toBe("claude-opus-5");
  });
});

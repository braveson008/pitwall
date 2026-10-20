import { describe, expect, it } from "vitest";
import { parseCodexRollout, rolloutCwd, contentText, summaryText, toolState } from "./codexTranscript.cjs";

const item = (payload: unknown, timestamp = "2026-08-26T10:00:00Z") =>
  JSON.stringify({ type: "response_item", timestamp, payload });

describe("contentText", () => {
  it("joins the parts of a content array", () => {
    expect(contentText([{ type: "input_text", text: "one" }, { type: "input_text", text: "two" }])).toBe("one\ntwo");
  });

  it("takes a plain string as it is", () => {
    expect(contentText("just text")).toBe("just text");
  });

  it("survives nothing", () => {
    expect(contentText(null)).toBe("");
    expect(contentText([{}, { text: "" }])).toBe("");
  });
});

describe("summaryText", () => {
  // Each summary is its own bolded heading. Running them together makes a
  // sentence the agent never wrote.
  it("keeps each summary on its own line", () => {
    expect(summaryText([{ text: "**Planning**" }, { text: "**Checking**" }])).toBe("**Planning**\n**Checking**");
  });

  it("says nothing when there is nothing", () => {
    expect(summaryText(undefined)).toBe("");
  });
});

describe("toolState", () => {
  // However it was marked, a call whose output never arrived is still running.
  it("is running until the output arrives", () => {
    expect(toolState("completed", false)).toBe("running");
  });

  it("is ok once the output arrives", () => {
    expect(toolState("completed", true)).toBe("ok");
  });

  it("reports a failure as an error", () => {
    expect(toolState("failed", true)).toBe("error");
  });
});

describe("parseCodexRollout", () => {
  it("reads the user's turns and the assistant's answers", () => {
    const entries = parseCodexRollout([
      item({ type: "message", id: "m1", role: "user", content: [{ text: "Fix the tests" }] }),
      item({ type: "message", id: "m2", role: "assistant", content: [{ text: "Done." }] }),
    ]);
    expect(entries).toEqual([
      expect.objectContaining({ kind: "user", text: "Fix the tests" }),
      expect.objectContaining({ kind: "text", text: "Done." }),
    ]);
  });

  // `developer` is the harness talking — memory preambles, tool policy, the
  // instructions Pitwall itself supplied. Showing it as the user's own words is
  // the difference between a transcript and one you can trust.
  it("leaves out the harness's own messages", () => {
    const entries = parseCodexRollout([
      item({ type: "message", role: "developer", content: [{ text: "## Memory\\nYou have access to…" }] }),
    ]);
    expect(entries).toEqual([]);
  });

  it("reads reasoning summaries as thinking", () => {
    const entries = parseCodexRollout([
      item({ type: "reasoning", id: "r1", summary: [{ text: "**Planning**" }] }),
    ]);
    expect(entries[0]).toMatchObject({ kind: "thinking", text: "**Planning**" });
  });

  // Reasoning with no summary is an encrypted blob and nothing else.
  it("skips reasoning that carries no summary", () => {
    expect(parseCodexRollout([item({ type: "reasoning", id: "r1", encrypted_content: "gAAA…" })])).toEqual([]);
  });

  // Results arrive as their own record, possibly far after the call, and
  // interleaved calls do not come back in order — so they are matched by id.
  it("attaches a result to the call it belongs to", () => {
    const entries = parseCodexRollout([
      item({ type: "custom_tool_call", id: "c1", call_id: "call_a", name: "exec", input: "ls", status: "completed" }),
      item({ type: "custom_tool_call", id: "c2", call_id: "call_b", name: "exec", input: "pwd", status: "completed" }),
      item({ type: "custom_tool_call_output", call_id: "call_b", output: [{ text: "/repo" }] }),
      item({ type: "custom_tool_call_output", call_id: "call_a", output: [{ text: "a.ts" }] }),
    ]);
    const [first, second] = entries;
    expect(first).toMatchObject({ name: "exec", input: "ls", result: "a.ts", state: "ok" });
    expect(second).toMatchObject({ input: "pwd", result: "/repo", state: "ok" });
  });

  it("shows a call still waiting on its output as running", () => {
    const [entry] = parseCodexRollout([
      item({ type: "custom_tool_call", id: "c1", call_id: "call_a", name: "exec", status: "completed" }),
    ]);
    expect(entry.state).toBe("running");
  });

  it("ignores an output whose call it never saw", () => {
    expect(parseCodexRollout([item({ type: "custom_tool_call_output", call_id: "gone", output: [] })])).toEqual([]);
  });

  it("reads function calls as well as custom ones", () => {
    const [entry] = parseCodexRollout([
      item({ type: "function_call", id: "f1", call_id: "call_a", name: "search", arguments: "{}" }),
    ]);
    expect(entry).toMatchObject({ kind: "tool", name: "search" });
  });

  // A rollout is written a line at a time by a live process; the last one can
  // be half there.
  it("skips a line that will not parse rather than giving up on the file", () => {
    const entries = parseCodexRollout([
      item({ type: "message", role: "user", content: [{ text: "kept" }] }),
      '{"type":"response_item","payl',
    ]);
    expect(entries).toHaveLength(1);
  });

  it("ignores records that are not conversation", () => {
    const entries = parseCodexRollout([
      JSON.stringify({ type: "event_msg", payload: { type: "anything" } }),
      JSON.stringify({ type: "turn_context", payload: {} }),
    ]);
    expect(entries).toEqual([]);
  });

  // A long session is megabytes and the end is the part anyone reads.
  it("keeps the tail rather than the head", () => {
    const lines = Array.from({ length: 10 }, (_, index) =>
      item({ type: "message", role: "user", content: [{ text: `turn ${index}` }] }),
    );
    const entries = parseCodexRollout(lines, { limit: 3 });
    expect(entries.map((entry: { text: string }) => entry.text)).toEqual(["turn 7", "turn 8", "turn 9"]);
  });

  it("accepts a whole file as one string", () => {
    const entries = parseCodexRollout(item({ type: "message", role: "user", content: [{ text: "hi" }] }));
    expect(entries).toHaveLength(1);
  });

  it("survives nothing at all", () => {
    expect(parseCodexRollout(null)).toEqual([]);
    expect(parseCodexRollout([])).toEqual([]);
  });
});

describe("rolloutCwd", () => {
  // Rollouts are filed by date, not by project, so the only way to know which
  // repository one belongs to is to open it and look.
  it("finds the working directory in the session header", () => {
    const lines = [JSON.stringify({ type: "session_meta", payload: { cwd: "/repo/app" } })];
    expect(rolloutCwd(lines)).toBe("/repo/app");
  });

  it("says nothing when the header is missing", () => {
    expect(rolloutCwd([JSON.stringify({ type: "response_item" })])).toBe("");
    expect(rolloutCwd([])).toBe("");
  });

  it("keeps looking past a line it cannot parse", () => {
    expect(rolloutCwd(["{oops", JSON.stringify({ type: "session_meta", payload: { cwd: "/repo" } })])).toBe("/repo");
  });
});

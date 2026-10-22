import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyInitialPromptLaunch,
  applyNativeSessionLaunch,
  claudeProjectDirectory,
  findActiveClaudeSession,
  findHermesSessionId,
  readClaudeSessionRecords,
  readClaudeSessionSince,
} from "./nativeSessions.cjs";

const SESSION_ID = "6ccddba3-9def-4693-9f47-f9925cad8c74";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-sessions-"));
const cwd = "/tmp/a-project";

function writeSession(lines: unknown[], sessionId = SESSION_ID) {
  const directory = claudeProjectDirectory(cwd, home);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, `${sessionId}.jsonl`),
    lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"),
    "utf8",
  );
}

afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

describe("readClaudeSessionRecords", () => {
  it("reads the conversation a resumed session already holds", () => {
    // The shape is the CLI's own: the same {type, message} records the live
    // stream emits, which is why they replay through the same reducer.
    writeSession([
      { type: "user", uuid: "u1", isSidechain: false, message: { role: "user", content: [{ type: "text", text: "hello" }] } },
      { type: "assistant", uuid: "a1", message: { id: "m1", content: [{ type: "text", text: "hi" }] } },
    ]);
    const records = readClaudeSessionRecords(cwd, SESSION_ID, { homeDir: home });
    expect(records).toEqual([
      { type: "user", uuid: "u1", message: { role: "user", content: [{ type: "text", text: "hello" }] } },
      { type: "assistant", uuid: "a1", message: { id: "m1", content: [{ type: "text", text: "hi" }] } },
    ]);
  });

  it("leaves out records that are not conversation", () => {
    writeSession([
      { type: "attachment", attachment: {} },
      { type: "last-prompt", lastPrompt: "x" },
      { type: "system", subtype: "hook_started" },
      { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "kept" }] } },
    ]);
    const records = readClaudeSessionRecords(cwd, SESSION_ID, { homeDir: home });
    expect(records.map((record: { type: string }) => record.type)).toEqual(["user"]);
  });

  it("keeps a prompt queued while the agent was busy", () => {
    // Typed during a turn, so it is not a conversation record yet — it becomes
    // one only when the agent reaches it. Filtering these out is why a queued
    // message showed in the terminal and nowhere else.
    writeSession([
      { type: "user", uuid: "u1", message: { content: [{ type: "text", text: "first" }] } },
      { type: "queue-operation", operation: "enqueue", content: "also please run the app" },
    ]);
    const records = readClaudeSessionRecords(cwd, SESSION_ID, { homeDir: home });
    expect(records[1]).toEqual({ type: "queue-operation", operation: "enqueue", content: "also please run the app" });
  });

  it("leaves out subagent sidechains", () => {
    // Sidechain work belongs to a tool call, not to the conversation.
    // Interleaving it reads as the agent talking over itself.
    writeSession([
      { type: "assistant", uuid: "a1", isSidechain: true, message: { content: [{ type: "text", text: "subagent" }] } },
      { type: "assistant", uuid: "a2", message: { content: [{ type: "text", text: "main" }] } },
    ]);
    const records = readClaudeSessionRecords(cwd, SESSION_ID, { homeDir: home });
    expect(records).toHaveLength(1);
    expect(records[0].uuid).toBe("a2");
  });

  it("keeps the tail when a session is longer than the limit", () => {
    writeSession(
      Array.from({ length: 20 }, (_, index) => ({
        type: "user",
        uuid: `u${index}`,
        message: { content: [{ type: "text", text: `turn ${index}` }] },
      })),
    );
    const records = readClaudeSessionRecords(cwd, SESSION_ID, { homeDir: home, limit: 5 });
    expect(records).toHaveLength(5);
    expect(records[0].uuid).toBe("u15");
    expect(records[4].uuid).toBe("u19");
  });

  it("survives a truncated or half-written line", () => {
    // The file is appended to by a live process, so the last line can be a
    // partial write. One bad line must not lose the whole conversation.
    writeSession([
      JSON.stringify({ type: "user", uuid: "u1", message: { content: [{ type: "text", text: "good" }] } }),
      '{"type":"assistant","message":{"content":[{"type":"te',
    ]);
    const records = readClaudeSessionRecords(cwd, SESSION_ID, { homeDir: home });
    expect(records).toHaveLength(1);
    expect(records[0].uuid).toBe("u1");
  });

  it("answers with nothing rather than throwing for an unknown session", () => {
    expect(readClaudeSessionRecords(cwd, "11111111-2222-4333-8444-555555555555", { homeDir: home })).toEqual([]);
    expect(readClaudeSessionRecords(cwd, "not-a-uuid", { homeDir: home })).toEqual([]);
    expect(readClaudeSessionRecords(cwd, "", { homeDir: home })).toEqual([]);
  });
});

describe("readClaudeSessionSince", () => {
  function appendSession(lines: unknown[]) {
    const directory = claudeProjectDirectory(cwd, home);
    fs.mkdirSync(directory, { recursive: true });
    fs.appendFileSync(
      path.join(directory, `${SESSION_ID}.jsonl`),
      lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n",
      "utf8",
    );
  }

  it("reads only what was appended since the last read", () => {
    writeSession([]);
    fs.writeFileSync(path.join(claudeProjectDirectory(cwd, home), `${SESSION_ID}.jsonl`), "", "utf8");
    appendSession([{ type: "user", uuid: "u1", message: { content: [{ type: "text", text: "first" }] } }]);

    const first = readClaudeSessionSince(cwd, SESSION_ID, 0, { homeDir: home });
    expect(first.records.map((r: { uuid: string }) => r.uuid)).toEqual(["u1"]);
    expect(first.offset).toBeGreaterThan(0);

    // Re-reading from the same offset with nothing new must produce nothing,
    // otherwise a watcher would replay the conversation on every file touch.
    expect(readClaudeSessionSince(cwd, SESSION_ID, first.offset, { homeDir: home }).records).toEqual([]);

    appendSession([{ type: "assistant", uuid: "a1", message: { content: [{ type: "text", text: "second" }] } }]);
    const second = readClaudeSessionSince(cwd, SESSION_ID, first.offset, { homeDir: home });
    expect(second.records.map((r: { uuid: string }) => r.uuid)).toEqual(["a1"]);
  });

  it("leaves a half-written trailing line for the next read", () => {
    const file = path.join(claudeProjectDirectory(cwd, home), `${SESSION_ID}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // A live CLI appends in chunks, so a read can land mid-record. Consuming
    // the partial line would drop that record permanently.
    fs.writeFileSync(file, JSON.stringify({ type: "user", uuid: "u1", message: { content: [] } }) + "\n" + '{"type":"assis', "utf8");

    const first = readClaudeSessionSince(cwd, SESSION_ID, 0, { homeDir: home });
    expect(first.records.map((r: { uuid: string }) => r.uuid)).toEqual(["u1"]);

    fs.appendFileSync(file, 'tant","uuid":"a1","message":{"content":[]}}\n', "utf8");
    const second = readClaudeSessionSince(cwd, SESSION_ID, first.offset, { homeDir: home });
    expect(second.records.map((r: { uuid: string }) => r.uuid)).toEqual(["a1"]);
  });

  it("starts over when the file shrinks under it", () => {
    const file = path.join(claudeProjectDirectory(cwd, home), `${SESSION_ID}.jsonl`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ type: "user", uuid: "only", message: { content: [] } }) + "\n", "utf8");
    const result = readClaudeSessionSince(cwd, SESSION_ID, 999_999, { homeDir: home });
    expect(result.records.map((r: { uuid: string }) => r.uuid)).toEqual(["only"]);
  });

  it("answers with nothing for a session that does not exist", () => {
    expect(readClaudeSessionSince(cwd, "11111111-2222-4333-8444-555555555555", 0, { homeDir: home })).toEqual({
      records: [],
      offset: 0,
    });
  });
});

describe("findActiveClaudeSession", () => {
  const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  function writeAt(sessionId: string, mtimeMs: number) {
    const directory = claudeProjectDirectory(cwd, home);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${sessionId}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({ type: "user", uuid: sessionId, message: { content: [] } }) + "\n", "utf8");
    fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
  }

  function clearProject() {
    const directory = claudeProjectDirectory(cwd, home);
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
  }

  it("keeps the preferred session while it is the one being written", () => {
    clearProject();
    writeAt(SESSION_ID, Date.now());
    writeAt(OTHER, Date.now() - 60_000);
    expect(findActiveClaudeSession(cwd, SESSION_ID, home)).toBe(SESSION_ID);
  });

  it("moves to a newer session the CLI started instead", () => {
    // A resume that does not take, or a compaction that opens a fresh session,
    // leaves the preferred file stale. Following it renders a conversation that
    // never moves again.
    clearProject();
    writeAt(SESSION_ID, Date.now() - 60_000);
    writeAt(OTHER, Date.now());
    expect(findActiveClaudeSession(cwd, SESSION_ID, home)).toBe(OTHER);
  });

  it("falls back to the newest when the preferred one is gone or invalid", () => {
    clearProject();
    writeAt(OTHER, Date.now());
    expect(findActiveClaudeSession(cwd, "11111111-2222-4333-8444-555555555555", home)).toBe(OTHER);
    expect(findActiveClaudeSession(cwd, "not-a-uuid", home)).toBe(OTHER);
    expect(findActiveClaudeSession(cwd, "", home)).toBe(OTHER);
  });

  it("answers null when the project has no conversations", () => {
    clearProject();
    expect(findActiveClaudeSession(cwd, SESSION_ID, home)).toBeNull();
  });
});

describe("Hermes launch", () => {
  const launch = { command: "hermes", args: ["chat", "--cli"], display: "hermes chat --cli" };
  const HERMES_ID = "20261006_224344_f695b1";

  it("resumes a known session by id, after the subcommand", () => {
    const result = applyNativeSessionLaunch(launch, { agent: "Hermes", resumeSession: true, nativeSessionId: HERMES_ID }, cwd);
    expect(result.args).toEqual(["chat", "--cli", "--resume", HERMES_ID]);
    expect(result.nativeSessionMode).toBe("resume");
  });

  it("falls back to the latest session in this folder, not the machine", () => {
    const result = applyNativeSessionLaunch(launch, { agent: "Hermes", resumeSession: true, nativeSessionId: "not-an-id" }, cwd);
    expect(result.args).toEqual(["chat", "--cli", "--resume", "latest", "--in", cwd]);
    expect(result.nativeSessionId).toBeNull();
  });

  it("starts fresh when not resuming", () => {
    const result = applyNativeSessionLaunch(launch, { agent: "Hermes", nativeSessionId: HERMES_ID }, cwd);
    expect(result.args).toEqual(["chat", "--cli"]);
    expect(result.nativeSessionMode).toBe("none");
  });

  it("passes the first turn with -q", () => {
    const result = applyInitialPromptLaunch(launch, { agent: "Hermes", initialPrompt: "  fix the build " });
    expect(result.args).toEqual(["chat", "--cli", "-q", "fix the build"]);
    expect(result.initialPromptMode).toBe("argument");
  });

  it("reads the session id from the startup banner", () => {
    expect(findHermesSessionId(`│  Session: ${HERMES_ID}                          research: arxiv │`)).toBe(HERMES_ID);
    expect(findHermesSessionId("Welcome to Hermes Agent!")).toBeNull();
  });
});

describe("a Claude session's name on its command line", () => {
  it("is one line, since a line break ends the command under Windows' cmd and drops every argument after it", () => {
    const launch = { command: "claude", args: ["--model", "opus"], display: "claude" };
    const result = applyNativeSessionLaunch(launch, { agent: "Claude", nativeSessionId: "6523ae4d-67ec-4ef9-94ca-2bddac75e5e5", sessionName: "Add the step helpers.\n\nThen   wire them in." }, os.tmpdir());
    expect(result.args).toEqual(["--session-id", "6523ae4d-67ec-4ef9-94ca-2bddac75e5e5", "--name", "Add the step helpers. Then wire them in.", "--model", "opus"]);
  });
});

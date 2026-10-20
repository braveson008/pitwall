import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeProjectDirectory } from "./nativeSessions.cjs";
import { createSessionMirror } from "./sessionMirror.cjs";

const A = "6ccddba3-9def-4693-9f47-f9925cad8c74";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const cwd = "/tmp/mirror-project";

let home = "";
const mirrors: Array<{ stop: () => void }> = [];

function freshHome() {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "braveli-mirror-"));
  fs.mkdirSync(claudeProjectDirectory(cwd, home), { recursive: true });
  // The reader resolves HOME itself, so the test points the process at a
  // throwaway one rather than reaching into the developer's real sessions.
  process.env.HOME = home;
  // Node reads the home directory from USERPROFILE on Windows.
  process.env.USERPROFILE = home;
  return home;
}

function append(sessionId: string, records: unknown[], mtimeMs?: number) {
  const file = path.join(claudeProjectDirectory(cwd, home), `${sessionId}.jsonl`);
  fs.appendFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  if (mtimeMs) fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

const turn = (uuid: string, text: string) => ({
  type: "user",
  uuid,
  message: { role: "user", content: [{ type: "text", text }] },
});

/** No timers, no fs.watch: every pass is driven explicitly. */
function mirror(preferredId = "") {
  const seen: any[] = [];
  const instance = createSessionMirror({
    cwd,
    preferredId,
    emit: (payload: unknown) => seen.push(payload),
    watch: () => {
      throw new Error("no watching in tests");
    },
    setIntervalFn: () => 0 as unknown as NodeJS.Timeout,
    clearIntervalFn: () => {},
  });
  mirrors.push(instance);
  return { instance, seen };
}

const realHome = process.env.HOME;
const realProfile = process.env.USERPROFILE;
afterEach(() => {
  while (mirrors.length) mirrors.pop()!.stop();
  if (home) fs.rmSync(home, { recursive: true, force: true });
  process.env.HOME = realHome;
  if (realProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = realProfile;
});

describe("createSessionMirror", () => {
  it("reports the conversation already on disk", () => {
    freshHome();
    append(A, [turn("u1", "first"), turn("u2", "second")]);
    const { seen } = mirror();
    const history = seen.filter((payload) => payload.history).flatMap((payload) => payload.history);
    expect(history.map((record: { uuid: string }) => record.uuid)).toEqual(["u1", "u2"]);
  });

  it("reports a turn appended after it started — the whole point", () => {
    freshHome();
    append(A, [turn("u1", "first")]);
    const { instance, seen } = mirror();
    seen.length = 0;

    append(A, [turn("u2", "sent from the composer")]);
    instance.pump();

    const history = seen.filter((payload) => payload.history).flatMap((payload) => payload.history);
    expect(history.map((record: { uuid: string }) => record.uuid)).toEqual(["u2"]);
  });

  it("says nothing when nothing was appended", () => {
    freshHome();
    append(A, [turn("u1", "first")]);
    const { instance, seen } = mirror();
    seen.length = 0;
    instance.pump();
    instance.pump();
    // Re-reporting on every pass would replay the conversation forever. Status
    // still flows, so a stalled follower stays visible.
    expect(seen.filter((payload) => payload.history)).toEqual([]);
  });

  it("follows the CLI when it moves to a new session file", () => {
    freshHome();
    const old = Date.now() - 120_000;
    append(A, [turn("u1", "old conversation")], old);
    const { instance, seen } = mirror(A);
    seen.length = 0;

    // What happens after a failed compaction: the CLI opens a fresh session and
    // never touches the old file again.
    append(B, [turn("u2", "new conversation")], Date.now());
    instance.pump();

    expect(seen.some((payload) => payload.reset)).toBe(true);
    const history = seen.filter((payload) => payload.history).flatMap((payload) => payload.history);
    expect(history.map((record: { uuid: string }) => record.uuid)).toEqual(["u2"]);
    expect(instance.sessionId).toBe(B);
  });

  it("keeps following the new file once it has moved", () => {
    freshHome();
    append(A, [turn("u1", "old")], Date.now() - 120_000);
    const { instance, seen } = mirror(A);
    append(B, [turn("u2", "new")], Date.now());
    instance.pump();
    seen.length = 0;

    append(B, [turn("u3", "newer")], Date.now());
    instance.pump();
    const history = seen.filter((payload) => payload.history).flatMap((payload) => payload.history);
    expect(history.map((record: { uuid: string }) => record.uuid)).toEqual(["u3"]);
  });

  it("waits quietly until a conversation exists", () => {
    freshHome();
    const { instance, seen } = mirror();
    expect(seen.filter((payload) => payload.history)).toEqual([]);

    append(A, [turn("u1", "the first turn")]);
    instance.pump();
    const history = seen.filter((payload) => payload.history).flatMap((payload) => payload.history);
    expect(history.map((record: { uuid: string }) => record.uuid)).toEqual(["u1"]);
  });

  it("stops reporting once stopped", () => {
    freshHome();
    append(A, [turn("u1", "first")]);
    const { instance, seen } = mirror();
    instance.stop();
    seen.length = 0;
    append(A, [turn("u2", "after stop")]);
    instance.pump();
    expect(seen).toEqual([]);
  });
});

describe("createSessionMirror payload limits", () => {
  it("cuts a huge tool result down before it crosses the boundary", () => {
    freshHome();
    // A real session here was 8.7MB across 589 records, nearly all of it tool
    // output. Sending that whole stalls the loop meant to deliver the next turn.
    append(A, [{
      type: "user",
      uuid: "u1",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x".repeat(50_000) }] },
    }]);
    const { seen } = mirror();
    const record = seen.filter((p) => p.history).flatMap((p) => p.history)[0];
    const text = record.message.content[0].content;
    expect(text.length).toBeLessThan(5_000);
    expect(text).toContain("more characters");
  });

  it("sends the tail rather than every record of a long session", () => {
    freshHome();
    append(A, Array.from({ length: 400 }, (_, index) => turn(`u${index}`, `turn ${index}`)));
    const { seen } = mirror();
    const history = seen.filter((p) => p.history).flatMap((p) => p.history);
    expect(history.length).toBeLessThanOrEqual(150);
    expect(history[history.length - 1].uuid).toBe("u399");
  });

  it("reports which conversation it is following and how far it has got", () => {
    freshHome();
    append(A, [turn("u1", "first")]);
    const { instance, seen } = mirror();
    const status = seen.filter((p) => p.status).pop().status;
    expect(status.claudeSessionId).toBe(A);
    expect(status.records).toBe(1);

    append(A, [turn("u2", "second")]);
    instance.pump();
    expect(seen.filter((p) => p.status).pop().status.records).toBe(2);
  });
});

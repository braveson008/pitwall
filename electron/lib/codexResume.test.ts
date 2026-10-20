import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import native from "./nativeSessions.cjs";

const { applyNativeSessionLaunch, findCodexSessionSince } = native;

let root: string;
const write = (name: string, id: string, cwd: string, at: number) => {
  const dir = path.join(root, "2026", "10", "06");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify({ type: "session_meta", payload: { id, cwd, timestamp: new Date(at).toISOString() } })}\n{"type":"x"}\n`);
  fs.utimesSync(file, at / 1000, at / 1000);
};

beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sessions-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("Codex conversations", () => {
  const a = "019a0000-0000-7000-8000-000000000001";
  const b = "019a0000-0000-7000-8000-000000000002";
  const c = "019a0000-0000-7000-8000-000000000003";

  it("finds the conversation a session started in its worktree, not an older or claimed one", () => {
    const now = Date.now();
    write("old.jsonl", a, "/w/task", now - 60_000);
    write("other.jsonl", b, "/w/elsewhere", now + 500);
    write("mine.jsonl", c, "/w/task", now + 1000);
    expect(findCodexSessionSince("/w/task", now, { root })).toBe(c);
    expect(findCodexSessionSince("/w/task", now, { root, claimed: new Set([c]) })).toBeNull();
  });

  it("resumes a recorded conversation, keeping Pitwall's flags", () => {
    const launch = { command: "codex", args: ["-c", "notify=[]"], display: "codex -c notify=[]" };
    const resumed = applyNativeSessionLaunch(launch, { agent: "Codex", resumeSession: true, nativeSessionId: c }, "/w/task");
    expect(resumed.args).toEqual(["resume", c, "-c", "notify=[]"]);
    expect(resumed.nativeSessionMode).toBe("resume");
    const fresh = applyNativeSessionLaunch(launch, { agent: "Codex", resumeSession: true }, "/w/task");
    expect(fresh.args).toEqual(["-c", "notify=[]"]);
    const firstLaunch = applyNativeSessionLaunch(launch, { agent: "Codex", nativeSessionId: c }, "/w/task");
    expect(firstLaunch.args).toEqual(["-c", "notify=[]"]);
  });
});

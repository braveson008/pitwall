import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import continuityModule from "./continuity.cjs";

const { createContinuity } = continuityModule;

function make(takeResult: { ok: boolean; status?: number; holder?: { name: string } }) {
  const notices: unknown[] = [];
  const continuity = createContinuity({
    userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-continuity-")),
    getSnapshot: () => ({ braveli: { sessions: [{ id: "s1", taskId: "task-1" }], tasks: [{ id: "task-1", title: "Fix" }] } }),
    getEngine: () => null,
    getKeeper: () => ({ take: async () => takeResult, held: () => new Set(), tick: async () => {} }),
    deviceId: () => "me",
    deviceName: () => "Mac",
    runningSessionIds: () => [],
    stopSession: async () => {},
    notify: (notice: unknown) => notices.push(notice),
  });
  return continuity;
}

describe("one computer drives a task at a time", () => {
  it("refuses to start when another computer took the task in the meantime", async () => {
    const gate = await make({ ok: false, status: 409, holder: { name: "PC" } }).beforeAgentStart({ sessionId: "s1", cwd: "/nowhere" });
    expect(gate).toMatchObject({ ok: false, error: expect.stringMatching(/running on PC/) });
  });

  it("still starts offline, when nobody can be asked", async () => {
    expect(await make({ ok: false, status: 0 }).beforeAgentStart({ sessionId: "s1", cwd: "/nowhere" })).toEqual({ ok: true });
  });

  it("starts when the task is free", async () => {
    expect(await make({ ok: true }).beforeAgentStart({ sessionId: "s1", cwd: "/nowhere" })).toEqual({ ok: true });
  });
});

describe("continuing a task", () => {
  function withSavedWork(keeper: Record<string, unknown>) {
    const notices: Array<{ title: string; message: string }> = [];
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-continue-"));
    const continuity = createContinuity({
      userDataPath,
      getSnapshot: () => ({ braveli: { sessions: [], tasks: [{ id: "task-1", title: "Fix" }] } }),
      getEngine: () => ({ syncNow: async () => true }),
      getKeeper: () => keeper,
      deviceId: () => "me",
      deviceName: () => "Mac",
      runningSessionIds: () => [],
      stopSession: async () => {},
      notify: (notice: { title: string; message: string }) => notices.push(notice),
    });
    continuity.applyRemote([{ kind: "wip", localId: "task-1", data: { taskId: "task-1", clean: true, at: new Date(Date.now() - 40 * 60_000).toISOString(), device: "pc", deviceName: "PC", tree: "t" } }]);
    return { continuity, notices };
  }

  it("shows how old the last save is when the other computer's lease had already run out", async () => {
    const { continuity, notices } = withSavedWork({ requestHandoff: async () => ({ ok: true, free: true }), take: async () => ({ ok: true }) });
    const result = await continuity.continueHere("task-1");
    expect(result).toMatchObject({ ok: true, answered: false });
    expect(notices.at(-1)).toMatchObject({ title: expect.stringMatching(/PC/), message: expect.stringMatching(/40 minutes ago/) });
  });

  it("says the other computer didn't answer, with the age, when nothing new arrives while waiting", async () => {
    let tries = 0;
    const { continuity, notices } = withSavedWork({
      requestHandoff: async () => ({ ok: true, holder: { name: "PC" }, expires_at: new Date(Date.now() + 1000).toISOString() }),
      take: async () => ({ ok: (tries += 1) > 1, status: 409 }),
    });
    const result = await continuity.continueHere("task-1");
    expect(result).toMatchObject({ ok: true, answered: false });
    expect(notices.at(-1)).toMatchObject({ title: "PC didn't answer", message: expect.stringMatching(/40 minutes ago/) });
  }, 20_000);
});

import { describe, expect, it } from "vitest";
import { createValidationQueue, worktreeFingerprint } from "./validationQueue.cjs";

function deferred<T = string>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise((done) => setTimeout(done, 0));

describe("validation queue", () => {
  it("runs no more than its concurrency at once", async () => {
    const queue = createValidationQueue({ concurrency: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const results = gates.map((gate, index) => queue.run(`k${index}`, () => { started.push(index); return gate.promise; }));
    await tick();
    expect(started).toEqual([0, 1]);
    gates[0].resolve("a");
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[1].resolve("b");
    gates[2].resolve("c");
    expect(await Promise.all(results)).toEqual(["a", "b", "c"]);
  });

  it("a request for a checkout already waiting joins that run", async () => {
    const queue = createValidationQueue({ concurrency: 1 });
    const first = deferred();
    let runs = 0;
    void queue.run("busy", () => first.promise);
    const a = queue.run("same", async () => { runs += 1; return "fresh"; });
    const b = queue.run("same", async () => { runs += 1; return "duplicate"; });
    first.resolve("x");
    expect(await a).toBe("fresh");
    expect(await b).toBe("fresh");
    expect(runs).toBe(1);
  });

  it("a request for a checkout already running queues one more run after it, not a share of the stale one", async () => {
    const queue = createValidationQueue({ concurrency: 2 });
    const first = deferred();
    let runs = 0;
    const a = queue.run("same", () => { runs += 1; return first.promise; });
    await tick();
    const b = queue.run("same", async () => { runs += 1; return "second"; });
    await tick();
    expect(runs).toBe(1);
    first.resolve("first");
    expect(await a).toBe("first");
    expect(await b).toBe("second");
    expect(runs).toBe(2);
  });

  it("a failing run frees its slot", async () => {
    const queue = createValidationQueue({ concurrency: 1 });
    await expect(queue.run("a", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await queue.run("b", async () => "ok")).toBe("ok");
  });
});

describe("worktree fingerprint", () => {
  const { execFileSync, execFile } = require("node:child_process") as typeof import("node:child_process");
  const { mkdtempSync, writeFileSync, appendFileSync } = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const runGit = (args: string[], cwd: string) => new Promise<{ ok: boolean; stdout: string }>((resolve) => {
    execFile("git", args, { cwd, maxBuffer: 1 << 26 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout) }));
  });
  const repo = () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "fingerprint-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
    git("init", "-q");
    git("config", "user.email", "t@example.invalid");
    git("config", "user.name", "T");
    writeFileSync(path.join(dir, "a.txt"), "one\n");
    git("add", ".");
    git("commit", "-qm", "init");
    return { dir, git };
  };

  it("is stable while nothing changes, and moves with edits, new files and commits", async () => {
    const { dir, git } = repo();
    const first = await worktreeFingerprint(dir, runGit);
    expect(first).toBeTruthy();
    expect(await worktreeFingerprint(dir, runGit)).toBe(first);

    appendFileSync(path.join(dir, "a.txt"), "two\n");
    const edited = await worktreeFingerprint(dir, runGit);
    expect(edited).not.toBe(first);

    writeFileSync(path.join(dir, "new.txt"), "x");
    const added = await worktreeFingerprint(dir, runGit);
    expect(added).not.toBe(edited);

    writeFileSync(path.join(dir, "new.txt"), "xy");
    const grown = await worktreeFingerprint(dir, runGit);
    expect(grown).not.toBe(added);

    git("add", ".");
    git("commit", "-qm", "more");
    const committed = await worktreeFingerprint(dir, runGit);
    expect(committed).not.toBe(grown);
    expect(await worktreeFingerprint(dir, runGit)).toBe(committed);
  });

  it("cannot be told outside a repository", async () => {
    expect(await worktreeFingerprint(mkdtempSync(path.join(os.tmpdir(), "nogit-")), runGit)).toBeNull();
  });
});

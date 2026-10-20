import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import handoff from "./gitHandoff.cjs";

const { bundleWip, restoreWip, snapshotWip } = handoff;

// Git for Windows may check files out with CRLF; the content is what matters.
const read = (file: string) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const temp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pitwall-wip-${name}-`));
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { encoding: "utf8" }).trim();

function setup() {
  const root = temp("root");
  const remote = path.join(root, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const a = path.join(root, "a");
  execFileSync("git", ["clone", "-q", remote, a]);
  fs.writeFileSync(path.join(a, "keep.txt"), "keep\n");
  fs.writeFileSync(path.join(a, "edit.txt"), "before\n");
  fs.writeFileSync(path.join(a, "gone.txt"), "bye\n");
  fs.writeFileSync(path.join(a, ".gitignore"), "node_modules/\n");
  git(a, "add", ".");
  git(a, "commit", "-qm", "init");
  git(a, "checkout", "-qb", "fix-cart");
  git(a, "push", "-q", "-u", "origin", "fix-cart");
  const b = path.join(root, "b");
  execFileSync("git", ["clone", "-q", "-b", "fix-cart", remote, b]);
  return { remote, a, b };
}

/** What the other computer receives: the encrypted bundle's bytes. */
async function carry(from: string, sha: string) {
  const bundle = await bundleWip({ worktree: from, sha });
  expect(bundle.ok).toBe(true);
  return bundle.bytes as Buffer;
}

function workOnA(a: string) {
  fs.writeFileSync(path.join(a, "edit.txt"), "after\n");
  fs.rmSync(path.join(a, "gone.txt"));
  fs.writeFileSync(path.join(a, "new.txt"), "brand new\n");
  fs.mkdirSync(path.join(a, "node_modules"));
  fs.writeFileSync(path.join(a, "node_modules", "big.js"), "ignored");
  fs.writeFileSync(path.join(a, "staged.txt"), "staged\n");
  git(a, "add", "staged.txt");
}

describe("carrying unfinished work", () => {
  it("moves modified, added, deleted and untracked files, touching nothing else and publishing nothing", async () => {
    const { remote, a, b } = setup();
    workOnA(a);
    const headBefore = git(a, "rev-parse", "HEAD");
    const snap = await snapshotWip({ worktree: a });
    expect(snap).toMatchObject({ dirty: true, parent: headBefore, sha: expect.stringMatching(/^[0-9a-f]{40}$/), tree: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(git(a, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(a, "diff", "--cached", "--name-only")).toBe("staged.txt");
    const bytes = await carry(a, snap.sha);
    // Nothing reaches the project's remote: no hidden refs, nothing anyone with access could list.
    expect(execFileSync("git", ["ls-remote", remote], { encoding: "utf8" })).not.toContain("pitwall");
    expect(git(a, "for-each-ref", "refs/pitwall")).toBe("");

    const restored = await restoreWip({ worktree: b, bundle: bytes });
    expect(restored).toMatchObject({ applied: true, conflicts: [] });
    expect(read(path.join(b, "edit.txt"))).toBe("after\n");
    expect(fs.existsSync(path.join(b, "gone.txt"))).toBe(false);
    expect(read(path.join(b, "new.txt"))).toBe("brand new\n");
    expect(read(path.join(b, "staged.txt"))).toBe("staged\n");
    expect(fs.existsSync(path.join(b, "node_modules"))).toBe(false);
    expect(git(b, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(b, "diff", "--cached", "--name-only")).toBe("");
  });

  it("leaves out of the bundle what the remote already has", async () => {
    const { a } = setup();
    fs.writeFileSync(path.join(a, "big.bin"), randomBytes(2 * 1024 * 1024));
    git(a, "add", "big.bin");
    git(a, "commit", "-qm", "big file, pushed");
    git(a, "push", "-q");
    fs.writeFileSync(path.join(a, "edit.txt"), "after\n");
    const snap = await snapshotWip({ worktree: a });
    expect((await carry(a, snap.sha)).length).toBeLessThan(64 * 1024);
  });

  it("brings commits the other computer never pushed along with the changes", async () => {
    const { a, b } = setup();
    fs.writeFileSync(path.join(a, "committed.txt"), "local commit\n");
    git(a, "add", "committed.txt");
    git(a, "commit", "-qm", "not pushed");
    fs.writeFileSync(path.join(a, "edit.txt"), "after\n");
    const snap = await snapshotWip({ worktree: a });
    expect(await restoreWip({ worktree: b, bundle: await carry(a, snap.sha) })).toMatchObject({ applied: true });
    expect(git(b, "log", "-1", "--format=%s")).toBe("not pushed");
    expect(read(path.join(b, "edit.txt"))).toBe("after\n");
  });

  it("reports a conflict and leaves the other checkout as it was", async () => {
    const { a, b } = setup();
    fs.writeFileSync(path.join(a, "edit.txt"), "from A\n");
    const snap = await snapshotWip({ worktree: a });
    const bytes = await carry(a, snap.sha);
    fs.writeFileSync(path.join(b, "edit.txt"), "from B\n");
    git(b, "commit", "-qam", "B changed it too");
    const restored = await restoreWip({ worktree: b, bundle: bytes });
    expect(restored).toMatchObject({ applied: false, conflicts: ["edit.txt"] });
    expect(read(path.join(b, "edit.txt"))).toBe("from B\n");
    expect(git(b, "status", "--porcelain")).toBe("");
  });

  it("refuses to restore over the person's own uncommitted or staged work, and leaves it exactly as it was", async () => {
    const { a, b } = setup();
    fs.writeFileSync(path.join(a, "edit.txt"), "from A\n");
    const snap = await snapshotWip({ worktree: a });
    const bytes = await carry(a, snap.sha);
    fs.writeFileSync(path.join(b, "keep.txt"), "staged on B\n");
    git(b, "add", "keep.txt");
    fs.writeFileSync(path.join(b, "edit.txt"), "unstaged on B\n");
    const restored = await restoreWip({ worktree: b, bundle: bytes });
    expect(restored).toMatchObject({ applied: false, busy: true });
    expect(read(path.join(b, "keep.txt"))).toBe("staged on B\n");
    expect(read(path.join(b, "edit.txt"))).toBe("unstaged on B\n");
    expect(git(b, "diff", "--cached", "--name-only")).toBe("keep.txt");
  });

  it("says when there is nothing to carry", async () => {
    const { a } = setup();
    expect(await snapshotWip({ worktree: a })).toMatchObject({ dirty: false });
  });

  it("carries work as a bundle when there is no remote", async () => {
    const root = temp("bundle");
    const a = path.join(root, "a");
    execFileSync("git", ["init", "-q", "-b", "main", a]);
    fs.writeFileSync(path.join(a, "x.txt"), "1\n");
    git(a, "add", ".");
    git(a, "commit", "-qm", "init");
    // The other computer got the project some other way (copied it); there is no remote to share.
    const b = path.join(root, "b");
    execFileSync("git", ["clone", "-q", a, b]);
    git(b, "remote", "remove", "origin");
    fs.writeFileSync(path.join(a, "x.txt"), "2\n");
    const snap = await snapshotWip({ worktree: a });
    const bytes = await carry(a, snap.sha);
    expect(await restoreWip({ worktree: b, bundle: bytes })).toMatchObject({ applied: true });
    expect(read(path.join(b, "x.txt"))).toBe("2\n");
  });
});

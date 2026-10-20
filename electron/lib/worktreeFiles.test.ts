import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import files from "./worktreeFiles.cjs";

const { listWorktreeFiles, parseStatusZ, readWorktreeFile, resolveInside, worktreeChanges, writeWorktreeFile } = files;

const runGit = async (args: string[], cwd: string) => {
  try {
    return { ok: true, stdout: execFileSync("git", args, { cwd, encoding: "utf8" }), stderr: "" };
  } catch (error) {
    return { ok: false, stdout: "", stderr: String(error) };
  }
};

let temp: string;
let repo: string;

beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-files-"));
  repo = path.join(temp, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  fs.writeFileSync(path.join(repo, ".gitignore"), "dist/\n");
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(repo, "dist"));
  fs.writeFileSync(path.join(repo, "dist", "out.js"), "built");
  fs.writeFileSync(path.join(temp, "secret.txt"), "outside");
});

afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

describe("worktree files", () => {
  it("lists tracked and untracked files without the ignored ones", async () => {
    const result = await listWorktreeFiles(repo, runGit);
    expect(result.files).toEqual([".gitignore", "src/a.ts"]);
  });

  it("refuses paths that leave the worktree, including through a symlink", async () => {
    fs.symlinkSync(path.join(temp, "secret.txt"), path.join(repo, "link.txt"));
    expect(await resolveInside(repo, "../secret.txt")).toBeNull();
    expect(await resolveInside(repo, path.join(temp, "secret.txt"))).toBeNull();
    expect(await resolveInside(repo, "link.txt")).toBeNull();
    expect((await readWorktreeFile(repo, "link.txt")).ok).toBe(false);
    expect((await writeWorktreeFile(repo, "link.txt", "x", "")).ok).toBe(false);
    expect(fs.readFileSync(path.join(temp, "secret.txt"), "utf8")).toBe("outside");
  });

  it("reads text, and declines binary files", async () => {
    const read = await readWorktreeFile(repo, "src/a.ts");
    expect(read).toMatchObject({ ok: true, content: "export const a = 1;\n" });
    fs.writeFileSync(path.join(repo, "img.bin"), Buffer.from([1, 0, 2]));
    expect(await readWorktreeFile(repo, "img.bin")).toMatchObject({ ok: false, binary: true });
  });

  it("saves, but not over a change made since the file was read", async () => {
    const read = await readWorktreeFile(repo, "src/a.ts");
    const saved = await writeWorktreeFile(repo, "src/a.ts", "export const a = 2;\n", read.hash);
    expect(saved.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8")).toBe("export const a = 2;\n");

    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 3;\n");
    const stale = await writeWorktreeFile(repo, "src/a.ts", "export const a = 4;\n", saved.hash);
    expect(stale).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(path.join(repo, "src", "a.ts"), "utf8")).toBe("export const a = 3;\n");
  });

  it("reads changes from git status, renames and untracked files included", async () => {
    expect(parseStatusZ(" M src/a.ts\0R  new.ts\0old.ts\0?? notes.md\0 D gone.ts\0")).toEqual([
      { path: "src/a.ts", kind: "modified" },
      { path: "new.ts", kind: "renamed" },
      { path: "notes.md", kind: "untracked" },
      { path: "gone.ts", kind: "deleted" },
    ]);
    const live = await worktreeChanges(repo, process.env);
    expect(live.changes).toEqual(expect.arrayContaining([{ path: "src/a.ts", kind: "untracked" }]));
  });

  it("leaves out council files, under the current folder and the one older versions wrote", () => {
    expect(parseStatusZ("?? .pitwall/council/r1/thread.md\0?? .braveli/council/r0/thread.md\0?? .pitwallish\0 M src/a.ts\0")).toEqual([
      { path: ".pitwallish", kind: "untracked" },
      { path: "src/a.ts", kind: "modified" },
    ]);
  });
});

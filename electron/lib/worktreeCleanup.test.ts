import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/** Paths compared in one spelling: Windows answers with backslashes. */
const posixPath = (value: string) => value.split(path.sep).join("/");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  cloneCommand,
  findNodeModules,
  lockfilesMatch,
  managedWorktreeOwner,
  newestChange,
  reclaimIdleDependencies,
  removalBlockers,
  removeWorktreeIfSafe,
  selectForRetention,
  worktreeInUse,
} = require("./worktreeCleanup.cjs");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { managedWorktreePath } = require("./worktrees.cjs");

const DAY = 24 * 60 * 60 * 1000;
const roots: string[] = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-cleanup-"));
  roots.push(dir);
  return dir;
}

function write(file: string, content = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function age(target: string, ms: number) {
  const when = new Date(Date.now() - ms);
  fs.utimesSync(target, when, when);
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("removalBlockers", () => {
  it("keeps a worktree for each of live, dirty and unpushed", () => {
    expect(removalBlockers({ live: true, dirty: 0, unpushed: 0 })).toEqual(["live"]);
    expect(removalBlockers({ live: false, dirty: 2, unpushed: 0 })).toEqual(["dirty"]);
    expect(removalBlockers({ live: false, dirty: 0, unpushed: 1 })).toEqual(["unpushed"]);
    expect(removalBlockers({ live: true, dirty: 1, unpushed: 1 })).toEqual(["live", "dirty", "unpushed"]);
  });

  it("lets a clean, pushed, idle worktree go", () => {
    expect(removalBlockers({ live: false, dirty: 0, unpushed: 0 })).toEqual([]);
  });
});

describe("worktreeInUse", () => {
  const worktree = "/data/worktrees/abc/feature";

  it("counts a terminal in the worktree or below it", () => {
    expect(worktreeInUse(worktree, [worktree])).toBe(true);
    expect(worktreeInUse(worktree, [`${worktree}/apps/web`])).toBe(true);
  });

  it("does not count a sibling whose name shares a prefix, or the project itself", () => {
    expect(worktreeInUse(worktree, ["/data/worktrees/abc/feature-2", "/repo"])).toBe(false);
    expect(worktreeInUse(worktree, ["", undefined])).toBe(false);
  });
});

describe("removeWorktreeIfSafe", () => {
  const git = (answers: Record<string, { ok: boolean; stdout?: string; stderr?: string }>) => {
    const calls: string[][] = [];
    const runGit = async (args: string[]) => {
      calls.push(args);
      return { stdout: "", stderr: "", ...(answers[args[0]] ?? { ok: true }) };
    };
    return { calls, runGit };
  };

  it("never runs git worktree remove for dirty, unpushed or live work", async () => {
    for (const [answers, live, blocker] of [
      [{ status: { ok: true, stdout: " M src/a.ts\n?? new.ts\n" } }, false, "dirty"],
      [{ log: { ok: true, stdout: "abc123\n" } }, false, "unpushed"],
      [{}, true, "live"],
    ] as const) {
      const { calls, runGit } = git(answers);
      const result = await removeWorktreeIfSafe({ runGit, projectRoot: "/repo", worktreePath: "/wt/x", isLive: () => live });
      expect(result.removed).toBe(false);
      expect(result.blockers).toContain(blocker);
      expect(calls.some((args) => args[0] === "worktree")).toBe(false);
    }
  });

  it("removes a clean, pushed worktree without --force and reports its branch", async () => {
    const { calls, runGit } = git({ "rev-parse": { ok: true, stdout: "agent/renamed\n" } });
    const result = await removeWorktreeIfSafe({ runGit, projectRoot: "/repo", worktreePath: "/wt/x", isLive: () => false });
    expect(result).toMatchObject({ ok: true, removed: true, branch: "agent/renamed" });
    expect(calls.find((args) => args[0] === "worktree")).toEqual(["worktree", "remove", "/wt/x"]);
  });

  it("keeps the worktree when git cannot answer", async () => {
    const { calls, runGit } = git({ status: { ok: false, stderr: "fatal: not a git repository" } });
    const result = await removeWorktreeIfSafe({ runGit, projectRoot: "/repo", worktreePath: "/wt/x", isLive: () => false });
    expect(result).toMatchObject({ ok: false, removed: false });
    expect(calls.some((args) => args[0] === "worktree")).toBe(false);
  });
});

describe("lockfilesMatch", () => {
  it("shares only when every lockfile is byte-identical", async () => {
    const primary = tempDir();
    const worktree = tempDir();
    write(path.join(primary, "package-lock.json"), "{\"a\":1}");
    write(path.join(worktree, "package-lock.json"), "{\"a\":1}");
    expect(await lockfilesMatch(primary, worktree)).toBe(true);

    write(path.join(worktree, "package-lock.json"), "{\"a\":1}\n");
    expect(await lockfilesMatch(primary, worktree)).toBe(false);
  });

  it("does not share when one side has a lockfile the other lacks", async () => {
    const primary = tempDir();
    const worktree = tempDir();
    write(path.join(primary, "pnpm-lock.yaml"), "lock");
    write(path.join(worktree, "pnpm-lock.yaml"), "lock");
    write(path.join(worktree, "yarn.lock"), "extra");
    expect(await lockfilesMatch(primary, worktree)).toBe(false);
  });

  it("does not share without any lockfile at all", async () => {
    expect(await lockfilesMatch(tempDir(), tempDir())).toBe(false);
  });
});

describe("findNodeModules", () => {
  it("finds the root and workspace node_modules without descending into any", async () => {
    const root = tempDir();
    write(path.join(root, "node_modules/a/node_modules/b/index.js"));
    write(path.join(root, "apps/web/node_modules/c/index.js"));
    write(path.join(root, "packages/ui/node_modules/d/index.js"));
    write(path.join(root, ".cache/node_modules/e/index.js"));
    expect((await findNodeModules(root)).map(posixPath)).toEqual(["node_modules", "apps/web/node_modules", "packages/ui/node_modules"]);
  });

  it("stops at its depth bound", async () => {
    const root = tempDir();
    write(path.join(root, "a/b/c/d/e/node_modules/x.js"));
    expect(await findNodeModules(root, { maxDepth: 3 })).toEqual([]);
  });
});

describe("cloneCommand", () => {
  it("clones on macOS, reflinks on Linux and does nothing on Windows", () => {
    expect(cloneCommand("darwin", "/a", "/b")).toEqual({ file: "cp", args: ["-c", "-R", "/a", "/b"] });
    expect(cloneCommand("linux", "/a", "/b")).toEqual({ file: "cp", args: ["--reflink=auto", "-a", "/a", "/b"] });
    expect(cloneCommand("win32", "/a", "/b")).toBeNull();
  });
});

describe("selectForRetention", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const worktree = (over: object) => ({ path: "/wt/x", live: false, nodeModules: ["node_modules"], newestChange: now - 8 * DAY, ...over });

  it("selects an idle worktree untouched for over a week", () => {
    expect(selectForRetention([worktree({})], { now })).toHaveLength(1);
  });

  it("keeps a live one, a recent one, one with nothing to reclaim, and one whose age is unknown", () => {
    expect(selectForRetention([
      worktree({ live: true }),
      worktree({ newestChange: now - 6 * DAY }),
      worktree({ nodeModules: [] }),
      worktree({ newestChange: Number.NaN }),
    ], { now })).toEqual([]);
  });
});

describe("newestChange", () => {
  it("ignores node_modules when dating a worktree", async () => {
    const root = tempDir();
    write(path.join(root, "src/a.ts"));
    write(path.join(root, "node_modules/x/index.js"));
    age(path.join(root, "src/a.ts"), 10 * DAY);
    const newest = await newestChange(root);
    expect(Date.now() - newest).toBeGreaterThan(9 * DAY);
  });
});

describe("managed worktrees on disk", () => {
  function managedWorktree(userData: string, primary: string, branch: string) {
    const worktree = managedWorktreePath(userData, primary, branch);
    fs.mkdirSync(path.join(primary, ".git", "worktrees", branch), { recursive: true });
    write(path.join(worktree, ".git"), `gitdir: ${path.join(primary, ".git", "worktrees", branch)}\n`);
    return worktree;
  }

  it("recognises a worktree only when its .git points at the project its directory is named for", async () => {
    const userData = tempDir();
    const primary = tempDir();
    const worktree = managedWorktree(userData, primary, "feature");
    expect(await managedWorktreeOwner(userData, worktree)).toBe(primary);

    const other = tempDir();
    write(path.join(worktree, ".git"), `gitdir: ${path.join(other, ".git", "worktrees", "feature")}\n`);
    expect(await managedWorktreeOwner(userData, worktree)).toBe("");
  });

  it("reclaims node_modules from an idle worktree and nothing else", async () => {
    const userData = tempDir();
    const primary = tempDir();
    write(path.join(primary, "node_modules/p/index.js"));
    const idle = managedWorktree(userData, primary, "idle");
    const recent = managedWorktree(userData, primary, "recent");
    const live = managedWorktree(userData, primary, "live");
    for (const worktree of [idle, recent, live]) {
      write(path.join(worktree, "src/a.ts"));
      write(path.join(worktree, "node_modules/x/index.js"));
      write(path.join(worktree, "apps/web/node_modules/y/index.js"));
      write(path.join(worktree, "apps/web/package.json"));
    }
    for (const worktree of [idle, live]) {
      for (const file of ["src/a.ts", "apps/web/package.json", ".git"]) age(path.join(worktree, file), 8 * DAY);
    }
    // A symlinked node_modules is never followed into what it points at.
    const outside = tempDir();
    write(path.join(outside, "node_modules/keep.js"));
    fs.symlinkSync(outside, path.join(idle, "packages-link"));
    const old = new Date(Date.now() - 8 * DAY);
    fs.lutimesSync(path.join(idle, "packages-link"), old, old);
    // Nor is anything outside userData/worktrees touched.
    write(path.join(userData, "elsewhere/node_modules/z.js"));

    const result = await reclaimIdleDependencies({ userDataPath: userData, isLive: (target: string) => target === live });
    expect(result.reclaimed.map((item: { path: string }) => posixPath(path.relative(idle, item.path))).sort())
      .toEqual(["apps/web/node_modules", "node_modules"]);
    expect(fs.existsSync(path.join(idle, "src/a.ts"))).toBe(true);
    expect(fs.existsSync(path.join(recent, "node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(live, "node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(primary, "node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(outside, "node_modules/keep.js"))).toBe(true);
    expect(fs.existsSync(path.join(userData, "elsewhere/node_modules/z.js"))).toBe(true);
  });
});

describe("maintenance after a project moves", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require("node:child_process");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { maintainWorktrees, reclaimDerivedData } = require("./worktreeCleanup.cjs");

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  const runGit = async (args: string[], cwd: string) => {
    try {
      return { ok: true, stdout: git(cwd, ...args), stderr: "" };
    } catch (error) {
      return { ok: false, stdout: "", stderr: String((error as { stderr?: string }).stderr || error) };
    }
  };
  const ageTree = (root: string, ms: number) => {
    const when = new Date(Date.now() - ms);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        fs.utimesSync(full, when, when);
      }
    };
    walk(root);
  };

  function movedProject() {
    const userData = tempDir();
    const remote = tempDir();
    git(remote, "init", "--bare", "-q");
    const before = path.join(tempDir(), "app");
    fs.mkdirSync(before);
    git(before, "init", "-q");
    write(path.join(before, "a.txt"));
    write(path.join(before, ".gitignore"), "node_modules\n");
    git(before, "add", ".");
    git(before, "commit", "-qm", "init");
    git(before, "remote", "add", "origin", remote);
    git(before, "push", "-q", "origin", "main");
    const pushed = managedWorktreePath(userData, before, "pushed");
    const dirty = managedWorktreePath(userData, before, "dirty");
    for (const [worktree, branch] of [[pushed, "pushed"], [dirty, "dirty"]]) {
      git(before, "worktree", "add", "-q", "-b", branch, worktree);
      git(worktree, "push", "-q", "origin", branch);
      write(path.join(worktree, "node_modules/x/index.js"));
    }
    write(path.join(dirty, "a.txt"), "changed");
    const after = path.join(tempDir(), "moved-app");
    fs.renameSync(before, after);
    ageTree(pushed, 8 * DAY);
    ageTree(dirty, 8 * DAY);
    return { userData, after, pushed, dirty };
  }

  it("relinks, removes the clean pushed worktree and slims the one holding work", async () => {
    const { userData, after, pushed, dirty } = movedProject();
    expect(await managedWorktreeOwner(userData, pushed)).toBe("");

    const result = await maintainWorktrees({ userDataPath: userData, projectPaths: [after], runGit, isLive: () => false });

    expect(result.removed.map((item: string) => path.basename(item))).toEqual(["pushed"]);
    expect(fs.existsSync(pushed)).toBe(false);
    expect(git(after, "branch", "--list", "pushed").trim()).toContain("pushed");
    expect(fs.readFileSync(path.join(dirty, "a.txt"), "utf8")).toBe("changed");
    expect(fs.existsSync(path.join(dirty, "node_modules"))).toBe(false);
    expect(await managedWorktreeOwner(userData, dirty)).toBe(fs.realpathSync(after));
  });

  it("leaves live and recently touched worktrees alone", async () => {
    const { userData, after, pushed, dirty } = movedProject();
    write(path.join(dirty, "fresh.txt"));
    const result = await maintainWorktrees({ userDataPath: userData, projectPaths: [after], runGit, isLive: (target: string) => target === pushed });
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(path.join(pushed, "node_modules"))).toBe(true);
    expect(fs.existsSync(path.join(dirty, "node_modules"))).toBe(true);
  });

  it("does not adopt a worktree whose project does not point back at it", async () => {
    const userData = tempDir();
    const primary = tempDir();
    const worktree = path.join(userData, "worktrees", "0000000000000000", "stray");
    fs.mkdirSync(path.join(primary, ".git", "worktrees", "stray"), { recursive: true });
    write(path.join(primary, ".git", "worktrees", "stray", "gitdir"), path.join(tempDir(), ".git"));
    write(path.join(worktree, ".git"), `gitdir: ${path.join(primary, ".git", "worktrees", "stray")}\n`);
    expect(await managedWorktreeOwner(userData, worktree)).toBe("");
  });

  it("drops DerivedData only for managed worktrees that are gone or idle", async () => {
    const userData = tempDir();
    const derived = tempDir();
    const live = path.join(userData, "worktrees", "k", "live");
    const idle = path.join(userData, "worktrees", "k", "idle");
    const recent = path.join(userData, "worktrees", "k", "recent");
    for (const worktree of [live, idle, recent]) fs.mkdirSync(worktree, { recursive: true });
    const workspaces: Record<string, string> = {
      Gone: path.join(userData, "worktrees", "k", "gone"),
      Idle: idle,
      Recent: recent,
      Live: live,
      Mine: path.join(tempDir(), "MyApp"),
    };
    for (const name of Object.keys(workspaces)) write(path.join(derived, name, "info.plist"));
    for (const name of ["Idle", "Live", "Mine"]) age(path.join(derived, name), 8 * DAY);

    const result = await reclaimDerivedData({
      userDataPath: userData,
      derivedDataPath: derived,
      isLive: (target: string) => target === live,
      readWorkspacePath: async (file: string) => workspaces[path.basename(path.dirname(file))],
    });
    expect(result.reclaimed.map((item: { path: string }) => path.basename(item.path)).sort()).toEqual(["Gone", "Idle"]);
    expect(fs.readdirSync(derived).sort()).toEqual(["Live", "Mine", "Recent"]);
  });
});

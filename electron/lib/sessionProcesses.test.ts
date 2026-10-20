import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  parseProcessList,
  parseWorkingDirectories,
  selectOrphanedProcesses,
  selectSessionProcesses,
  terminateOrphanedProcesses,
  terminateSessionProcesses,
  parseWindowsProcesses,
  selectWindowsOrphans,
} = require("./sessionProcesses.cjs");

const WORKTREE = "/Users/me/Library/Application Support/pitwall/worktrees/abc/sched-1";

describe("parseProcessList", () => {
  it("reads the session marker out of ps's environment column", () => {
    const output = [
      `  3606 node ${WORKTREE}/node_modules/.bin/vite --port 8177 PITWALL_SESSION_NAME=Check if staging · Implementer PITWALL_SESSION_ID=claude-p-1-x PATH=/usr/bin`,
      "  3568 npm run dev --port 8177",
      "   901 /bin/zsh -l",
    ].join("\n");
    expect(parseProcessList(output)).toEqual([{ pid: 3606, sessionId: "claude-p-1-x" }]);
  });

  it("still finds processes a session of an older version left behind", () => {
    const output = `  4100 node ${WORKTREE}/node_modules/.bin/vite BRAVELI_SESSION_ID=claude-p-0-old PATH=/usr/bin`;
    expect(parseProcessList(output)).toEqual([{ pid: 4100, sessionId: "claude-p-0-old" }]);
  });
});

describe("parseWorkingDirectories", () => {
  it("pairs each pid with its cwd, spaces included", () => {
    expect(parseWorkingDirectories(`p3606\nfcwd\nn${WORKTREE}\np3609\nfcwd\nn/tmp\n`)).toEqual(
      new Map([[3606, WORKTREE], [3609, "/tmp"]]),
    );
  });
});

describe("selectSessionProcesses", () => {
  const processes = [
    { pid: 1, sessionId: "s1", cwd: WORKTREE },
    { pid: 2, sessionId: "s1", cwd: `${WORKTREE}/apps/voy` },
    // A Claude daemon started from the session: same marker, shared, runs from home.
    { pid: 3, sessionId: "s1", cwd: "/Users/me" },
    // A council member sharing the worktree is its own session.
    { pid: 4, sessionId: "s2", cwd: WORKTREE },
    // A sibling whose name only starts the same way.
    { pid: 5, sessionId: "s1", cwd: `${WORKTREE}-2` },
    { pid: 6, sessionId: "s1", cwd: "" },
  ];

  it("takes only this session's processes inside its own workspace", () => {
    expect(selectSessionProcesses(processes, { sessionId: "s1", root: WORKTREE, homeDir: "/Users/me" })).toEqual([1, 2]);
  });

  it("never selects its own process", () => {
    expect(selectSessionProcesses(processes, { sessionId: "s1", root: WORKTREE, exclude: [1], homeDir: "/Users/me" })).toEqual([2]);
  });

  it("treats a root that contains everything as no evidence at all", () => {
    for (const root of ["/", "/Users/me", "", "relative/path"]) {
      expect(selectSessionProcesses(processes, { sessionId: "s1", root, homeDir: "/Users/me" })).toEqual([]);
    }
    expect(selectSessionProcesses(processes, { sessionId: "", root: WORKTREE, homeDir: "/Users/me" })).toEqual([]);
  });
});

describe("terminateSessionProcesses", () => {
  const children: number[] = [];
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };
  afterEach(() => {
    for (const pid of children.splice(0)) {
      try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    }
  });

  it("does nothing once the session has a terminal again", async () => {
    const result = await terminateSessionProcesses(
      { sessionId: "s1", root: WORKTREE },
      { listProcesses: async () => [{ pid: 999_999, sessionId: "s1", cwd: WORKTREE }], ended: () => false },
    );
    expect(result.pids).toEqual([]);
  });

  it.runIf(process.platform === "darwin" || process.platform === "linux")(
    "ends a detached process the session left in its workspace, and nothing else",
    async () => {
      const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-session-")));
      const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-elsewhere-")));
      const sessionId = `test-session-${process.pid}-${Date.now()}`;
      // Detached the way an agent's tool shell is: its own session, no terminal.
      // Node rather than /bin/sleep: macOS does not show a platform binary's environment.
      const start = (cwd: string, id: string) => {
        const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
          cwd, detached: true, stdio: "ignore", env: { ...process.env, PITWALL_SESSION_ID: id },
        });
        child.unref();
        children.push(child.pid!);
        return child.pid!;
      };
      const leaked = start(workspace, sessionId);
      const outside = start(elsewhere, sessionId);
      const otherSession = start(workspace, `${sessionId}-other`);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const result = await terminateSessionProcesses({ sessionId, root: workspace }, { graceMs: 3000 });
      expect(result.pids).toEqual([leaked]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(alive(leaked)).toBe(false);
      expect(alive(outside)).toBe(true);
      expect(alive(otherSession)).toBe(true);
    },
    15_000,
  );
});

describe("selectOrphanedProcesses", () => {
  const ROOT = "/Users/me/Library/Application Support/pitwall/worktrees";
  const processes = [
    { pid: 1, sessionId: "a", cwd: `${ROOT}/abc/sched-1` },
    { pid: 2, sessionId: "b", cwd: `${ROOT}/abc/sched-2/apps/voy` },
    { pid: 3, sessionId: "a", cwd: "/Users/me" },
    { pid: 4, sessionId: "c", cwd: ROOT },
    { pid: 5, sessionId: "d", cwd: "" },
  ];

  it("selects marked processes inside the worktrees whose session has no terminal", () => {
    expect(selectOrphanedProcesses(processes, { root: ROOT })).toEqual([1, 2]);
    expect(selectOrphanedProcesses(processes, { root: ROOT, isLive: (id: string) => id === "b" })).toEqual([1]);
    expect(selectOrphanedProcesses(processes, { root: ROOT, exclude: [1] })).toEqual([2]);
  });

  it("selects nothing without an absolute root", () => {
    expect(selectOrphanedProcesses(processes, { root: "" })).toEqual([]);
    expect(selectOrphanedProcesses(processes, { root: "worktrees" })).toEqual([]);
  });
});

describe("Windows orphans", () => {
  const root = "C:\\Users\\me\\AppData\\Local\\Pitwall\\worktrees";
  const rows = (items: object[]) => JSON.stringify(items);

  it("reads both PowerShell date formats, and a single row", () => {
    expect(parseWindowsProcesses(rows([{ ProcessId: 1, ParentProcessId: 0, CreationDate: "/Date(1500)/", CommandLine: null }])))
      .toEqual([{ pid: 1, ppid: 0, startedAt: 1500, commandLine: "", executable: "" }]);
    expect(parseWindowsProcesses(JSON.stringify({ ProcessId: 2, ParentProcessId: 1, CreationDate: "2026-10-12T05:00:00Z" }))[0].startedAt)
      .toBe(Date.parse("2026-10-12T05:00:00Z"));
    expect(parseWindowsProcesses("not json")).toEqual([]);
  });

  it("takes worktree processes whose parent is gone or was reused, nothing else", () => {
    const list = parseWindowsProcesses(rows([
      // Parent gone: a dev server left by a crash.
      { ProcessId: 10, ParentProcessId: 4, CreationDate: "/Date(1000)/", CommandLine: `node ${root}\\a\\s1\\node_modules\\.bin\\vite` },
      // Parent alive (a live agent): never touched, forward slashes or not.
      { ProcessId: 11, ParentProcessId: 12, CreationDate: "/Date(1000)/", CommandLine: "node C:/Users/me/AppData/Local/Pitwall/worktrees/a/s2/x.js" },
      { ProcessId: 12, ParentProcessId: 1, CreationDate: "/Date(500)/", CommandLine: "claude.exe" },
      // The parent's id now belongs to a newer process.
      { ProcessId: 13, ParentProcessId: 14, CreationDate: "/Date(1000)/", CommandLine: `node ${root}\\b\\y.js` },
      { ProcessId: 14, ParentProcessId: 1, CreationDate: "/Date(2000)/", CommandLine: "something else" },
      // Outside the worktrees, and a sibling folder whose name only starts the same.
      { ProcessId: 15, ParentProcessId: 99, CreationDate: "/Date(1000)/", CommandLine: "node C:\\elsewhere\\z.js" },
      { ProcessId: 16, ParentProcessId: 99, CreationDate: "/Date(1000)/", CommandLine: `node ${root}-old\\z.js` },
    ]));
    expect(selectWindowsOrphans(list, { root })).toEqual([10, 13]);
    expect(selectWindowsOrphans(list, { root, exclude: [10] })).toEqual([13]);
  });

  it("ends each one's whole tree with taskkill", async () => {
    const killed: number[] = [];
    const result = await terminateOrphanedProcesses({ root }, {
      platform: "win32",
      listWindowsProcesses: async () => [{ pid: 7, ppid: 3, startedAt: 1, commandLine: `${root}\\p\\dev.js`, executable: "" }],
      taskkill: async (pid: number) => { killed.push(pid); },
    });
    expect(result).toEqual({ ok: true, pids: [7] });
    expect(killed).toEqual([7]);
  });
});

describe("terminateOrphanedProcesses", () => {
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  // Reads the environment and cwd of other processes, which Windows does not expose.
  it.skipIf(process.platform === "win32")(
    "ends what a crashed run left in the worktrees and spares live sessions and everything outside",
    async () => {
      const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-worktrees-")));
      const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-elsewhere-")));
      fs.mkdirSync(path.join(root, "p", "s1"), { recursive: true });
      const tag = `orphan-${process.pid}-${Date.now()}`;
      const started: number[] = [];
      const start = (cwd: string, id: string) => {
        const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
          cwd, detached: true, stdio: "ignore", env: { ...process.env, PITWALL_SESSION_ID: id },
        });
        child.unref();
        started.push(child.pid!);
        return child.pid!;
      };
      try {
        const orphan = start(path.join(root, "p", "s1"), `${tag}-dead`);
        const live = start(path.join(root, "p", "s1"), `${tag}-live`);
        const outside = start(elsewhere, `${tag}-dead`);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const ours = new Set(started);
        const { listMarkedProcesses } = require("./sessionProcesses.cjs");
        const result = await terminateOrphanedProcesses(
          { root, isLive: (id: string) => id === `${tag}-live` },
          { graceMs: 3000, listProcesses: async () => (await listMarkedProcesses()).filter((item: { pid: number }) => ours.has(item.pid)) },
        );
        expect(result.pids).toEqual([orphan]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(alive(orphan)).toBe(false);
        expect(alive(live)).toBe(true);
        expect(alive(outside)).toBe(true);
      } finally {
        for (const pid of started) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
      }
    },
    15_000,
  );
});

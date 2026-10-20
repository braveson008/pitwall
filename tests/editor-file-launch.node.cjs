const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { buildFileLaunch } = require("../electron/lib/editors.cjs");

const cli = (id) => ({ id, name: id, cliPath: `/usr/local/bin/${id}`, appPath: null });
const appOnly = (id) => ({ id, name: id, cliPath: null, appPath: `/Applications/${id}.app` });

describe("buildFileLaunch", () => {
  it("opens the file at the line for editors that take path:line", () => {
    assert.deepEqual(buildFileLaunch(cli("vscode"), "/repo/src/a.ts", 42), {
      command: "/usr/local/bin/vscode",
      args: ["-g", "/repo/src/a.ts:42"],
    });
    assert.deepEqual(buildFileLaunch(cli("zed"), "/repo/src/a.ts", 42), {
      command: "/usr/local/bin/zed",
      args: ["/repo/src/a.ts:42"],
    });
  });

  it("uses a separate argument where the editor wants one", () => {
    assert.deepEqual(buildFileLaunch(cli("webstorm"), "/repo/src/a.ts", 42), {
      command: "/usr/local/bin/webstorm",
      args: ["--line", "42", "/repo/src/a.ts"],
    });
  });

  it("still opens the file for an editor with no line syntax", () => {
    assert.deepEqual(buildFileLaunch(cli("nova"), "/repo/src/a.ts", 42), {
      command: "/usr/local/bin/nova",
      args: ["/repo/src/a.ts"],
    });
  });

  it("ignores a line that is not a usable one", () => {
    for (const line of [0, -3, NaN, undefined, null]) {
      assert.deepEqual(buildFileLaunch(cli("vscode"), "/repo/a.ts", line).args, ["/repo/a.ts"]);
    }
  });

  it("falls back to open(1) when there is no CLI, losing the line but not the file", () => {
    assert.deepEqual(buildFileLaunch(appOnly("xcode"), "/repo/a.ts", 42), {
      command: "/usr/bin/open",
      args: ["-a", "/Applications/xcode.app", "/repo/a.ts"],
    });
  });

  it("returns nothing when it has nothing to work with", () => {
    assert.equal(buildFileLaunch(null, "/repo/a.ts", 1), null);
    assert.equal(buildFileLaunch(cli("vscode"), "", 1), null);
    assert.equal(buildFileLaunch({ id: "x", name: "x", cliPath: null, appPath: null }, "/a.ts", 1), null);
  });

  it("keeps a path containing spaces intact rather than quoting it", () => {
    // execFile takes an argv array, so quoting here would put literal quotes in
    // the filename.
    assert.deepEqual(buildFileLaunch(cli("vscode"), "/repo/my file.ts", 3).args, [
      "-g",
      "/repo/my file.ts:3",
    ]);
  });
});

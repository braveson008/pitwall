import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { KNOWN_EDITORS, buildEditorLaunch, detectEditors, resolveEditor } = require("./editors.cjs");

const APP_DIRS = ["/Applications", "/Users/dev/Applications"];
const PATH_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];

/** Detection against a machine described as a set of paths that exist. */
const machine = (...installed: string[]) => {
  const present = new Set(installed);
  return detectEditors({ appDirs: APP_DIRS, pathDirs: PATH_DIRS, exists: (p: string) => present.has(p) });
};

// These describe a Mac: application bundles and POSIX paths.
describe.skipIf(process.platform === "win32")("detectEditors", () => {
  it("finds an editor installed as an application bundle", () => {
    const found = machine("/Applications/Visual Studio Code.app");
    expect(found).toEqual([
      { id: "vscode", name: "Visual Studio Code", cliPath: null, appPath: "/Applications/Visual Studio Code.app" },
    ]);
  });

  it("finds one installed only as a command line tool", () => {
    const found = machine("/opt/homebrew/bin/zed");
    expect(found).toEqual([{ id: "zed", name: "Zed", cliPath: "/opt/homebrew/bin/zed", appPath: null }]);
  });

  it("reports both when the app ships its command line tool", () => {
    const found = machine("/Applications/Cursor.app", "/usr/local/bin/cursor");
    expect(found[0]).toMatchObject({ id: "cursor", cliPath: "/usr/local/bin/cursor", appPath: "/Applications/Cursor.app" });
  });

  it("looks in the user's own Applications folder too", () => {
    expect(machine("/Users/dev/Applications/Sublime Text.app")[0]?.id).toBe("sublime");
  });

  it("returns nothing on a machine with no editor at all", () => {
    expect(machine()).toEqual([]);
  });

  it("offers Xcode last — it is installed everywhere and is nobody's project editor", () => {
    const found = machine("/Applications/Xcode.app", "/Applications/Visual Studio Code.app");
    expect(found.map((editor: { id: string }) => editor.id)).toEqual(["vscode", "xcode"]);
  });

  it("has no editor without a way to launch it", () => {
    for (const editor of KNOWN_EDITORS) {
      expect(Boolean(editor.app || editor.cli)).toBe(true);
    }
  });
});

describe.skipIf(process.platform === "win32")("buildEditorLaunch", () => {
  const project = "/Users/dev/Projects/my app";

  it("prefers the editor's own launcher, which opens the folder as a workspace", () => {
    const editor = { id: "vscode", name: "VS Code", cliPath: "/usr/local/bin/code", appPath: "/Applications/x.app" };
    expect(buildEditorLaunch(editor, project)).toEqual({ command: "/usr/local/bin/code", args: [project] });
  });

  it("falls back to opening the application when there is no CLI", () => {
    const editor = { id: "xcode", name: "Xcode", cliPath: null, appPath: "/Applications/Xcode.app" };
    expect(buildEditorLaunch(editor, project)).toEqual({
      command: "/usr/bin/open",
      args: ["-a", "/Applications/Xcode.app", project],
    });
  });

  it("passes the path as an argument, never as shell text", () => {
    // A project path with a space in it is ordinary, and a launch built by
    // string concatenation would open two folders that do not exist.
    const launch = buildEditorLaunch({ id: "zed", cliPath: "/opt/homebrew/bin/zed", appPath: null }, project);
    expect(launch?.args).toEqual([project]);
  });

  it("has nothing to run without an editor or a project", () => {
    expect(buildEditorLaunch(null, project)).toBeNull();
    expect(buildEditorLaunch({ id: "zed", cliPath: "/bin/zed", appPath: null }, "")).toBeNull();
    expect(buildEditorLaunch({ id: "ghost", cliPath: null, appPath: null }, project)).toBeNull();
  });
});

describe("resolveEditor", () => {
  const editors = [
    { id: "vscode", name: "Visual Studio Code", cliPath: null, appPath: "/Applications/Visual Studio Code.app" },
    { id: "zed", name: "Zed", cliPath: "/opt/homebrew/bin/zed", appPath: null },
  ];

  it("uses the editor the user chose", () => {
    expect(resolveEditor(editors, "zed")?.id).toBe("zed");
  });

  it("falls back to the best available when the chosen one is gone", () => {
    // An uninstalled preference must not leave the Open button doing nothing.
    expect(resolveEditor(editors, "sublime")?.id).toBe("vscode");
    expect(resolveEditor(editors, undefined)?.id).toBe("vscode");
  });

  it("resolves to nothing when no editor is installed", () => {
    expect(resolveEditor([], "vscode")).toBeNull();
  });
});

describe("on Windows", () => {
  const original = process.platform;
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: original, configurable: true });
    for (const name of ["./editors.cjs", "./platform.cjs"]) delete require.cache[require.resolve(name)];
  });

  // Loaded fresh against win32: both modules read the platform once, at load,
  // and this file's top-level require has the host's copies cached.
  function freshRequire() {
    for (const name of ["./editors.cjs", "./platform.cjs"]) delete require.cache[require.resolve(name)];
  }

  async function windowsEditors() {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    freshRequire();
    return require("./editors.cjs");
  }

  it("finds an editor by its program under Programs, and launches that program directly", async () => {
    const editors = await windowsEditors();
    const programs = path.join("C:", "Users", "me", "AppData", "Local", "Programs");
    const exe = path.join(programs, "Microsoft VS Code\\Code.exe");
    const found = editors.detectEditors({ appDirs: [programs], pathDirs: [], exists: (p: string) => p === exe });
    expect(found).toEqual([{ id: "vscode", name: "Visual Studio Code", cliPath: null, appPath: exe }]);
    // The program takes the folder itself; the caller wraps nothing for an .exe.
    expect(editors.buildEditorLaunch(found[0], "C:\\work\\my app")).toEqual({ command: exe, args: ["C:\\work\\my app"] });
  });

  it("prefers the .cmd launcher on PATH, and leaves wrapping it in cmd to the caller", async () => {
    const editors = await windowsEditors();
    const bin = path.join("C:", "code", "bin");
    const cmd = path.join(bin, "code.cmd");
    const found = editors.detectEditors({ appDirs: [], pathDirs: [bin], exists: (p: string) => p === cmd });
    expect(found[0]).toMatchObject({ id: "vscode", cliPath: cmd });
    expect(editors.buildEditorLaunch(found[0], "C:\\p")).toEqual({ command: cmd, args: ["C:\\p"] });
  });

  it("opens a file at a line through the program when there is no launcher", async () => {
    const editors = await windowsEditors();
    const exe = "C:\\Programs\\cursor\\Cursor.exe";
    const launch = editors.buildFileLaunch({ id: "cursor", cliPath: null, appPath: exe }, "C:\\p\\a.ts", 12);
    expect(launch).toEqual({ command: exe, args: ["-g", "C:\\p\\a.ts:12"] });
  });
});

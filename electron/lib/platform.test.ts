import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Both branches are exercised from whichever machine runs the suite, by loading
 * the module against a stated platform. Testing only the host's branch would
 * mean the Windows half is never run until someone is on Windows — which is the
 * one place a mistake in it cannot be caught cheaply.
 */
const original = process.platform;

async function loadFor(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  vi.resetModules();
  // @ts-expect-error - CommonJS module without types
  return import("./platform.cjs");
}

afterEach(() => {
  Object.defineProperty(process, "platform", { value: original, configurable: true });
  vi.resetModules();
});

describe("shellInvocation", () => {
  it("keeps the login shell a Mac always had", async () => {
    const platform = await loadFor("darwin");
    const { file, args } = platform.shellInvocation("npm test", { shell: "/bin/zsh" });
    expect(file).toBe("/bin/zsh");
    // -l because a CLI installed by a version manager is only on PATH once the
    // profile has run.
    expect(args).toEqual(["-lc", "npm test"]);
  });

  it("uses cmd on Windows, with AutoRun skipped and the line handed over verbatim", async () => {
    const platform = await loadFor("win32");
    const { file, args, spawnOptions } = platform.shellInvocation("npm test", { shell: "C:\\Windows\\system32\\cmd.exe" });
    expect(file).toBe("C:\\Windows\\system32\\cmd.exe");
    // /d so a machine with a registry AutoRun entry does not inject it into
    // every command Pitwall runs; /s strips exactly the outer quotes.
    expect(args).toEqual(["/d", "/s", "/c", '"npm test"']);
    // Node would otherwise re-quote the line with backslashes cmd cannot read.
    expect(spawnOptions).toEqual({ windowsVerbatimArguments: true, windowsHide: true });
  });

  it("gives node-pty the command line as a string on Windows, which it uses as is", async () => {
    const platform = await loadFor("win32");
    expect(platform.ptyShellInvocation("claude mcp login x").args).toBe('/d /s /c "claude mcp login x"');
    expect((await loadFor("darwin")).ptyShellInvocation("x", { shell: "/bin/zsh" }).args).toEqual(["-lc", "x"]);
  });
});

describe("detectCommand", () => {
  it("asks each platform the way it answers", async () => {
    expect((await loadFor("darwin")).detectCommand("claude")).toBe("command -v 'claude'");
    expect((await loadFor("win32")).detectCommand("claude")).toBe('where ^"claude^"');
  });

  it("escapes the name, so a custom agent cannot end the command", async () => {
    // Custom agents are named by the user, and the name reaches a shell.
    const posix = await loadFor("darwin");
    expect(posix.detectCommand("a; rm -rf /")).toBe("command -v 'a; rm -rf /'");
    const windows = await loadFor("win32");
    // Every cmd metacharacter is caret-escaped, so `&` cannot start a second command.
    expect(windows.detectCommand("a & del C:\\")).toBe('where ^"a^ ^&^ del^ C:\\\\^"');
  });

  it("takes the first match, because that is the one that would run", async () => {
    const platform = await loadFor("win32");
    // `where` prints every match; the first is what the OS would execute.
    expect(platform.firstResolvedPath("C:\\a\\claude.cmd\r\nC:\\b\\claude.exe\r\n"))
      .toBe("C:\\a\\claude.cmd");
    expect(platform.firstResolvedPath("")).toBe("");
    expect(platform.firstResolvedPath("\n  \n")).toBe("");
  });
});

describe("agentInvocation", () => {
  it("starts an agent directly on a Mac", async () => {
    const platform = await loadFor("darwin");
    expect(platform.agentInvocation("claude", ["--model", "opus"]))
      .toEqual({ file: "claude", args: ["--model", "opus"], viaCmd: false });
  });

  it("starts a real program directly on Windows, arguments untouched", async () => {
    const platform = await loadFor("win32");
    const exe = "C:\\Users\\me\\.local\\bin\\claude.exe";
    expect(platform.agentInvocation("claude", ["--settings", '{"a":1}', "two words"], { resolved: exe }))
      .toEqual({ file: exe, args: ["--settings", '{"a":1}', "two words"], viaCmd: false });
  });

  it("runs an npm .cmd shim through cmd, escaped twice for the batch file", async () => {
    const platform = await loadFor("win32");
    const shim = "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd";
    const invocation = platform.agentInvocation("codex", ["--prompt", "fix it & ship"], { resolved: shim });
    expect(invocation.file).toMatch(/cmd\.exe$/i);
    expect(invocation.viaCmd).toBe(true);
    // A string, which node-pty passes on verbatim.
    expect(invocation.args).toBe(
      '/d /s /c "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd ^^^"--prompt^^^" ^^^"fix^^^ it^^^ ^^^&^^^ ship^^^""',
    );
  });

  it("falls back to cmd with the bare name when nothing on PATH matches", async () => {
    const platform = await loadFor("win32");
    const invocation = platform.agentInvocation("mystery", [], { pathValue: "" });
    expect(invocation.viaCmd).toBe(true);
    expect(invocation.args).toBe('/d /s /c "mystery"');
  });
});

describe("escaping for cmd", () => {
  // Golden values from cross-spawn 7.0.6, the algorithm execa and npm tooling use.
  const cases: Array<[string, boolean, string]> = [
    ["simple", false, '^"simple^"'],
    ['a"quote', false, '^"a\\^"quote^"'],
    ["ends\\", false, '^"ends\\\\^"'],
    ["100% %PATH% !x!", false, '^"100^%^ ^%PATH^%^ ^!x^!^"'],
    ["a&b|c<d>e^f", true, '^^^"a^^^&b^^^|c^^^<d^^^>e^^^^f^^^"'],
    ["", false, '^"^"'],
  ];
  it.each(cases)("escapes %j (batch file: %s)", async (value, batch, expected) => {
    const platform = await loadFor("win32");
    expect(platform.escapeCmdArgument(value, batch)).toBe(expected);
  });

  it("knows what cannot survive cmd at all", async () => {
    const platform = await loadFor("win32");
    expect(platform.cmdSafeArgument("one line, 100% fine")).toBe(true);
    expect(platform.cmdSafeArgument("two\nlines")).toBe(false);
    expect(platform.cmdSafeArgument("x".repeat(7000))).toBe(false);
  });
});

describe("commandInvocation", () => {
  it("cannot execFile a .cmd on Windows, so wraps it verbatim in cmd", async () => {
    const platform = await loadFor("win32");
    const shim = "C:\\Program Files\\nodejs\\npx.cmd";
    const invocation = platform.commandInvocation("npx", ["-y", "pkg"], { resolved: shim });
    expect(invocation.args).toEqual(["/d", "/s", "/c", '"C:\\Program^ Files\\nodejs\\npx.cmd ^^^"-y^^^" ^^^"pkg^^^""']);
    expect(invocation.spawnOptions).toEqual({ windowsVerbatimArguments: true, windowsHide: true });
  });

  it("starts a program directly", async () => {
    const platform = await loadFor("win32");
    const exe = "C:\\Program Files\\Git\\cmd\\git.exe";
    expect(platform.commandInvocation("git", ["status"], { resolved: exe }))
      .toEqual({ file: exe, args: ["status"], spawnOptions: { windowsHide: true }, viaCmd: false });
  });
});

describe("PATH", () => {
  it("replaces every spelling of PATH on Windows, so the new value is the one a child reads", async () => {
    const platform = await loadFor("win32");
    expect(platform.withPath({ Path: "old", PATH: "older", Other: "x" }, "new")).toEqual({ Other: "x", PATH: "new" });
    expect(platform.getPathValue({ Path: "C:\\bin" })).toBe("C:\\bin");
  });

  it("is case-sensitive on a Mac, where Path and PATH are different variables", async () => {
    const platform = await loadFor("darwin");
    expect(platform.withPath({ Path: "keep", PATH: "old" }, "new")).toEqual({ Path: "keep", PATH: "new" });
  });

  it("resolves a name the way the OS would: PATH order, then PATHEXT", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const first = fs.mkdtempSync(path.join(os.tmpdir(), "pw-a-"));
    const second = fs.mkdtempSync(path.join(os.tmpdir(), "pw-b-"));
    fs.writeFileSync(path.join(second, "claude.exe"), "");
    fs.writeFileSync(path.join(first, "claude.cmd"), "");
    const platform = await loadFor("win32");
    const pathValue = [first, second].join(";");
    // The .cmd in the earlier PATH entry wins over the .exe in a later one.
    expect(platform.resolveExecutable("claude", pathValue)).toBe(path.join(first, "claude.cmd"));
    expect(platform.resolveExecutable("nothing-here", pathValue)).toBe("");
    fs.rmSync(first, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  });
});

describe("pathCandidates", () => {
  it("names the places a Mac hides CLIs", async () => {
    const platform = await loadFor("darwin");
    const candidates = platform.pathCandidates("/Users/someone", {});
    expect(candidates).toContain("/opt/homebrew/bin");
    expect(candidates).toContain("/Users/someone/.local/bin");
  });

  it("names npm's global prefix on Windows, where the agent shims land", async () => {
    const platform = await loadFor("win32");
    const candidates = platform.pathCandidates("C:\\Users\\someone", {
      APPDATA: "C:\\Users\\someone\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local",
    });
    expect(candidates.some((entry: string) => entry.endsWith("Roaming\\npm") || entry.endsWith("Roaming/npm"))).toBe(true);
    expect(candidates.some((entry: string) => entry.includes("scoop"))).toBe(true);
    // Nothing from the Mac list leaks in.
    expect(candidates).not.toContain("/opt/homebrew/bin");
  });

  it("falls back when the environment names no AppData", async () => {
    const platform = await loadFor("win32");
    const candidates = platform.pathCandidates("C:\\Users\\someone", {});
    expect(candidates.every((entry: string) => typeof entry === "string" && entry.length)).toBe(true);
  });
});

describe("version managers", () => {
  it("enumerates nvm and fnm versions on a Mac", async () => {
    const platform = await loadFor("darwin");
    expect(platform.versionedPathRoots("/Users/someone")).toEqual([
      "/Users/someone/.nvm/versions/node",
      "/Users/someone/.fnm/node-versions",
    ]);
    expect(platform.versionBinDirectories("/root", "v22.0.0")).toEqual([
      "/root/v22.0.0/bin",
      "/root/v22.0.0/installation/bin",
    ]);
  });

  it("enumerates none on Windows, where nvm keeps one on PATH itself", async () => {
    const platform = await loadFor("win32");
    expect(platform.versionedPathRoots("C:\\Users\\someone")).toEqual([]);
    // And a version directory has no bin/ below it.
    expect(platform.versionBinDirectories("C:\\root", "v22.0.0")).toEqual(["C:\\root\\v22.0.0"]);
  });
});

describe("geminiSystemSettingsPath", () => {
  it("knows where each platform keeps it", async () => {
    expect((await loadFor("darwin")).geminiSystemSettingsPath({}))
      .toBe("/Library/Application Support/GeminiCli/settings.json");
    expect((await loadFor("win32")).geminiSystemSettingsPath({ ProgramData: "C:\\ProgramData" }))
      .toBe("C:\\ProgramData\\gemini-cli\\settings.json");
    expect((await loadFor("linux")).geminiSystemSettingsPath({}))
      .toBe("/etc/gemini-cli/settings.json");
  });
});

describe("linkPath", () => {
  it("links a file and a folder so later changes show through, never a copy", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { linkPath } = await loadFor(original);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-link-"));
    try {
      const file = path.join(root, "credentials.json");
      const folder = path.join(root, "sessions");
      fs.writeFileSync(file, "old");
      fs.mkdirSync(folder);
      linkPath(file, path.join(root, "linked.json"), false);
      linkPath(folder, path.join(root, "linked-sessions"), true);
      fs.writeFileSync(file, "new");
      fs.writeFileSync(path.join(folder, "a.txt"), "a");
      expect(fs.readFileSync(path.join(root, "linked.json"), "utf8")).toBe("new");
      expect(fs.readFileSync(path.join(root, "linked-sessions", "a.txt"), "utf8")).toBe("a");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

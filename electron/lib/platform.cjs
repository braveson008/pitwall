const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * The handful of places where "run a command" means something different on
 * Windows than it does on a Mac.
 *
 * Pitwall's whole job is starting other people's command-line programs, so the
 * assumptions about how that is done were spread across the shell runner, the
 * PTY, the CLI detector and the PATH builder — each of them written against
 * zsh because that is what was in front of us. This module is where those
 * assumptions are stated once and answered per platform, so the callers can go
 * back to describing what they want rather than how a shell takes it.
 *
 * Nothing here changes what macOS does. Every posix branch is the behaviour
 * that was already there, moved.
 */

const isWindows = process.platform === "win32";

/*
 * Every path below is built with `path.win32` or `path.posix` explicitly,
 * rather than a bare `path.join`.
 *
 * At runtime the two are the same thing. It matters for the tests, which load
 * this module against a stated platform from whichever machine is running the
 * suite: with a bare join, the Windows branch produces
 * `C:\ProgramData/gemini-cli/settings.json` on a Mac and passes anyway.
 */

/**
 * The shell that runs a command line, and how to hand it one.
 *
 * `cmd.exe`, not PowerShell. Three reasons, in order of how much trouble they
 * cause: PowerShell refuses to run scripts at all under the default execution
 * policy on a fresh machine; npm installs its binaries as `.cmd` shims, which
 * `cmd` runs natively and PowerShell needs help with; and PowerShell loads a
 * profile on every invocation, which is a visible cost when a CLI check runs
 * nine of them. `/d` skips AutoRun, so a machine with a registry AutoRun entry
 * does not inject it into every command Pitwall runs.
 *
 * On a Mac this is the login shell it always was: `-l` because a CLI installed
 * by a version manager is only on PATH once the profile has run.
 */
/**
 * A line that starts with a CLI name, with that name replaced by the batch file it resolves to. cmd gives a batch
 * file called by a quoted bare name the wrong %~dp0, and an npm shim then looks for its script in the wrong folder.
 */
function withResolvedBatch(command, pathValue) {
  const match = /^(?:\^"([\w.-]+)\^"|([\w.-]+))(?=\s|$)/.exec(command);
  if (!match) return command;
  const resolved = resolveExecutable(match[1] || match[2], pathValue ?? getPathValue(process.env));
  if (!/\.(?:cmd|bat)$/i.test(resolved)) return command;
  return `${escapeCmdCommand(resolved)}${command.slice(match[0].length)}`;
}

function shellInvocation(command, options = {}) {
  if (isWindows) {
    command = withResolvedBatch(command, options.pathValue ?? (options.env ? getPathValue(options.env) : undefined));
    const file = options.shell || process.env.COMSPEC || "cmd.exe";
    // `/s` strips exactly the outer pair of quotes and runs what is inside.
    // Node must not re-quote that line (it would escape the inner quotes with
    // backslashes, which cmd does not understand), hence verbatim arguments —
    // the same thing Node itself does for `shell: true`.
    return {
      file,
      args: ["/d", "/s", "/c", `"${command}"`],
      spawnOptions: { windowsVerbatimArguments: true, windowsHide: true },
    };
  }
  return { file: options.shell || process.env.SHELL || "/bin/zsh", args: ["-lc", command], spawnOptions: {} };
}

/**
 * The same, for node-pty. On Windows node-pty uses a string argument list
 * verbatim, while an array would be re-quoted with backslashes.
 */
function ptyShellInvocation(command, options = {}) {
  if (isWindows) {
    command = withResolvedBatch(command, options.pathValue ?? (options.env ? getPathValue(options.env) : undefined));
    const file = options.shell || process.env.COMSPEC || "cmd.exe";
    return { file, args: `/d /s /c "${command}"` };
  }
  return { file: options.shell || process.env.SHELL || "/bin/zsh", args: ["-lc", command] };
}

/**
 * One argument of a command line, quoted so the shell reads it as one thing.
 *
 * The two shells disagree about everything here: POSIX takes single quotes and
 * cannot escape a single quote inside them (hence the close-escape-reopen
 * dance), `cmd` takes double quotes and doubles an inner one.
 */
function shellEscape(value) {
  if (isWindows) return escapeCmdArgument(value);
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

/**
 * A command line that prints where a program is, or fails if it is not there.
 *
 * `where` writes every match, one per line, so the first line is the one that
 * would actually run — the same thing `command -v` gives on a Mac. The name is
 * escaped here rather than by the caller, because the two shells do not escape
 * the same way and nineteen call sites should not each have to know that.
 */
function detectCommand(name) {
  return isWindows ? `where ${shellEscape(name)}` : `command -v ${shellEscape(name)}`;
}

/** The first line of what `detectCommand` printed, which is the path that wins. */
function firstResolvedPath(stdout) {
  return String(stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
}

/**
 * How to start an agent's CLI in a terminal of its own.
 *
 * On Windows the name is resolved first, the way typing it would (PATH, then
 * PATHEXT). A real program (`claude.exe` from Claude's native installer,
 * `hermes.exe`) is started directly, so its arguments reach it untouched —
 * node-pty quotes an array the way the C runtime reads it back. An npm shim
 * (`codex.cmd`) has to go through cmd, which re-reads the line twice (cmd,
 * then the batch file), so every argument is escaped for both. `viaCmd` tells
 * the caller which happened: a prompt with a newline cannot survive cmd at all
 * and has to be typed into the terminal instead.
 */
function agentInvocation(command, args = [], options = {}) {
  if (!isWindows) return { file: command, args: [...args], viaCmd: false };
  const resolved = options.resolved ?? resolveExecutable(command, options.pathValue);
  if (resolved && /\.(exe|com)$/i.test(resolved)) {
    return { file: resolved, args: [...args], viaCmd: false };
  }
  const target = resolved || command;
  const line = [escapeCmdCommand(target), ...args.map((arg) => escapeCmdArgument(arg, true))].join(" ");
  return { file: process.env.COMSPEC || "cmd.exe", args: `/d /s /c "${line}"`, viaCmd: true };
}

/**
 * The same choice for child_process (execFile/spawn), which on Windows cannot
 * start a `.cmd` file without a shell at all (Node refuses since the
 * CVE-2024-27980 fix). A real program is started directly; a shim through cmd,
 * with the line handed over verbatim so Node does not re-quote it.
 */
function commandInvocation(command, args = [], options = {}) {
  if (!isWindows) return { file: command, args: [...args], spawnOptions: {}, viaCmd: false };
  const resolved = options.resolved ?? resolveExecutable(command, options.pathValue);
  if (resolved && /\.(exe|com)$/i.test(resolved)) {
    return { file: resolved, args: [...args], spawnOptions: { windowsHide: true }, viaCmd: false };
  }
  const line = [escapeCmdCommand(resolved || command), ...args.map((arg) => escapeCmdArgument(arg, true))].join(" ");
  return {
    file: process.env.COMSPEC || "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    spawnOptions: { windowsVerbatimArguments: true, windowsHide: true },
    viaCmd: true,
  };
}

/**
 * Whether an argument survives a trip through cmd.exe. A line feed ends the
 * command outright, and cmd refuses lines over 8191 characters.
 */
function cmdSafeArgument(value) {
  const text = String(value);
  return !/[\r\n\0]/.test(text) && text.length < 6000;
}

// cmd stops reading at 8191 characters; CreateProcess at 32767. Both leave a margin for the quoting Node adds.
const CMD_LINE_LIMIT = 8000;
const PROCESS_LINE_LIMIT = 32000;

/** Whether this command and its arguments can be started as one Windows command line, measured as built. */
function commandLineFits(command, args = [], options = {}) {
  if (!isWindows) return true;
  const invocation = commandInvocation(command, args, options);
  if (invocation.viaCmd) return args.every(cmdSafeArgument) && invocation.args[3].length <= CMD_LINE_LIMIT;
  // Node quotes each argument and escapes its quotes and the backslashes before them.
  const length = [invocation.file, ...invocation.args].reduce((total, arg) => total + String(arg).replace(/[\\"]/g, "xx").length + 3, 0);
  return length <= PROCESS_LINE_LIMIT;
}

/*
 * Escaping for a command line that cmd.exe reads and then hands to a program.
 *
 * Two parsers read it in turn: cmd (metacharacters, `%VAR%`, `!VAR!`, caret)
 * and then the program's C runtime (quotes and the backslashes before them).
 * The algorithm is the one cross-spawn and execa use (https://qntm.org/cmd):
 * quote for the C runtime first, then caret-escape every character cmd would
 * act on. A batch file (an npm `.cmd` shim) is read by cmd once more, so its
 * arguments are caret-escaped twice.
 */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function escapeCmdArgument(argument, batchFile = false) {
  let value = String(argument);
  // Backslashes before a quote are doubled, and the quote escaped.
  value = value.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
  // Backslashes at the end, which precede the closing quote added below.
  value = value.replace(/(?=(\\+?)?)\1$/, "$1$1");
  value = `"${value}"`;
  value = value.replace(CMD_META, "^$1");
  if (batchFile) value = value.replace(CMD_META, "^$1");
  return value;
}

function escapeCmdCommand(command) {
  return String(command).replace(CMD_META, "^$1");
}

/**
 * Display quoting for cmd: what a person would type, kept readable in the
 * "start command" preview. Not used to build anything that runs.
 */
function quoteForCmd(argument) {
  const value = String(argument);
  if (value === "") return '""';
  if (!/[\s"&|<>^()]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Where a command would be found, the way the OS looks: each PATH entry in
 * order, and on Windows each PATHEXT extension in each. Empty when it is not
 * installed. Synchronous on purpose: it runs once per launch, on a handful of
 * directories.
 */
function resolveExecutable(name, pathValue = getPathValue(process.env)) {
  const text = String(name || "");
  if (!text) return "";
  // The host's own join: this one touches the real filesystem.
  const join = path.join;
  const hasDirectory = /[\\/]/.test(text);
  const directories = hasDirectory
    ? [""]
    : String(pathValue || "").split(isWindows ? ";" : ":").map((d) => d.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
  const names = isWindows && !/\.[a-z0-9]+$/i.test(path.win32.basename(text))
    ? executableCandidates(text).filter((candidate) => candidate !== text)
    : [text];
  for (const directory of directories) {
    for (const candidate of names) {
      const full = directory ? join(directory, candidate) : candidate;
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {
        // Not here.
      }
    }
  }
  return "";
}

/** PATH as a process would read it: on Windows the key's case is anyone's. */
function getPathValue(environment = process.env) {
  if (!isWindows) return environment.PATH || "";
  const key = Object.keys(environment).find((name) => name.toUpperCase() === "PATH");
  return key ? environment[key] || "" : "";
}

/**
 * An environment with PATH replaced. On Windows `{...process.env, PATH}` keeps
 * the inherited `Path` beside the new `PATH`, and the first one wins in the
 * child, so the extra directories silently do nothing.
 */
function withPath(environment, value) {
  const out = {};
  for (const [key, entry] of Object.entries(environment || {})) {
    if (isWindows && key.toUpperCase() === "PATH") continue;
    if (!isWindows && key === "PATH") continue;
    out[key] = entry;
  }
  out.PATH = value;
  return out;
}

/** Options every background process gets: no console window on Windows. */
const hiddenWindow = isWindows ? { windowsHide: true } : {};

/**
 * The filenames a command could actually have in a directory.
 *
 * On a Mac a program called `code` is a file called `code`. On Windows it is
 * `code.cmd`, or `code.exe`, or `code.bat`, depending on how it was installed —
 * PATHEXT is what decides, and looking for the bare name finds nothing at all.
 * The bare name stays in the list last, for a program that genuinely has no
 * extension.
 */
function executableCandidates(name) {
  if (!isWindows) return [name];
  const extensions = String(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  // .cmd first: it is what npm and most editor installers write.
  const ordered = [".CMD", ".EXE", ".BAT", ...extensions];
  const seen = new Set();
  const candidates = [];
  for (const extension of ordered) {
    const key = extension.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(`${name}${extension.toLowerCase()}`);
  }
  candidates.push(name);
  return candidates;
}

/**
 * Where a CLI might be that the inherited PATH does not mention.
 *
 * A GUI app on either platform inherits a PATH assembled before the user's
 * shell profile ran, so a tool installed by a version manager is invisible to
 * it. These are the places those installers actually use.
 */
function pathCandidates(home = os.homedir(), environment = process.env) {
  if (isWindows) {
    const appData = environment.APPDATA || path.win32.join(home, "AppData", "Roaming");
    const localAppData = environment.LOCALAPPDATA || path.win32.join(home, "AppData", "Local");
    return [
      // Claude Code's native installer, and Hermes' native one.
      path.win32.join(home, ".local", "bin"),
      path.win32.join(localAppData, "hermes", "bin"),
      // npm's global prefix, which is where `npm i -g claude` puts its shims.
      path.win32.join(appData, "npm"),
      path.win32.join(environment.ProgramFiles || "C:\\Program Files", "Git", "cmd"),
      path.win32.join(localAppData, "Programs", "Python", "Scripts"),
      path.win32.join(localAppData, "Microsoft", "WindowsApps"),
      path.win32.join(home, ".bun", "bin"),
      path.win32.join(home, ".deno", "bin"),
      path.win32.join(home, ".cargo", "bin"),
      path.win32.join(home, "scoop", "shims"),
      path.win32.join(environment.ProgramData || "C:\\ProgramData", "chocolatey", "bin"),
    ];
  }
  return [
    path.posix.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    path.posix.join(home, ".bun", "bin"),
    path.posix.join(home, ".deno", "bin"),
    path.posix.join(home, ".cargo", "bin"),
    path.posix.join(home, ".volta", "bin"),
    path.posix.join(home, "bin"),
  ];
}

/** Where a node version manager keeps its installed versions, and how deep. */
function versionedPathRoots(home = os.homedir()) {
  if (isWindows) {
    // nvm-windows puts the active version on PATH through a symlink of its own,
    // so there is no per-version directory to enumerate the way nvm does.
    return [];
  }
  return [
    path.posix.join(home, ".nvm", "versions", "node"),
    path.posix.join(home, ".fnm", "node-versions"),
  ];
}

/** The subdirectory of an installed node version that holds its programs. */
function versionBinDirectories(base, version) {
  if (isWindows) return [path.win32.join(base, version)];
  return [path.posix.join(base, version, "bin"), path.posix.join(base, version, "installation", "bin")];
}

/**
 * The machine-wide settings file Gemini reads, which is not in either user
 * directory and differs per platform.
 */
function geminiSystemSettingsPath(environment = process.env) {
  if (isWindows) {
    return path.win32.join(environment.ProgramData || "C:\\ProgramData", "gemini-cli", "settings.json");
  }
  if (process.platform === "darwin") return "/Library/Application Support/GeminiCli/settings.json";
  return "/etc/gemini-cli/settings.json";
}

/**
 * Points `target` at `source`. Windows only lets an administrator or Developer
 * Mode create symbolic links, so there a folder becomes a junction and a file
 * a hard link. Neither is ever a copy: a copied credentials file would go
 * stale the first time the agent refreshes its login. Throws when no link
 * can be made, as fs.symlinkSync would.
 */
function linkPath(source, target, isDirectory, platform = process.platform) {
  if (platform !== "win32") {
    fs.symlinkSync(source, target, isDirectory ? "dir" : "file");
    return;
  }
  if (isDirectory) {
    fs.symlinkSync(source, target, "junction");
    return;
  }
  try {
    fs.symlinkSync(source, target, "file");
  } catch {
    fs.linkSync(source, target);
  }
}

module.exports = {
  isWindows,
  linkPath,
  shellInvocation,
  ptyShellInvocation,
  detectCommand,
  shellEscape,
  firstResolvedPath,
  agentInvocation,
  commandInvocation,
  cmdSafeArgument,
  commandLineFits,
  escapeCmdArgument,
  escapeCmdCommand,
  quoteForCmd,
  resolveExecutable,
  getPathValue,
  withPath,
  hiddenWindow,
  executableCandidates,
  pathCandidates,
  versionedPathRoots,
  versionBinDirectories,
  geminiSystemSettingsPath,
};

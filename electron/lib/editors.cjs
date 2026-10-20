"use strict";

const path = require("path");
const { isWindows, executableCandidates } = require("./platform.cjs");

/**
 * The editors Pitwall knows how to hand a project to.
 *
 * There is no "default editor for a folder" to ask the system for. macOS
 * LaunchServices answers that question with Finder — `open` on a directory
 * reveals it rather than editing it — so the only honest approach is to find
 * what is actually installed and let the user say which one they meant.
 *
 * Order is preference order: with several installed and nothing chosen yet, the
 * first one found is what Pitwall offers. Xcode sits last deliberately — it is
 * installed on most Macs that have any editor at all, and it is nobody's
 * general-purpose project editor.
 */
const KNOWN_EDITORS = [
  // `winApp` is the program under %LOCALAPPDATA%\Programs or Program Files.
  { id: "vscode", name: "Visual Studio Code", app: "Visual Studio Code.app", winApp: "Microsoft VS Code\\Code.exe", cli: "code" },
  { id: "cursor", name: "Cursor", app: "Cursor.app", winApp: "cursor\\Cursor.exe", cli: "cursor" },
  { id: "windsurf", name: "Windsurf", app: "Windsurf.app", winApp: "Windsurf\\Windsurf.exe", cli: "windsurf" },
  { id: "zed", name: "Zed", app: "Zed.app", winApp: "Zed\\Zed.exe", cli: "zed" },
  { id: "sublime", name: "Sublime Text", app: "Sublime Text.app", winApp: "Sublime Text\\sublime_text.exe", cli: "subl" },
  { id: "webstorm", name: "WebStorm", app: "WebStorm.app", cli: "webstorm" },
  { id: "intellij", name: "IntelliJ IDEA", app: "IntelliJ IDEA.app", cli: "idea" },
  { id: "nova", name: "Nova", app: "Nova.app", cli: null },
  { id: "xcode", name: "Xcode", app: "Xcode.app", cli: null },
];

/**
 * Finds the editors installed on this machine.
 *
 * `exists` is injected rather than called directly so the detection rules can be
 * tested without a filesystem that happens to have the right applications on it.
 */
function detectEditors({ appDirs = [], pathDirs = [], exists }) {
  if (typeof exists !== "function") return [];
  const found = [];

  for (const editor of KNOWN_EDITORS) {
    // A command is a filename, and on Windows that filename has an extension
    // the caller does not know — `code` is `code.cmd`. Every spelling PATHEXT
    // allows is tried, in the order the OS would try them.
    const cliPath = editor.cli
      ? pathDirs.filter(Boolean)
        .flatMap((dir) => executableCandidates(editor.cli).map((name) => path.join(dir, name)))
        .find((candidate) => exists(candidate))
      : undefined;
    const appName = isWindows ? editor.winApp : editor.app;
    const appPath = appName
      ? appDirs.filter(Boolean).map((dir) => path.join(dir, appName)).find((candidate) => exists(candidate))
      : undefined;
    if (!cliPath && !appPath) continue;
    found.push({ id: editor.id, name: editor.name, cliPath: cliPath ?? null, appPath: appPath ?? null });
  }

  return found;
}

/**
 * How to open a project in a given editor.
 *
 * The editor's own launcher wins when it is on PATH: `code <dir>` opens the
 * folder as a workspace in its own window, which is what a person means by
 * "open this project". `open -a` is the fallback for an editor installed
 * without its command line tools — it does the same job, less precisely, since
 * the app decides for itself whether to reuse an existing window.
 */
function buildEditorLaunch(editor, projectPath) {
  if (!editor || !projectPath) return null;
  if (editor.cliPath) return editorCommandLaunch(editor.cliPath, [projectPath]);
  // A Windows editor's program takes the folder itself, like its launcher.
  if (editor.appPath && isWindows) return editorCommandLaunch(editor.appPath, [projectPath]);
  if (editor.appPath) return { command: "/usr/bin/open", args: ["-a", editor.appPath, projectPath] };
  return null;
}

/**
 * Running an editor's own launcher. On Windows that is often a `.cmd`, which
 * `execFile` cannot start; the caller wraps it (platform.commandInvocation),
 * so this stays the plain command and arguments on every platform.
 */
function editorCommandLaunch(command, args) {
  return { command, args };
}

/**
 * Which editor to use: the one the user chose, as long as it is still
 * installed, and otherwise the best available. A remembered editor that has
 * since been uninstalled must not leave the button dead — falling back is more
 * useful than being right about a preference nobody can act on.
 */
/**
 * Editors that take `path:line` on the command line, and the flag they need.
 *
 * There is no common way to ask for a line, so this is a lookup rather than a
 * rule. An editor not listed here still opens the file — landing at the top of
 * it is a smaller loss than not opening at all, which is what guessing at a
 * flag would risk.
 */
const LINE_SYNTAX = {
  vscode: { flag: "-g", suffix: true },
  cursor: { flag: "-g", suffix: true },
  windsurf: { flag: "-g", suffix: true },
  zed: { flag: null, suffix: true },
  sublime: { flag: null, suffix: true },
  webstorm: { flag: "--line", separate: true },
  intellij: { flag: "--line", separate: true },
};

/**
 * Opens one file, at the line the change starts on where the editor allows it.
 *
 * Reviewing a diff and wanting to edit the thing you are looking at is the
 * obvious next move, and arriving at line 1 of a two thousand line file makes
 * it a worse move than opening the folder.
 */
function buildFileLaunch(editor, filePath, line) {
  if (!editor || !filePath) return null;

  const syntax = LINE_SYNTAX[editor.id];
  const wantsLine = Number.isFinite(line) && line > 0 && Boolean(syntax);

  // On Windows the editor's program takes the same arguments as its launcher.
  const launcher = editor.cliPath || (isWindows ? editor.appPath : null);
  if (launcher) {
    if (!wantsLine) return editorCommandLaunch(launcher, [filePath]);
    if (syntax.separate) return editorCommandLaunch(launcher, [syntax.flag, String(line), filePath]);
    const target = `${filePath}:${line}`;
    return editorCommandLaunch(launcher, syntax.flag ? [syntax.flag, target] : [target]);
  }

  // Through `open`, which passes no arguments to the app, so the line is lost.
  if (editor.appPath) return { command: "/usr/bin/open", args: ["-a", editor.appPath, filePath] };
  return null;
}

function resolveEditor(editors, preferredId) {
  if (!Array.isArray(editors) || editors.length === 0) return null;
  return editors.find((editor) => editor.id === preferredId) ?? editors[0];
}

module.exports = {
  KNOWN_EDITORS,
  buildEditorLaunch,
  buildFileLaunch,
  detectEditors,
  resolveEditor,
};

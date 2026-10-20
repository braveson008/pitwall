"use strict";
/**
 * Agent conversations, moved so the CLI on another computer can resume them.
 *
 * Claude Code keeps a conversation at
 * `~/.claude/projects/<cwd with every non-alphanumeric as "-">/<id>.jsonl`
 * (plus `<id>/` for subagents), with the working directory on every line.
 * Codex keeps it at `~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl` and
 * finds it by id. Moving one means writing it where the other computer's CLI
 * looks, with the old working directory swapped for the new one everywhere
 * it appears. These formats are the CLIs' own and change between versions,
 * so only versions a rewriter has been checked against are moved; anything
 * else falls back to a written summary (handoffBrief.cjs).
 */
const fs = require("node:fs");
const path = require("node:path");
const { relativise, resolve } = require("./pathMap.cjs");

// Version ranges each rewriter was checked against, [from, below).
const SUPPORTED = {
  claude: [[2, 0, 0], [3, 0, 0]],
  codex: [[0, 150, 0], [1, 0, 0]],
};

const parseVersion = (text) => (String(text || "").match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
function compare(a, b) {
  for (let index = 0; index < 3; index += 1) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  return 0;
}

function supported(cli, version) {
  const range = SUPPORTED[cli];
  const parsed = parseVersion(version);
  return Boolean(range && parsed.length === 3 && compare(parsed, range[0]) >= 0 && compare(parsed, range[1]) < 0);
}

const claudeDirName = (cwd) => String(cwd).replace(/[^A-Za-z0-9]/g, "-");

function walkFiles(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(full, base));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push({ abs: full, rel: path.relative(base, full).split(path.sep).join("/") });
  }
  return files;
}

function findCodexRollout(directory, nativeId, depth = 0) {
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(`${nativeId}.jsonl`)) return full;
    if (entry.isDirectory() && depth < 4) {
      const found = findCodexRollout(full, nativeId, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function lastVersion(file, key) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].includes(`"${key}"`)) continue;
    try {
      const value = JSON.parse(lines[index]);
      const found = value?.[key] ?? value?.payload?.[key];
      if (found) return String(found);
    } catch {
      // A partial last line while the CLI is still writing.
    }
  }
  return "";
}

function firstCwd(text) {
  for (const line of text.split("\n")) {
    if (!line.includes('"cwd"')) continue;
    try {
      const value = JSON.parse(line);
      const cwd = value?.cwd ?? value?.payload?.cwd;
      if (cwd) return cwd;
    } catch {
      // Skip.
    }
  }
  return null;
}

/** The files that make up one conversation on this computer, or null. */
function locateTranscript({ cli, nativeId, home }) {
  if (!nativeId) return null;
  if (cli === "claude") {
    const projects = path.join(home, ".claude", "projects");
    let directories = [];
    try {
      directories = fs.readdirSync(projects, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    } catch {
      return null;
    }
    for (const directory of directories) {
      const root = path.join(projects, directory.name);
      const main = path.join(root, `${nativeId}.jsonl`);
      if (!fs.existsSync(main)) continue;
      const files = [{ abs: main, rel: `${nativeId}.jsonl` }];
      const extra = path.join(root, nativeId);
      if (fs.existsSync(extra)) files.push(...walkFiles(extra, root));
      const text = fs.readFileSync(main, "utf8");
      return { cli, nativeId, root, files, version: lastVersion(main, "version"), cwd: firstCwd(text) };
    }
    return null;
  }
  if (cli === "codex") {
    const sessions = path.join(home, ".codex", "sessions");
    const file = findCodexRollout(sessions, nativeId);
    if (!file) return null;
    const text = fs.readFileSync(file, "utf8");
    return { cli, nativeId, root: sessions, files: [{ abs: file, rel: path.relative(sessions, file).split(path.sep).join("/") }], version: lastVersion(file, "cli_version"), cwd: firstCwd(text) };
  }
  return null;
}

/** Every mention of `from` (as a whole path, a path under it, or inside text) becomes `to`. Lines that are not JSON are kept. */
function rewriteTranscript(text, { from, to }) {
  if (!from || !to || from === to) return text;
  const there = [{ root: from, token: "cwd" }];
  const here = [{ root: to, token: "cwd" }];
  return text.split("\n").map((line) => {
    if (!line.trim()) return line;
    try {
      return JSON.stringify(resolve(relativise(JSON.parse(line), there), here));
    } catch {
      return line;
    }
  }).join("\n");
}

function targetFor({ cli, home, cwd, rel }) {
  if (cli === "claude") return path.join(home, ".claude", "projects", claudeDirName(cwd), ...rel.split("/"));
  return path.join(home, ".codex", "sessions", ...rel.split("/"));
}

/**
 * Writes a conversation from another computer where this computer's CLI will
 * find it. A local copy that is already as long or longer is left alone:
 * it is the same conversation, continued here.
 */
function transplant({ cli, version, files, from, to, home }) {
  if (!supported(cli, version)) return { ok: false, reason: "unsupported-version" };
  const written = [];
  try {
    for (const file of files) {
      const target = targetFor({ cli, home, cwd: to, rel: file.rel });
      const text = rewriteTranscript(file.bytes.toString("utf8"), { from, to });
      if (fs.existsSync(target)) {
        const local = fs.readFileSync(target, "utf8");
        // Already here, or carried on further here: nothing to bring.
        if (local.startsWith(text)) continue;
        // Carried on differently on each computer: this computer's copy is kept beside the incoming one.
        if (!text.startsWith(local)) fs.copyFileSync(target, `${target}.pitwall-${Date.now()}.bak`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, text, { mode: 0o600 });
      written.push(target);
    }
  } catch (error) {
    return { ok: false, reason: "io", message: error.message };
  }
  return { ok: true, written };
}

module.exports = { SUPPORTED, claudeDirName, locateTranscript, rewriteTranscript, supported, targetFor, transplant };

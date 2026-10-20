"use strict";
/**
 * Paths are the one thing a synced record can't carry: every computer keeps a
 * project somewhere else, under another user name, maybe with other
 * separators. Outgoing records swap known roots for tokens (`@{project:key}`)
 * and anything absolute left over is redacted; incoming records swap tokens
 * back for this computer's roots. A project is known everywhere by its git
 * remote, so the same repository is the same project on every machine.
 */
const fs = require("node:fs");
const path = require("node:path");

function normaliseRemote(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  let host;
  let rest;
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(raw);
  if (scp) {
    [, host, rest] = scp;
  } else {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    if (!["https:", "http:", "ssh:", "git:"].includes(parsed.protocol) || !parsed.hostname) return null;
    host = parsed.hostname;
    rest = parsed.pathname;
  }
  const repo = rest.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return repo ? `${host.toLowerCase()}/${repo}` : null;
}

const isWindowsPath = (value) => /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
const comparable = (value) => {
  const forward = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return isWindowsPath(value) ? forward.toLowerCase() : forward;
};

function walk(value, visit) {
  if (typeof value === "string") return visit(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, visit));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, visit)]));
  }
  return value;
}

const STOPS = new Set([" ", "\t", "\n", "\r", "\"", "'", "`", ")", "]", ",", ";"]);
const isSeparator = (char) => char === "/" || char === "\\";

/** Every place `root` appears in `text` as a whole path (not as the start of a longer name), with the path that follows it. */
function mentions(text, root, ignoreCase) {
  const haystack = ignoreCase ? text.toLowerCase() : text;
  const needle = ignoreCase ? root.toLowerCase() : root;
  const found = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    let end = at + needle.length;
    const next = text[end];
    // "shop" inside "shop-2" is a different folder; a full stop ending the sentence is not part of the path.
    const boundary = next === undefined || STOPS.has(next) || (next === "." && (text[end + 1] === undefined || STOPS.has(text[end + 1])));
    if (!boundary && !isSeparator(next)) continue;
    if (isSeparator(next)) {
      while (end < text.length && !STOPS.has(text[end])) end += 1;
      while (end > at + needle.length && (text[end - 1] === "." || isSeparator(text[end - 1]))) end -= 1;
    }
    found.push({ at, end, tail: text.slice(at + needle.length, end).replace(/\\/g, "/") });
  }
  return found;
}

/**
 * Replaces known roots with their tokens: a string that is a path becomes a
 * token path with `/` separators, and a root mentioned inside text is swapped
 * where it appears, so a sentence about a project file survives the trip.
 */
function relativise(value, roots) {
  const known = roots
    .filter((entry) => entry.root)
    .map((entry) => ({ ...entry, bare: entry.root.replace(/[\\/]+$/, ""), match: comparable(entry.root) }))
    .sort((a, b) => b.match.length - a.match.length);
  return walk(value, (text) => {
    const candidate = comparable(text);
    for (const entry of known) {
      if (candidate === entry.match) return `@{${entry.token}}`;
      if (candidate.startsWith(`${entry.match}/`)) {
        return `@{${entry.token}}/${text.replace(/\\/g, "/").slice(entry.match.length + 1).replace(/\/+$/, "")}`;
      }
    }
    let next = text;
    for (const entry of known) {
      const found = mentions(next, entry.bare, isWindowsPath(entry.bare));
      for (const mention of found.reverse()) {
        next = `${next.slice(0, mention.at)}@{${entry.token}}${mention.tail}${next.slice(mention.end)}`;
      }
    }
    return next;
  });
}

const TOKEN_IN_TEXT = /@\{([^}]+)\}((?:\/[^\s"'`)\],;]*)?)/g;

// Another platform's app-data folder: a session worktree there is one this computer keeps in its own.
const MAC_WORKTREES = /@\{home\}\/Library\/Application Support\/[^/]+\/worktrees(?=\/|$)/g;
const WINDOWS_WORKTREES = /@\{home\}\/AppData\/Roaming\/[^/]+\/worktrees(?=\/|$)/g;

/** Turns tokens back into this computer's paths, wherever they appear; a token it does not know stays a token. */
function resolve(value, roots) {
  const byToken = new Map(roots.filter((entry) => entry.root).map((entry) => [entry.token, entry.root]));
  const home = byToken.get("home");
  const foreignWorktrees = !byToken.has("worktrees") || !home ? null : isWindowsPath(home) ? MAC_WORKTREES : WINDOWS_WORKTREES;
  return walk(value, (text) => (foreignWorktrees ? text.replace(foreignWorktrees, "@{worktrees}") : text).replace(TOKEN_IN_TEXT, (found, token, rest) => {
    if (!byToken.has(token)) return found;
    const root = byToken.get(token).replace(/[\\/]+$/, "");
    if (!rest) return root;
    const separator = isWindowsPath(root) ? "\\" : "/";
    return `${root}${separator}${rest.slice(1).replace(/\/+$/, "").split("/").join(separator)}`;
  }));
}

// An absolute path starts a string or follows a space, quote, bracket or `=`,
// so the path part of a URL (`https://host/Users/x`) is never one.
const ABSOLUTE = /(?:^|(?<=[\s"'`(=[,]))((?:\/(?:Users|home|private|tmp|var|Volumes|opt|mnt|root|srv)\/[^\s"'`)\]]*)|(?:[A-Za-z]:\\[^\s"'`)\]]*)|(?:[A-Za-z]:\/[^\s"'`)\]]*)|(?:\\\\[^\s"'`)\]\\]+\\[^\s"'`)\]]*))/g;

function findAbsolutePaths(value) {
  const found = [];
  walk(value, (text) => {
    for (const match of text.matchAll(ABSOLUTE)) found.push(match[1]);
    return text;
  });
  return found;
}

function scrubAbsolutePaths(value) {
  let dropped = 0;
  const next = walk(value, (text) => text.replace(ABSOLUTE, () => {
    dropped += 1;
    return "[path]";
  }));
  return { value: next, dropped };
}

const FOREIGN_WORKTREES = {
  win32: /[\\/]Library[\\/]Application Support[\\/][^\\/]+[\\/]worktrees[\\/](.+)$/,
  darwin: /[\\/]AppData[\\/]Roaming[\\/][^\\/]+[\\/]worktrees[\\/](.+)$/,
};

/**
 * A worktree path saved on this computer before paths were translated: one
 * inside the other platform's app folder can never exist here, so it is the
 * same session's place in this computer's worktrees.
 */
function adoptForeignWorktreePath(value, { worktreesRoot, platform = process.platform }) {
  const pattern = FOREIGN_WORKTREES[platform];
  const found = pattern && typeof value === "string" ? value.match(pattern) : null;
  if (!found || !worktreesRoot) return value;
  const join = platform === "win32" ? path.win32.join : path.posix.join;
  return join(worktreesRoot, ...found[1].split(/[\\/]+/).filter(Boolean));
}

function createPathMap({ userDataPath }) {
  const file = path.join(userDataPath, "cloud", "paths.json");
  let entries = {};
  try {
    entries = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    entries = {};
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(entries, null, 2)}\n`);
    fs.renameSync(temp, file);
  }
  return {
    get: (projectKey) => entries[projectKey] ?? null,
    set(projectKey, absolutePath) {
      entries[projectKey] = absolutePath;
      save();
    },
    remove(projectKey) {
      delete entries[projectKey];
      save();
    },
    entries: () => Object.entries(entries),
    keyForPath(absolutePath) {
      const wanted = comparable(String(absolutePath || ""));
      return Object.entries(entries).find(([, value]) => comparable(value) === wanted)?.[0] ?? null;
    },
  };
}

function defaultProjectsRoot(platform = process.platform, env = process.env) {
  if (platform === "win32") return path.win32.join(env.USERPROFILE || "C:\\", "Projects");
  return path.posix.join(env.HOME || "/", "Projects");
}

module.exports = { adoptForeignWorktreePath, createPathMap, defaultProjectsRoot, findAbsolutePaths, normaliseRemote, relativise, resolve, scrubAbsolutePaths };

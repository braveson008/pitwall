"use strict";

/**
 * Whether an agent CLI still starts cleanly with the flags Pitwall gives it.
 *
 * Claude Code and Codex ship constantly, and an update can rename a flag,
 * reject one Pitwall relies on, or put a new screen in front of the input box.
 * A flag that parses can still open a screen that kills the session. So when a
 * CLI's version changes, Pitwall starts it once, out of sight and with no
 * prompt — no model call — and reads what it drew.
 */

const ANSI = /\u001b\[[0-9;?<>=]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001bP[^\u001b]*\u001b\\|\u001b[=>()][0-9A-Za-z]?/g;

function stripAnsi(text) {
  return String(text || "").replace(ANSI, "").replace(/\r/g, "\n");
}

/** What each CLI shows once it is ready for input. */
const READY = {
  claude: [/\?\s*for\s*shortcuts/i, /bypass\s*permissions/i, /auto\s*mode\s*on/i, /shift\+tab\s*to\s*cycle/i, /esc\s*to\s*interrupt/i],
  codex: [/\?\s*for\s*shortcuts/i, /Ask\s*Codex\s*to\s*do\s*anything/i, /Find\s*and\s*fix\s*a\s*bug/i, /esc\s*to\s*interrupt/i],
  hermes: [/Welcome\s*to\s*Hermes\s*Agent/i],
};

/**
 * Lines a CLI draws on every start that are not screens: Hermes's banner box
 * lists every tool and skill, and its random tips mention keys and gateways.
 * Read as screens they would report a sign-in wall that is not there.
 */
const NOISE = {
  hermes: [/^\s*│/, /^\s*✦\s*Tip:/],
};

/** A CLI refusing what it was given. */
const BROKEN = [
  /\bunknown\s+option\b/i,
  /\bunexpected\s+argument\b/i,
  /\berror:\s*(?:unknown|invalid|unrecognized)\b/i,
  /\bunrecognized\s+(?:option|argument)\b/i,
  /\binvalid\s+value\s+for\b/i,
  /\bfailed\s+to\s+parse\b/i,
];

/** Something standing in front of the input box. */
const BLOCKED = [
  { kind: "trust", pattern: /\btrust\s*(?:this|the)\s*(?:folder|files?|directory|workspace)\b|\bdo\s*you\s*trust\b/i },
  { kind: "signin", pattern: /\b(?:sign|log)\s*in\b|\bapi\s*key\b|\bauthenticat/i },
  { kind: "update", pattern: /\bupdate\s*(?:now|available)\b|\bnew\s*version\b.*\bavailable\b/i },
  { kind: "consent", pattern: /\b(?:i\s*accept|terms\s*of\s*service|bypass\s*permissions\s*mode)\b.*\b(?:accept|continue|yes)\b/i },
];

/**
 * Reads a probe's output.
 *
 * @returns {{ status: "ready" | "blocked" | "broken" | "unknown", kind?: string, detail: string }}
 */
function classifyProbe({ agent, output, exited = false, exitCode = null }) {
  const id = String(agent || "").toLowerCase();
  const noise = NOISE[id] ?? [];
  const text = stripAnsi(output).split("\n").filter((line) => !noise.some((pattern) => pattern.test(line))).join("\n");
  const tail = text.split("\n").map((line) => line.trim()).filter(Boolean).slice(-12).join("\n").slice(-600);

  const broken = BROKEN.find((pattern) => pattern.test(text));
  if (broken) return { status: "broken", detail: firstMatchLine(text, broken) || tail };

  const blocked = BLOCKED.find(({ pattern }) => pattern.test(text));
  const ready = (READY[id] ?? []).some((pattern) => pattern.test(text));
  // A screen in front of the input box wins: the box being drawn behind it
  // does not make the session usable.
  if (blocked) return { status: "blocked", kind: blocked.kind, detail: firstMatchLine(text, blocked.pattern) || tail };
  if (ready) return { status: "ready", detail: "" };
  if (exited) return { status: "broken", detail: tail || `It exited with code ${exitCode ?? "unknown"} before it was ready.` };
  return { status: "unknown", detail: tail };
}

function firstMatchLine(text, pattern) {
  return text.split("\n").map((line) => line.trim()).find((line) => pattern.test(line))?.slice(0, 200) || "";
}

/** The sentence Pitwall shows about a probe, by what it found. */
function describeProbe({ label, from, to, result }) {
  const update = from ? `${label} updated from ${from} to ${to}` : `${label} ${to}`;
  if (result.status === "ready") return { tone: "info", title: `${label} updated`, message: `${update}. Pitwall started it with its usual settings and it is ready to use.` };
  if (result.status === "blocked") {
    const what = { trust: "a folder-trust question", signin: "a sign-in screen", update: "an update prompt", consent: "a consent screen" }[result.kind] || "a screen that needs an answer";
    return { tone: "warn", title: `${label} needs attention`, message: `${update}, and it now opens on ${what} before it is ready. New ${label} sessions may stop there until it is answered.${result.detail ? ` It said: “${result.detail}”` : ""}` };
  }
  if (result.status === "broken") return { tone: "error", title: `${label} may not start`, message: `${update}, and it refused how Pitwall starts it.${result.detail ? ` It said: “${result.detail}”` : ""} Please report this so it can be fixed.` };
  return { tone: "warn", title: `${label} updated`, message: `${update}. Pitwall could not confirm it starts cleanly; if a session stalls, report it.` };
}

module.exports = { classifyProbe, describeProbe, stripAnsi };

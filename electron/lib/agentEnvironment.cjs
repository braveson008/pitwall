/**
 * The environment handed to a CLI Pitwall starts.
 *
 * Pitwall inherits whatever launched it, and when that is itself a Claude Code
 * session — a terminal inside one, an app opened from one — the session's own
 * markers come along. The spawned CLI reads them and concludes it is a child of
 * that session: it turns transcript saving off, so the conversation is never
 * written to disk. Nothing in the terminal looks wrong, and everything that
 * reads the conversation afterwards sees a session that does not exist.
 *
 * These describe the launching session, never the one being started, so they
 * are dropped rather than passed on.
 */
const INHERITED_SESSION_MARKERS = [
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
];

/**
 * A UTF-8 locale for anything Pitwall starts.
 *
 * macOS hands a GUI app no LANG or LC_* at all — those are set by a login
 * shell, and double-clicking an app never runs one. Everything spawned then
 * inherits the C locale, where anything above ASCII is undefined, and tools
 * that ask the locale how to read their own output fall back to the platform's
 * legacy encoding. UTF-8 text comes back re-read as Mac Roman.
 *
 * Only filled in when the environment says nothing, so a user who has set a
 * locale — including a non-English one — keeps it.
 */
function localeEnvironment(base = process.env) {
  if (base.LC_ALL || base.LANG) return {};
  return { LANG: "en_US.UTF-8", LC_CTYPE: "en_US.UTF-8" };
}

/** Names this build removes from an inherited environment. */
function inheritedSessionMarkers() {
  return [...INHERITED_SESSION_MARKERS];
}

/**
 * `base` with another session's markers removed and a locale filled in.
 * Callers layer their own variables on top of the result.
 */
function agentEnvironment(base = process.env) {
  const environment = { ...base, ...localeEnvironment(base) };
  for (const marker of INHERITED_SESSION_MARKERS) delete environment[marker];
  return environment;
}

module.exports = { agentEnvironment, localeEnvironment, inheritedSessionMarkers };

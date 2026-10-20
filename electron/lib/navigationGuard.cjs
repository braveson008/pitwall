const path = require("node:path");

/**
 * Which URLs the main window's top frame is allowed to become.
 *
 * The preload hands the renderer the whole bridge — file writes, git, terminal
 * spawn. A top-level navigation away from the app document would give a foreign
 * page all of it, so the answer is "only ever our own document" and everything
 * else goes to the browser. (This guarded an embedded code-server iframe too,
 * until the editor moved out of the app; the top-frame rule outlived it.)
 *
 * Kept here rather than in main.cjs because main.cjs cannot be unit tested (it
 * requires electron), and an untested security guard is a comment.
 */

/**
 * True when `rawUrl` is the application's own document.
 *
 * In dev that is the Vite server, matched by prefix because the dev server URL
 * is an origin we control. Packaged it is a file:// URL inside `distRoot`,
 * matched by path containment rather than string prefix — `startsWith` would
 * accept `/app/dist-evil/index.html` as living under `/app/dist`.
 */
function isAppDocumentUrl(rawUrl, { devServer, distRoot } = {}) {
  if (typeof rawUrl !== "string" || !rawUrl) return false;
  if (devServer) return rawUrl.startsWith(devServer);
  if (!distRoot) return false;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "file:") return false;
    const target = path.resolve(decodeURIComponent(url.pathname));
    const relative = path.relative(path.resolve(distRoot), target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  } catch {
    // Not a parseable URL, so not our document.
    return false;
  }
}

/**
 * Whether a blocked navigation may be handed to the real browser.
 *
 * Deliberately http(s) only. Passing `file:`, `javascript:` or a custom scheme
 * to shell.openExternal would turn this guard into a second vulnerability —
 * the OS resolves custom schemes to whatever app claims them.
 */
function isExternallyOpenable(rawUrl) {
  return typeof rawUrl === "string" && /^https?:\/\//i.test(rawUrl);
}

module.exports = { isAppDocumentUrl, isExternallyOpenable };

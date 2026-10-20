"use strict";

/**
 * The sign-in page a CLI printed, out of everything else it printed.
 *
 * The CLIs open the browser themselves, but only on this Mac's default
 * browser and profile — the wrong one, as often as not. The link they print
 * is what lets a person open it wherever they are signed in.
 */
function findSignInUrl(output, target) {
  const text = String(output || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
  // Terminals wrap long links; a link carries no spaces, so rejoin broken lines first.
  const joined = text.replace(/(https?:\/\/\S+)\r?\n(\S+)/g, "$1$2");
  const links = joined.match(/https?:\/\/[^\s"'<>)\]]+/g) || [];
  let base = "";
  try { base = new URL(target).origin; } catch { /* no target */ }
  const scored = links
    .map((link) => link.replace(/[.,;]+$/, ""))
    .filter((link) => !/^https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(link) || /authorize|oauth|login|auth/i.test(link))
    .map((link) => ({ link, score: (/authorize|oauth/i.test(link) ? 2 : 0) + (/[?&](?:client_id|response_type|redirect_uri|code_challenge)=/i.test(link) ? 2 : 0) - (base && link === base ? 3 : 0) }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].link : "";
}

module.exports = { findSignInUrl };

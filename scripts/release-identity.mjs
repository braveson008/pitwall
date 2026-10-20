import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Who a release is. Pitwall's update feed lives under its own prefix in the
 * shared downloads bucket, so a Pitwall release can never overwrite the
 * manifest that copies installed under the app's old name read, and the reverse.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

export const PRODUCT = pkg.build.productName;
export const FEED_PREFIX = "pitwall/";

// The public build updates from this repository's GitHub releases when no feed URL is given.
export const GITHUB_REPO = { owner: "braveson008", repo: "pitwall" };

/** The bucket's public URL, without Pitwall's prefix. */
export function downloadsUrl(env = process.env) {
  return String(env.PITWALL_DOWNLOADS_URL || "").trim().replace(/\/$/, "");
}

/** PITWALL_UPDATE_URL names the whole feed; otherwise it is Pitwall's prefix under PITWALL_DOWNLOADS_URL. */
export function feedUrl(env = process.env) {
  if (env.PITWALL_UPDATE_URL) return String(env.PITWALL_UPDATE_URL).trim().replace(/\/$/, "");
  const base = downloadsUrl(env);
  return base ? `${base}/${FEED_PREFIX.replace(/\/$/, "")}` : "";
}

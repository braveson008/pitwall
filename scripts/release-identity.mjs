import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Who a release is. Pitwall is a separate app from Braveli, and its update
 * feed lives under its own prefix in the same bucket, so a Pitwall release can
 * never overwrite the manifest Braveli's installed copies read, and the reverse.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

export const PRODUCT = pkg.build.productName;
export const FEED_PREFIX = "pitwall/";

// The public build updates from this repository's GitHub releases when no feed URL is given.
export const GITHUB_REPO = { owner: "braveson008", repo: "pitwall" };

export function feedUrl(env = process.env) {
  if (env.PITWALL_UPDATE_URL) return String(env.PITWALL_UPDATE_URL).trim().replace(/\/$/, "");
  const base = String(env.BRAVELI_UPDATE_URL || "").trim().replace(/\/$/, "");
  return base ? `${base}/${FEED_PREFIX.replace(/\/$/, "")}` : "";
}

import { readFileSync } from "node:fs";
import path from "node:path";
import legacyNames from "../electron/lib/legacyNames.cjs";

/**
 * Loads a gitignored .env into process.env.
 *
 * Build-time secrets fall back to a file because the alternative is that every
 * release depends on someone remembering to export them, and a forgotten export
 * produces a build that looks fine and is wrong in a way nothing announces.
 *
 * A real environment variable always wins, so CI is unaffected. Settings under
 * the names older versions used are read as their current names, so an
 * existing .env keeps working unedited.
 */
export function loadEnv(root) {
  let contents = "";
  try {
    contents = readFileSync(path.join(root, ".env"), "utf8");
  } catch {
    contents = "";
  }
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
  for (const [legacy, current] of Object.entries(legacyNames.LEGACY_ENV_NAMES)) {
    if (process.env[legacy] && !process.env[current]) process.env[current] = process.env[legacy];
  }
}

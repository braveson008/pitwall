"use strict";

/**
 * Pitwall's first launch brings over what the app knew under its old name: projects, tasks,
 * sessions, memory, schedules, settings. Once, before any store opens.
 *
 * Left behind on purpose:
 * - worktrees: tens of gigabytes, and git records their paths. Sessions keep
 *   pointing at them where they are.
 * - caches, which rebuild themselves.
 * - runtime-state.json, or Pitwall would relaunch whatever the old app last ran.
 * - anything encrypted with the old app's Keychain entry. Pitwall has its own and
 *   cannot read those, so they would show as connected and not work.
 */

const fs = require("node:fs");
const path = require("node:path");

const { LEGACY_IMPORT_MARKER: MARKER } = require("./legacyNames.cjs");

const SKIP = new Set([
  "worktrees",
  "cli-probe",
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Service Worker",
  "Crashpad",
  "logs",
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
  "runtime-state.json",
  "github-credentials.json",
  "licence.json",
  "pitwall-account.json",
]);

/**
 * The old app holds its profile open while it runs. On a Mac Chromium records who in SingletonLock; on Windows it
 * holds `lockfile` open with no sharing, so opening it fails only while the app is up.
 */
function legacyAppRunning(from, platform = process.platform, open = fs.openSync) {
  if (platform === "win32") {
    const lock = path.join(from, "lockfile");
    if (!fs.existsSync(lock)) return false;
    try {
      fs.closeSync(open(lock, "r+"));
      return false;
    } catch (error) {
      return ["EBUSY", "EPERM", "EACCES"].includes(error.code);
    }
  }
  try {
    const owner = fs.readlinkSync(path.join(from, "SingletonLock"));
    const pid = Number(owner.split("-").pop());
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Pitwall starts without the old app's data, by choice; the import is not offered again. */
function declineImport(to) {
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, MARKER), `declined ${new Date().toISOString()}\n`);
}

function skipped(name) {
  return SKIP.has(name) || name.startsWith("project-knowledge.backup-");
}

/**
 * Copies the old app's data into an empty Pitwall folder. Returns what happened:
 * "imported", "already" (done before), "fresh" (Pitwall already has data of
 * its own), "none" (nothing to import from), or "busy" (the old app is open, so
 * its database is mid-write; nothing is copied and nothing is recorded).
 */
function importLegacyProfile({ from, to, isRunning = legacyAppRunning }) {
  if (fs.existsSync(path.join(to, MARKER))) return "already";
  if (!from || !fs.existsSync(from) || path.resolve(from) === path.resolve(to)) return "none";
  if (isRunning(from)) return "busy";
  // Pitwall that has already been used keeps its own data.
  if (fs.existsSync(path.join(to, "Local Storage"))) {
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, MARKER), "skipped: Pitwall already had data\n");
    return "fresh";
  }
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (skipped(name)) continue;
    const source = path.join(from, name);
    const target = path.join(to, name);
    try {
      fs.cpSync(source, target, {
        recursive: true,
        force: false,
        errorOnExist: false,
        // A socket or lock inside a profile is not data.
        filter: (item) => {
          try {
            const stat = fs.lstatSync(item);
            return stat.isDirectory() || stat.isFile() || stat.isSymbolicLink();
          } catch {
            return false;
          }
        },
      });
    } catch {
      // One unreadable entry should not cost the rest of the import.
    }
  }
  fs.writeFileSync(path.join(to, MARKER), `imported ${new Date().toISOString()} from ${from}\n`);
  return "imported";
}

module.exports = { MARKER, legacyAppRunning, declineImport, importLegacyProfile };

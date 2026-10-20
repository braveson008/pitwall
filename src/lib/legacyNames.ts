// The names older versions of this app, as Braveli, wrote to storage, worktrees and agent output; read so existing data keeps working.

const LEGACY_STORAGE_PREFIX = "braveli-";
const STORAGE_PREFIX = "pitwall-";
const LEGACY_COLOR_THEME = "braveli";
const LEGACY_MARKER_PREFIX = "BRAVELI_";

/** Council stages, contracts and lessons written into project worktrees. */
export const LEGACY_COUNCIL_DIR = ".braveli";

/** A marker an agent prints, or the same marker from a session an older version started. */
export function markerPattern(marker: string): string {
  return `(?:${marker}|${marker.replace(/^PITWALL_/, LEGACY_MARKER_PREFIX)})`;
}

/**
 * Moves every `braveli-` localStorage key to its `pitwall-` name, once, before
 * anything reads storage. A value already under the new name is kept.
 */
export function migrateLegacyStorage(storage: Storage) {
  const legacyKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_STORAGE_PREFIX)) legacyKeys.push(key);
  }
  for (const key of legacyKeys) {
    const value = storage.getItem(key);
    const next = `${STORAGE_PREFIX}${key.slice(LEGACY_STORAGE_PREFIX.length)}`;
    const taken = storage.getItem(next) !== null;
    // Removed first: both prefixes are the same length, so the copy fits in the room this frees.
    storage.removeItem(key);
    if (value === null || taken) continue;
    try {
      storage.setItem(next, value);
    } catch {
      storage.setItem(key, value);
    }
  }
  if (storage.getItem(`${STORAGE_PREFIX}color-theme`) === LEGACY_COLOR_THEME) {
    storage.setItem(`${STORAGE_PREFIX}color-theme`, "pitwall");
  }
}

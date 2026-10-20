import { migrateLegacyStorage } from "./lib/legacyNames";

// Imported first by main.tsx: modules below it read storage as they load.
try {
  migrateLegacyStorage(window.localStorage);
} catch {
  // Storage unavailable; there is nothing to move.
}

const path = require("node:path");

/**
 * Path resolution for greenfield project folders. The renderer already
 * slugifies the display name, but the main process must never trust it — this
 * is the boundary that guarantees a crafted name cannot escape the directory
 * the user actually chose.
 */

const PROJECT_FOLDER_SEGMENT = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function isProjectFolderName(value) {
  return PROJECT_FOLDER_SEGMENT.test(String(value || "").trim());
}

/**
 * Resolves `folderName` inside `parentPath`, rejecting anything that would land
 * outside it. Returns `{ ok: true, path }` or `{ ok: false, error }`.
 */
function resolveNewProjectPath({ parentPath, folderName, expandHome }) {
  const name = String(folderName || "").trim();
  if (!isProjectFolderName(name)) {
    return { ok: false, error: "Folder name must be 1-64 lowercase letters, numbers, or hyphens." };
  }

  const rawParent = String(parentPath || "");
  if (!rawParent.trim()) {
    return { ok: false, error: "Choose where to create the project." };
  }

  const parent = path.resolve(expandHome ? expandHome(rawParent) : rawParent);
  const target = path.join(parent, name);
  if (path.dirname(target) !== parent) {
    return { ok: false, error: "Resolved project path is outside the chosen folder." };
  }

  return { ok: true, path: target, parent };
}

module.exports = {
  PROJECT_FOLDER_SEGMENT,
  isProjectFolderName,
  resolveNewProjectPath,
};

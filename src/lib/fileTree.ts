/**
 * A worktree's file list as a tree the Files panel can draw a window of.
 *
 * Built once per listing; flattening walks only the folders that are open, so
 * a repository of fifty thousand files costs what is on screen, not what is
 * on disk.
 */

export type TreeDir = { name: string; path: string; dirs: TreeDir[]; files: string[] };
export type TreeRow = { path: string; name: string; depth: number; isDir: boolean };

export function buildTree(paths: readonly string[]): TreeDir {
  const root: TreeDir = { name: "", path: "", dirs: [], files: [] };
  const index = new Map<string, TreeDir>([["", root]]);
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let parent = root;
    for (let depth = 0; depth < parts.length - 1; depth += 1) {
      const dirPath = parts.slice(0, depth + 1).join("/");
      let dir = index.get(dirPath);
      if (!dir) {
        dir = { name: parts[depth], path: dirPath, dirs: [], files: [] };
        index.set(dirPath, dir);
        parent.dirs.push(dir);
      }
      parent = dir;
    }
    parent.files.push(filePath);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  for (const dir of index.values()) {
    dir.dirs.sort((a, b) => byName(a.name, b.name));
    dir.files.sort((a, b) => byName(baseName(a), baseName(b)));
  }
  return root;
}

export function flattenTree(root: TreeDir, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: TreeDir, depth: number) => {
    for (const child of dir.dirs) {
      rows.push({ path: child.path, name: child.name, depth, isDir: true });
      if (expanded.has(child.path)) walk(child, depth + 1);
    }
    for (const file of dir.files) rows.push({ path: file, name: baseName(file), depth, isDir: false });
  };
  walk(root, 0);
  return rows;
}

/** Every folder holding a changed file, so a closed folder can still say so. */
export function changedFolders(changed: Iterable<string>): Set<string> {
  const folders = new Set<string>();
  for (const filePath of changed) {
    const parts = filePath.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) folders.add(parts.slice(0, depth).join("/"));
  }
  return folders;
}

/** The folders to open so that `filePath` is visible. */
export function ancestorsOf(filePath: string): string[] {
  const parts = filePath.split("/");
  return parts.slice(0, -1).map((_, depth) => parts.slice(0, depth + 1).join("/"));
}

export function baseName(filePath: string) {
  const slash = filePath.lastIndexOf("/");
  return slash === -1 ? filePath : filePath.slice(slash + 1);
}

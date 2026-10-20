import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import pathMap from "./pathMap.cjs";

const { adoptForeignWorktreePath, createPathMap, defaultProjectsRoot, findAbsolutePaths, normaliseRemote, relativise, resolve, scrubAbsolutePaths } = pathMap;

describe("normaliseRemote", () => {
  it.each([
    ["https://github.com/Owner/Repo.git", "github.com/Owner/Repo"],
    ["https://GitHub.com/Owner/Repo", "github.com/Owner/Repo"],
    ["git@github.com:Owner/Repo.git", "github.com/Owner/Repo"],
    ["ssh://git@github.com/Owner/Repo.git", "github.com/Owner/Repo"],
    ["ssh://git@gitlab.example.com:2222/group/sub/repo.git", "gitlab.example.com/group/sub/repo"],
    ["https://user:token@github.com/Owner/Repo.git/", "github.com/Owner/Repo"],
  ])("%s", (url, key) => expect(normaliseRemote(url)).toBe(key));

  it("returns null for a local path or nonsense", () => {
    expect(normaliseRemote("/srv/git/repo.git")).toBeNull();
    expect(normaliseRemote("")).toBeNull();
    expect(normaliseRemote(null)).toBeNull();
  });
});

describe("relativise and resolve", () => {
  const mac = [{ root: "/Users/a/Projects/shop", token: "project:github.com/o/shop" }, { root: "/Users/a/Library/Application Support/Pitwall/terminal-attachments", token: "attachments" }];
  const win = [{ root: "C:\\Users\\b\\Projects\\shop", token: "project:github.com/o/shop" }, { root: "C:\\Users\\b\\AppData\\Roaming\\Pitwall\\terminal-attachments", token: "attachments" }];

  it("puts a session worktree from another platform's app folder in this computer's worktrees", () => {
    const winHere = [...win, { root: "C:\\Users\\b\\AppData\\Roaming\\Pitwall\\worktrees", token: "worktrees" }, { root: "C:\\Users\\b", token: "home" }];
    expect(resolve("@{home}/Library/Application Support/braveli/worktrees/d8d1/claude-session-8", winHere)).toBe("C:\\Users\\b\\AppData\\Roaming\\Pitwall\\worktrees\\d8d1\\claude-session-8");
    const macHere = [{ root: "/Users/a/Library/Application Support/Pitwall/worktrees", token: "worktrees" }, { root: "/Users/a", token: "home" }];
    expect(resolve("@{home}/AppData/Roaming/Pitwall/worktrees/d8d1/s", macHere)).toBe("/Users/a/Library/Application Support/Pitwall/worktrees/d8d1/s");
    // On the platform the folder belongs to, it is still the folder it named.
    expect(resolve("@{home}/Library/Application Support/braveli/worktrees/d8d1/s", macHere)).toBe("/Users/a/Library/Application Support/braveli/worktrees/d8d1/s");
  });

  it("moves paths from a Mac to Windows through tokens", () => {
    const value = { path: "/Users/a/Projects/shop", file: "/Users/a/Projects/shop/src/app.ts", image: "/Users/a/Library/Application Support/Pitwall/terminal-attachments/x/a.png", other: "keep" };
    const portable = relativise(value, mac);
    expect(portable).toEqual({ path: "@{project:github.com/o/shop}", file: "@{project:github.com/o/shop}/src/app.ts", image: "@{attachments}/x/a.png", other: "keep" });
    expect(resolve(portable, win)).toEqual({
      path: "C:\\Users\\b\\Projects\\shop",
      file: "C:\\Users\\b\\Projects\\shop\\src\\app.ts",
      image: "C:\\Users\\b\\AppData\\Roaming\\Pitwall\\terminal-attachments\\x\\a.png",
      other: "keep",
    });
  });

  it("relativises Windows paths case-insensitively and does not match a sibling folder", () => {
    expect(relativise(["c:\\users\\b\\projects\\shop\\a.txt", "C:\\Users\\b\\Projects\\shop-2\\a.txt"], win))
      .toEqual(["@{project:github.com/o/shop}/a.txt", "C:\\Users\\b\\Projects\\shop-2\\a.txt"]);
  });

  it("swaps known roots inside sentences too, and back", () => {
    const text = "Notes are in /Users/a/Projects/shop/docs/notes.md, see also /Users/a/Projects/shop.";
    const portable = relativise(text, mac);
    expect(portable).toBe("Notes are in @{project:github.com/o/shop}/docs/notes.md, see also @{project:github.com/o/shop}.");
    expect(resolve(portable, win)).toBe("Notes are in C:\\Users\\b\\Projects\\shop\\docs\\notes.md, see also C:\\Users\\b\\Projects\\shop.");
    expect(relativise("Built /Users/a/Projects/shop-2/x", mac)).toBe("Built /Users/a/Projects/shop-2/x");
  });

  it("leaves an unknown token as it is", () => {
    expect(resolve("@{project:elsewhere}/x", win)).toBe("@{project:elsewhere}/x");
  });
});

describe("absolute path guard", () => {
  it("finds absolute paths anywhere in a value, including inside sentences", () => {
    const found = findAbsolutePaths({
      a: "/Users/someone/secret/file.ts",
      b: ["see C:\\x\\y for details", "and \\\\server\\share\\z"],
      c: "Fixed (/home/me/repo/x.py) yesterday",
      d: "/private/var/folders/ab/T/x",
    });
    expect(found).toEqual(["/Users/someone/secret/file.ts", "C:\\x\\y", "\\\\server\\share\\z", "/home/me/repo/x.py", "/private/var/folders/ab/T/x"]);
  });

  it("does not flag URLs, home-relative paths or API routes", () => {
    expect(findAbsolutePaths(["https://github.com/Users/x", "~/Projects/x", "/v1/sync/objects", "src/app.ts", "a/b"])).toEqual([]);
  });

  it("redacts paths inside text and keeps the rest of the sentence", () => {
    const { value, dropped } = scrubAbsolutePaths({ description: "Broken in /Users/me/app/x.ts since Monday", n: 3 });
    expect(value).toEqual({ description: "Broken in [path] since Monday", n: 3 });
    expect(dropped).toBe(1);
  });
});

describe("path map", () => {
  it("remembers where each project lives on this computer", () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-paths-"));
    const map = createPathMap({ userDataPath });
    map.set("github.com/o/shop", "/Users/a/Projects/shop");
    const again = createPathMap({ userDataPath });
    expect(again.get("github.com/o/shop")).toBe("/Users/a/Projects/shop");
    expect(again.keyForPath("/Users/a/Projects/shop/")).toBe("github.com/o/shop");
    expect(again.entries()).toEqual([["github.com/o/shop", "/Users/a/Projects/shop"]]);
  });

  it("puts new projects in the user's Projects folder", () => {
    expect(defaultProjectsRoot("darwin", { HOME: "/Users/a" })).toBe("/Users/a/Projects");
    expect(defaultProjectsRoot("win32", { USERPROFILE: "C:\\Users\\b" })).toBe("C:\\Users\\b\\Projects");
  });
});

describe("adoptForeignWorktreePath", () => {
  it("moves a worktree path saved under the other platform's app folder into this computer's worktrees", () => {
    const win = "C:\\Users\\brave\\AppData\\Roaming\\Pitwall\\worktrees";
    expect(adoptForeignWorktreePath("C:\\Users\\brave\\Library\\Application Support/braveli/worktrees/d8d1/claude-session-8", { worktreesRoot: win, platform: "win32" }))
      .toBe(path.win32.join(win, "d8d1", "claude-session-8"));
    const mac = "/Users/a/Library/Application Support/Pitwall/worktrees";
    expect(adoptForeignWorktreePath("/Users/a/AppData/Roaming/Pitwall/worktrees/d8d1/s", { worktreesRoot: mac, platform: "darwin" })).toBe(`${mac}/d8d1/s`);
  });

  it("leaves this platform's own paths and anything else alone", () => {
    const mac = "/Users/a/Library/Application Support/Pitwall/worktrees";
    expect(adoptForeignWorktreePath("/Users/a/Library/Application Support/braveli/worktrees/d8d1/s", { worktreesRoot: mac, platform: "darwin" })).toBe("/Users/a/Library/Application Support/braveli/worktrees/d8d1/s");
    expect(adoptForeignWorktreePath("C:\\Projects\\shop", { worktreesRoot: "C:\\w", platform: "win32" })).toBe("C:\\Projects\\shop");
    expect(adoptForeignWorktreePath("", { worktreesRoot: "C:\\w", platform: "win32" })).toBe("");
  });
});

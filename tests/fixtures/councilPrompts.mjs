import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

// A long council prompt is delivered as a file plus a short typed pointer, so a
// stub that logs its stdin sees only the pointer. Read it the way a member does.
const POINTER = /Your full instructions for this turn are in (\S+?\.md)\./g;

export async function expandPromptPointers(typed, root) {
  let expanded = typed;
  for (const [pointer, relative] of typed.matchAll(POINTER)) {
    const found = spawnSync("find", [root, "-path", `*/${relative}`], { encoding: "utf8" }).stdout.split("\n").find(Boolean);
    const content = found ? await readFile(found, "utf8").catch(() => "") : "";
    expanded = expanded.replace(pointer, `${pointer}\n${content}`);
  }
  return expanded;
}

/** The full prompt a typed pointer stands for, read relative to the agent's cwd. */
export async function readPointedPrompt(typed, cwd) {
  const match = /Your full instructions for this turn are in (\S+?\.md)\./.exec(typed);
  if (!match) return null;
  return readFile(path.join(cwd, match[1]), "utf8").catch(() => null);
}

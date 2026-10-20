// Real Codex: a conversation started in one folder is moved the way Pitwall
// Cloud moves it, then resumed in another folder. Uses the installed `codex`
// and its login (two very short prompts).
//   node tests/bench/cloud-codex-resume.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { locateTranscript, transplant } = require("../../electron/lib/cloud/transcripts.cjs");

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pitwall-codex-resume-")));
const here = path.join(root, "laptop", "shop");
const there = path.join(root, "desktop", "projects", "shop");
for (const dir of [here, there]) execFileSync("mkdir", ["-p", dir]);
const word = `HERON${Math.floor(Math.random() * 900 + 100)}`;
const codex = (cwd, args) => execFileSync("codex", ["exec", "--skip-git-repo-check", ...args], { cwd, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] });
let id = null;
let moved = [];
try {
  const first = codex(here, [`Remember this word for later: ${word}. Reply with just OK.`]);
  const sessions = path.join(os.homedir(), ".codex", "sessions");
  // The newest rollout whose working directory is `here` is the one just made.
  const newest = execFileSync("bash", ["-c", `grep -rl --include='rollout-*.jsonl' '"cwd":"${here}"' '${sessions}' | xargs ls -t | head -1`], { encoding: "utf8" }).trim();
  id = newest.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/)?.[1];
  assert.ok(id, `found the conversation (${first.trim().split("\n").at(-1)})`);
  const found = locateTranscript({ cli: "codex", nativeId: id, home: os.homedir() });
  console.log(`found Codex ${found.version} conversation in ${found.cwd}`);
  // Move it out of the way first, as if this were another computer that never had it.
  const original = found.files[0].abs;
  const bytes = readFileSync(original);
  rmSync(original);
  const result = transplant({ cli: "codex", version: found.version, files: [{ rel: found.files[0].rel, bytes }], from: found.cwd, to: there, home: os.homedir() });
  assert.equal(result.ok, true, JSON.stringify(result));
  moved = result.written;
  const answer = codex(there, ["resume", id, "What word did I ask you to remember? Reply with just the word."]);
  assert.match(answer, new RegExp(word));
  console.log(`answer in the other folder: ${word}`);
  console.log("PASS a real Codex conversation resumes after being moved to another folder");
} finally {
  for (const file of moved) rmSync(file, { force: true });
  if (id) {
    const left = locateTranscript({ cli: "codex", nativeId: id, home: os.homedir() });
    for (const file of left?.files || []) rmSync(file.abs, { force: true });
  }
  rmSync(root, { recursive: true, force: true });
}

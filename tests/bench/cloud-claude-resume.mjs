// Real Claude Code: a conversation started in one folder is moved the way
// Pitwall Cloud moves it to another computer, then resumed in another folder.
// Uses the installed `claude` and its login (two very short prompts).
//   node tests/bench/cloud-claude-resume.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { locateTranscript, transplant } = require("../../electron/lib/cloud/transcripts.cjs");

const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pitwall-claude-resume-")));
const here = path.join(root, "laptop", "shop");
const there = path.join(root, "desktop", "projects", "shop");
for (const dir of [here, there]) execFileSync("mkdir", ["-p", dir]);
const id = randomUUID();
const word = `PELICAN${Math.floor(Math.random() * 900 + 100)}`;
const claude = (cwd, args) => execFileSync("claude", ["-p", ...args], { cwd, encoding: "utf8", timeout: 180_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
let moved = [];
try {
  console.log(claude(here, ["--session-id", id, `Remember this word for later: ${word}. Reply with just OK.`]));
  const found = locateTranscript({ cli: "claude", nativeId: id, home: os.homedir() });
  assert.ok(found, "the conversation is where Claude keeps it");
  console.log(`found Claude ${found.version} conversation in ${found.cwd}`);
  const files = found.files.map((file) => ({ rel: file.rel, bytes: readFileSync(file.abs) }));
  const result = transplant({ cli: "claude", version: found.version, files, from: found.cwd, to: there, home: os.homedir() });
  assert.equal(result.ok, true, JSON.stringify(result));
  moved = result.written;
  const answer = claude(there, ["--resume", id, "What word did I ask you to remember? Reply with just the word."]);
  console.log(`answer in the other folder: ${answer}`);
  assert.match(answer, new RegExp(word));
  console.log("PASS a real Claude Code conversation resumes after being moved to another folder");
} finally {
  // Only what this bench created: both copies of its one conversation.
  const original = locateTranscript({ cli: "claude", nativeId: id, home: os.homedir() });
  for (const file of [...moved, ...(original?.files || []).map((entry) => entry.abs)]) rmSync(file, { force: true });
  rmSync(root, { recursive: true, force: true });
}

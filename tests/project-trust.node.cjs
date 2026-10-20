const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ensureClaudeTrust, ensureCodexTrust, ensureClaudeBypassAccepted } = require("../electron/lib/projectTrust.cjs");

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "braveli-trust-test-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test("concurrent Claude trust merges every project and keeps config/backup private", async (t) => {
  const home = fixture(t);
  const file = path.join(home, ".claude.json");
  fs.writeFileSync(file, JSON.stringify({ projects: {}, preference: "keep" }), { mode: 0o600 });
  const results = await Promise.all(Array.from({ length: 24 }, (_, i) => ensureClaudeTrust(`/project/${i}`, home)));
  assert.equal(results.every((result) => result.ok && result.trusted), true);
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(Object.keys(config.projects).length, 24);
  assert.equal(config.preference, "keep");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${file}.braveli.bak`).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(home).sort(), [".claude.json", ".claude.json.braveli.bak"]);
});

test("Codex trust updates existing trust level and preserves concurrent sections", async (t) => {
  const home = fixture(t);
  const file = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '[projects."/project/a"]\ntrust_level = "untrusted"\nother = true\n');
  const results = await Promise.all([ensureCodexTrust("/project/a", home), ensureCodexTrust('/project/"b"', home)]);
  assert.equal(results.every((result) => result.ok), true);
  const config = fs.readFileSync(file, "utf8");
  assert.equal((config.match(/trust_level = "trusted"/g) || []).length, 2);
  assert.equal(config.includes('"untrusted"'), false);
  assert.equal(config.includes("other = true"), true);
  assert.equal(config.includes('[projects."/project/\\"b\\""]'), true);
});

test("invalid provider settings are preserved instead of overwritten", async (t) => {
  const home = fixture(t);
  fs.writeFileSync(path.join(home, ".claude.json"), "broken {");
  assert.equal((await ensureClaudeTrust("/project", home)).ok, false);
  assert.equal(fs.readFileSync(path.join(home, ".claude.json"), "utf8"), "broken {");
  fs.mkdirSync(path.join(home, ".claude"));
  const file = path.join(home, ".claude", "settings.local.json");
  fs.writeFileSync(file, "broken {");
  await assert.rejects(ensureClaudeBypassAccepted(home));
  assert.equal(fs.readFileSync(file, "utf8"), "broken {");
});

test("existing trusted config and backups from older releases are made private", async (t) => {
  const home = fixture(t);
  const file = path.join(home, ".claude.json");
  const content = JSON.stringify({ projects: { "/project": { hasTrustDialogAccepted: true } } });
  fs.writeFileSync(file, content, { mode: 0o644 });
  fs.writeFileSync(`${file}.braveli.bak`, content, { mode: 0o644 });
  assert.equal((await ensureClaudeTrust("/project", home)).changed, false);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(`${file}.braveli.bak`).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(file, "utf8"), content);
});

/**
 * What the analytics module promises, and whether the app keeps it.
 *
 * Two different guarantees are checked here, and the second is the one that
 * failed silently for months.
 *
 * 1. Nothing leaves that could identify a person or a codebase. The module
 *    allowlists event names and property keys, and now clamps string *values*
 *    too — `agent` used to be whatever the call site had, and an agent added
 *    through "Add agent" is named by the person adding it.
 *
 * 2. Every allowlisted event is actually fired somewhere. Half of them never
 *    were: the list read like a description of what the product measured, and
 *    measured none of it. An allowlist entry with no call site is not a plan,
 *    it is a false claim about what is known.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createAnalytics, EVENTS, PROPERTIES } = require(path.join(root, "electron/lib/analytics.cjs"));

// ── The wire ──────────────────────────────────────────────────────────────
const sent = [];
const analytics = createAnalytics({
  filePath: "",
  apiKey: "phc_test",
  host: "https://example.invalid",
  appVersion: "9.9.9",
  osVersion: "darwin test",
  fetchImpl: async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true };
  },
});

// Reporting is on unless turned off, as the privacy policy describes.
assert.equal(analytics.isEnabled(), true);
assert.equal(await analytics.capture("app_launched"), true);
assert.equal(sent.length, 1);
sent.length = 0;
console.log("  OK  a new install reports, as the privacy policy says");

await analytics.capture("session_started", {
  agent: "Claude",
  // Everything below must be dropped or clamped.
  project_path: "/Users/someone/clients/acme-health/repo",
  task_title: "Fix the Acme billing bug",
  branch: "feature/acme-invoice",
  prompt: "here is our proprietary source",
});
const [body] = sent;
assert.deepEqual(Object.keys(body.properties).sort(), ["agent", "app_version", "os_version"]);
assert.equal(body.properties.agent, "claude");
const serialised = JSON.stringify(body);
for (const leak of ["acme", "someone", "billing", "proprietary", "feature/"]) {
  assert.ok(!serialised.toLowerCase().includes(leak), `"${leak}" reached the wire`);
}
console.log("  OK  unlisted properties never reach the wire");

// An agent somebody named themselves is content, and must not be sent as-is.
sent.length = 0;
await analytics.capture("session_started", { agent: "Acme Internal Agent" });
assert.equal(sent[0].properties.agent, "custom");
console.log("  OK  a user-named agent is reported as \"custom\", not by name");

// Enumerated values are clamped rather than passed through.
sent.length = 0;
await analytics.capture("agent_gate_hit", { gate_kind: "waiting on jane@acme.com" });
assert.equal(sent[0].properties.gate_kind, "other");
console.log("  OK  an unexpected enum value becomes \"other\"");

// An event not on the list is refused outright.
sent.length = 0;
assert.equal(await analytics.capture("prompt_text", { agent: "claude" }), false);
assert.equal(sent.length, 0);
console.log("  OK  an unlisted event is never sent");

// Opting out means opting out.
sent.length = 0;
analytics.setEnabled(false);
assert.equal(await analytics.capture("app_launched"), false);
assert.equal(sent.length, 0);
analytics.setEnabled(true);
console.log("  OK  disabling analytics stops every event");

// ── The call sites ────────────────────────────────────────────────────────
const sources = [
  path.join(root, "src/App.tsx"),
  path.join(root, "electron/main.cjs"),
  ...readdirSync(path.join(root, "src/components")).map((f) => path.join(root, "src/components", f)),
  ...readdirSync(path.join(root, "src/hooks")).map((f) => path.join(root, "src/hooks", f)),
].filter((f) => /\.(ts|tsx|cjs|mjs|js)$/.test(f));
const code = sources.map((f) => readFileSync(f, "utf8")).join("\n");

const unwired = [...EVENTS].filter((event) => !new RegExp(`["']${event}["']`).test(code));
assert.deepEqual(
  unwired,
  [],
  `allowlisted but never fired: ${unwired.join(", ")}\n` +
    "An event with no call site claims the product measures something it does not.",
);
console.log(`  OK  all ${EVENTS.size} allowlisted events have a call site`);

// A property nobody uses is a field waiting to be filled with the wrong thing.
const unused = [...PROPERTIES].filter(
  (prop) => !["app_version", "os_version"].includes(prop) && !new RegExp(`\\b${prop}\\b`).test(code),
);
assert.deepEqual(unused, [], `allowlisted but never set: ${unused.join(", ")}`);
console.log(`  OK  all ${PROPERTIES.size} allowlisted properties are used`);

console.log("Pitwall analytics smoke test passed.");

// ── Installs from when reporting shipped off ──────────────────────────────
{
  const { mkdtempSync, writeFileSync, readFileSync: read } = await import("node:fs");
  const os = await import("node:os");
  const dir = mkdtempSync(path.join(os.tmpdir(), "braveli-analytics-"));
  const never = path.join(dir, "never.json");
  writeFileSync(never, JSON.stringify({ installId: "a", enabled: false }));
  assert.equal(createAnalytics({ filePath: never, apiKey: "k" }).isEnabled(), true, "an install that never chose reports");
  const chose = path.join(dir, "chose.json");
  writeFileSync(chose, JSON.stringify({ installId: "b", enabled: false, decided: true }));
  assert.equal(createAnalytics({ filePath: chose, apiKey: "k" }).isEnabled(), false, "a choice to turn it off is kept");
  const toggled = createAnalytics({ filePath: never, apiKey: "k" });
  toggled.setEnabled(false);
  assert.equal(JSON.parse(read(never, "utf8")).decided, true);
  assert.equal(createAnalytics({ filePath: never, apiKey: "k" }).isEnabled(), false, "turning it off survives a restart");
  console.log("  OK  undecided installs report; turning it off is remembered");
}

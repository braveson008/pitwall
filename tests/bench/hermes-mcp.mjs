// Hermes's MCP servers managed from Pitwall: one added through Pitwall shows
// up in Hermes's own config and in Pitwall's list, and removing it takes it out
// of both. Uses the real `hermes`, which connects to the server when it is added,
// so this is a bench.
//   npm run build && HERMES_BENCH_HOME=/path/to/scratch-hermes-home node tests/bench/hermes-mcp.mjs
// HERMES_BENCH_HOME must sign in on its own (an API key in its .env). Never
// give it a copy of ~/.hermes/auth.json: Nous Portal refresh tokens are
// single-use, and a copy that refreshes signs the original out.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright";

const { hermesProfileName } = createRequire(import.meta.url)("../../electron/lib/hermesProfiles.cjs");

const hermesHome = process.env.HERMES_BENCH_HOME;
assert.ok(hermesHome, "set HERMES_BENCH_HOME to a disposable, already-initialised Hermes home");
const temp = await mkdtemp(path.join(os.tmpdir(), "braveli-hermes-mcp-"));
const projectId = "bench-mcp";
const profile = hermesProfileName(projectId);
const hermesServers = (inProfile = profile) => JSON.parse(execFileSync("hermes", [...(inProfile ? ["-p", inProfile] : []), "config", "get", "mcp_servers", "--json"], { env: { ...process.env, HERMES_HOME: hermesHome } }).toString() || "null") || {};

const app = await electron.launch({
  args: [process.cwd()],
  cwd: process.cwd(),
  env: { ...process.env, HERMES_HOME: hermesHome, BRAVELI_E2E: "1", BRAVELI_USER_DATA_DIR: path.join(temp, "profile") },
});
try {
  const page = await app.firstWindow();
  await page.waitForTimeout(2500);
  const name = "braveli-bench-fs";
  const added = await page.evaluate((name) => window.braveli.addMcpServer({
    provider: "hermes", projectId: "bench-mcp", projectPath: "/tmp", name, transport: "stdio",
    target: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], env: [], headers: [],
  }), name).catch((error) => ({ ok: false, error: String(error) }));
  assert.ok(added.ok, `added through Pitwall: ${added.error || added.message}`);
  assert.deepEqual(hermesServers()[name]?.args, ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], "Hermes's own config has it");
  assert.equal(hermesServers("")[name], undefined, "the main Hermes profile does not get it");
  console.log("PASS a server added in Pitwall is in the project's Hermes profile only, with its arguments intact");

  const listed = await page.evaluate(() => window.braveli.listMcpServers({ provider: "hermes", projectId: "bench-mcp", projectPath: "/tmp" }));
  assert.ok(listed.servers.some((server) => server.name === name && server.target.endsWith("/tmp")), "Pitwall lists it in full");
  console.log("PASS Pitwall lists Hermes's servers in full");

  const removed = await page.evaluate((name) => window.braveli.removeMcpServer({ provider: "hermes", projectId: "bench-mcp", projectPath: "/tmp", name }), name);
  assert.ok(removed.ok, `removed: ${removed.error || removed.message}`);
  assert.equal(hermesServers()[name], undefined, "gone from Hermes's config");
  console.log("PASS removing it in Pitwall removes it from Hermes");
} finally {
  await app.close();
}
console.log("Pitwall Hermes MCP bench passed.");

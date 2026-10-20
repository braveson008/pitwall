import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getProviderCompatibility, parseCliVersion } = require("../electron/lib/providerCompatibility.cjs");

const providers = [
  { id: "claude", command: "claude", requiredHelp: /--settings\b/ },
  { id: "codex", command: "codex", requiredHelp: /(?:^|\s)(?:-c|--config)(?:\s|,|$)/m },
  { id: "gemini", command: "gemini" },
  { id: "grok", command: "grok" },
  { id: "kimi", command: "kimi", requiredHelp: /--config-file\b/ },
];
const required = new Set((process.env.PITWALL_REQUIRE_PROVIDERS || "").split(",").map((item) => item.trim()).filter(Boolean));

function shell(command) {
  return execFileSync(process.env.SHELL || "/bin/zsh", ["-lc", command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

for (const provider of providers) {
  let executable = "";
  try {
    executable = shell(`command -v ${provider.command}`);
  } catch {
    if (required.has(provider.id)) throw new Error(`${provider.command} is required but was not found on PATH`);
    process.stdout.write(`  SKIP  ${provider.id}: CLI not installed\n`);
    continue;
  }

  const versionRun = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(versionRun.error, undefined, `${provider.command} --version failed to start`);
  const rawVersion = `${versionRun.stdout || ""}\n${versionRun.stderr || ""}`;
  const version = parseCliVersion(rawVersion);
  assert.ok(version, `${provider.command} did not expose a semantic version: ${rawVersion.trim()}`);
  const capability = getProviderCompatibility(provider.id, version, true);
  assert.notEqual(capability.completionMode, "unavailable");

  if (capability.completionMode === "native" && provider.requiredHelp) {
    const help = spawnSync(executable, ["--help"], { encoding: "utf8", timeout: 10_000 });
    assert.equal(help.error, undefined, `${provider.command} --help failed to start`);
    assert.match(`${help.stdout || ""}\n${help.stderr || ""}`, provider.requiredHelp, `${provider.command} ${version} lacks the launch option used by Pitwall`);
  }
  process.stdout.write(`  OK  ${provider.id} ${version}: ${capability.completionMode} completion\n`);
}

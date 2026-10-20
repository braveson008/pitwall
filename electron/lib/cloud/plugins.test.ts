import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import pluginsModule from "./plugins.cjs";

const { createPluginSync, readClaudePlugins } = pluginsModule;
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-plugins-"));

function computer(deviceId: string, installed: { claude: string[]; codex: string[] }) {
  const installs: string[] = [];
  const sync = createPluginSync({
    deviceId: () => deviceId,
    statePath: path.join(temp(), "plugins.json"),
    readClaude: async () => installed.claude.map((id) => ({ id, marketplace: { name: id.split("@")[1], source: { source: "github", repo: `acme/${id.split("@")[1]}` } } })),
    readCodex: async () => installed.codex.map((id) => ({ id })),
    install: async (provider: string, plugin: { id: string }) => {
      installs.push(`${provider}:${plugin.id}`);
      installed[provider as "claude" | "codex"].push(plugin.id);
      return { ok: true };
    },
  });
  return { sync, installs, installed };
}

describe("plugins follow you", () => {
  it("installs on this computer what another computer installed, once", async () => {
    const mac = computer("mac", { claude: ["warp@claude-code-warp", "skills@karpathy"], codex: ["pages@openai-curated"] });
    const pc = computer("pc", { claude: ["skills@karpathy"], codex: [] });
    const records = await mac.sync.records();
    expect(records.map((record: { localId: string }) => record.localId).sort()).toEqual(["claude:mac", "codex:mac"]);
    await pc.sync.apply(records);
    expect(pc.installs.sort()).toEqual(["claude:warp@claude-code-warp", "codex:pages@openai-curated"]);
    await pc.sync.apply(records);
    expect(pc.installs).toHaveLength(2);
  });

  it("doesn't bring back a plugin someone removed here", async () => {
    const mac = computer("mac", { claude: ["warp@claude-code-warp"], codex: [] });
    const pc = computer("pc", { claude: [], codex: [] });
    await pc.sync.apply(await mac.sync.records());
    pc.installed.claude = [];
    await pc.sync.apply(await mac.sync.records());
    expect(pc.installs).toEqual(["claude:warp@claude-code-warp"]);
  });

  it("ignores this computer's own list", async () => {
    const mac = computer("mac", { claude: ["warp@claude-code-warp"], codex: [] });
    await mac.sync.apply(await mac.sync.records());
    expect(mac.installs).toEqual([]);
  });

  it("reads Claude Code's installed plugins with the marketplace each came from", () => {
    const home = temp();
    const dir = path.join(home, ".claude", "plugins");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "warp@claude-code-warp": [{ scope: "user" }], "local@proj": [{ scope: "project" }] } }));
    fs.writeFileSync(path.join(dir, "known_marketplaces.json"), JSON.stringify({ "claude-code-warp": { source: { source: "github", repo: "warpdotdev/claude-code-warp" }, installLocation: "/Users/x" } }));
    expect(readClaudePlugins(home)).toEqual([{ id: "warp@claude-code-warp", marketplace: { name: "claude-code-warp", source: { source: "github", repo: "warpdotdev/claude-code-warp" } } }]);
  });
});

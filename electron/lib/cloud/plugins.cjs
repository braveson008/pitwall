"use strict";
/**
 * Agent plugins (and the skills inside them) that follow you.
 *
 * Each computer publishes the plugins its agent CLIs have installed, one
 * record per CLI and computer. Another computer installs, through the CLI's
 * own `plugin install`, anything on those lists it hasn't seen before. What it
 * has seen is remembered, so a plugin removed on one computer is not
 * reinstalled there because another still has it.
 */
const fs = require("node:fs");
const path = require("node:path");

const PROVIDERS = ["claude", "codex"];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Claude Code's own record of installed plugins, and where each one's marketplace lives. */
function readClaudePlugins(home) {
  const installed = readJson(path.join(home, ".claude", "plugins", "installed_plugins.json"))?.plugins || {};
  const marketplaces = readJson(path.join(home, ".claude", "plugins", "known_marketplaces.json")) || {};
  const plugins = [];
  for (const [id, installs] of Object.entries(installed)) {
    // Project-scoped plugins come with their project; only the person's own follow them.
    if (!Array.isArray(installs) || !installs.some((install) => install?.scope === "user")) continue;
    const name = id.split("@")[1] || "";
    const source = marketplaces[name]?.source;
    plugins.push({ id, marketplace: { name, source: source && source.source !== "directory" ? source : null } });
  }
  return plugins;
}

/** Codex's installed plugins, less the ones it installs for everyone anyway. */
function parseCodexPlugins(payload) {
  return (payload?.installed || [])
    .filter((plugin) => plugin?.pluginId && plugin.installPolicy !== "INSTALLED_BY_DEFAULT")
    .map((plugin) => ({ id: plugin.pluginId }));
}

function createPluginSync({ deviceId, statePath, readClaude, readCodex, install, log = () => {} }) {
  let state = { seen: {}, others: {}, ...(readJson(statePath) || {}) };
  const save = () => {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state));
  };
  const readers = { claude: readClaude, codex: readCodex };

  async function installedHere(provider) {
    return (await readers[provider]().catch(() => [])) || [];
  }

  return {
    async records() {
      const me = deviceId();
      if (!me) return [];
      const records = [];
      for (const provider of PROVIDERS) {
        const plugins = await installedHere(provider);
        if (plugins.length) records.push({ kind: "agentPlugins", localId: `${provider}:${me}`, data: { provider, device: me, plugins } });
      }
      return records;
    },
    /** Other computers' lists, kept as they arrived: they are theirs to change, not this computer's to delete. */
    otherRecords() {
      return Object.entries(state.others || {}).map(([localId, data]) => ({ kind: "agentPlugins", localId, data }));
    },
    async apply(changes) {
      const me = deviceId();
      for (const change of changes) {
        const data = change.data;
        if (change.localId && !String(change.localId).endsWith(`:${me}`)) {
          if (data) state.others[change.localId] = data;
          else delete state.others[change.localId];
          save();
        }
        if (!data?.plugins || !PROVIDERS.includes(data.provider) || data.device === me) continue;
        const provider = data.provider;
        const here = new Set((await installedHere(provider)).map((plugin) => plugin.id));
        const seen = new Set(state.seen[provider] || []);
        // What is already here counts as seen, so removing it later is respected.
        for (const id of here) seen.add(id);
        for (const plugin of data.plugins) {
          if (seen.has(plugin.id)) continue;
          seen.add(plugin.id);
          const result = await install(provider, plugin).catch((error) => ({ ok: false, error: error.message }));
          if (!result?.ok) log(`cloud: couldn't install ${provider} plugin ${plugin.id}: ${result?.error || "unknown"}`);
        }
        state.seen[provider] = [...seen];
        save();
      }
    },
  };
}

module.exports = { createPluginSync, parseCodexPlugins, readClaudePlugins };

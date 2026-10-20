// Pure shaping for what an agent CLI can install: plugins, the skills inside
// them, and the MCP servers they bring. Dependency-free so it can be unit
// tested without booting Electron.
//
// Both supported CLIs model this the same way and it is worth being explicit
// about it, because the UI would otherwise imply something false: a skill is
// not an installable thing. Skills ship *inside* plugins, and installing a
// skill means installing the plugin that carries it. Searching by skill is
// still the useful way in — you know you want something for Figma long before
// you know which plugin provides it — so the skills view is a search across
// plugin contents, not a second catalogue.

/** Everything a plugin can contribute, in the order the UI lists them. */
const COMPONENT_KINDS = ["skills", "commands", "agents", "mcpServers", "hooks", "lspServers"];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

/** `name@marketplace` → its two halves, tolerating an id with no marketplace. */
function splitPluginId(pluginId) {
  const id = text(pluginId, 400);
  const at = id.lastIndexOf("@");
  if (at <= 0) return { name: id, marketplace: "" };
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

/**
 * `claude plugin list --available --json`, normalised.
 *
 * The two halves describe the same things differently — an installed entry has
 * an install path and no description, an available one has a description and no
 * install state — so they are merged into one row per plugin with `installed`
 * as a field rather than as which list it came from. Otherwise the UI has to
 * ask two questions to render one row.
 */
function parseClaudePlugins(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const byId = new Map();

  for (const entry of asArray(source.available)) {
    const pluginId = text(entry?.pluginId) || text(entry?.name);
    if (!pluginId) continue;
    const { name, marketplace } = splitPluginId(pluginId);
    byId.set(pluginId, {
      pluginId,
      name: text(entry?.name) || name,
      marketplace: text(entry?.marketplaceName) || marketplace,
      description: text(entry?.description),
      version: text(entry?.version, 100),
      installs: Number.isFinite(entry?.installCount) ? Number(entry.installCount) : null,
      installed: false,
      enabled: false,
    });
  }

  for (const entry of asArray(source.installed)) {
    const pluginId = text(entry?.id) || text(entry?.pluginId);
    if (!pluginId) continue;
    const { name, marketplace } = splitPluginId(pluginId);
    const existing = byId.get(pluginId) ?? {
      pluginId,
      name,
      marketplace,
      description: "",
      version: "",
      installs: null,
    };
    byId.set(pluginId, {
      ...existing,
      // An installed plugin's own version is the one on disk, which is the one
      // that matters; the marketplace's is what an upgrade would bring.
      version: text(entry?.version, 100) || existing.version,
      installed: true,
      enabled: entry?.enabled !== false,
      // Kept so a plugin the catalogue has never heard of — anything from a
      // third-party marketplace — can still be read from its own manifest.
      installPath: text(entry?.installPath, 1000),
    });
  }

  return Array.from(byId.values());
}

/**
 * `codex plugin list --json`, normalised to the same row.
 *
 * Codex reports one list with `installed` as a field on each entry, and adds an
 * install policy — some catalogue entries cannot be installed from here at all,
 * and a button that fails is worse than one that is not offered.
 */
function parseCodexPlugins(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const entries = Array.isArray(source) ? source : [...asArray(source.installed), ...asArray(source.available)];
  const byId = new Map();

  for (const entry of entries) {
    const pluginId = text(entry?.pluginId) || text(entry?.name);
    if (!pluginId) continue;
    const { name, marketplace } = splitPluginId(pluginId);
    const installed = Boolean(entry?.installed) || byId.get(pluginId)?.installed === true;
    byId.set(pluginId, {
      pluginId,
      name: text(entry?.name) || name,
      marketplace: text(entry?.marketplaceName) || marketplace,
      description: text(entry?.description),
      category: text(entry?.category, 100),
      version: text(entry?.version, 100),
      installs: null,
      installed,
      enabled: entry?.enabled !== false && installed,
      installable: text(entry?.installPolicy, 60).toUpperCase() !== "UNAVAILABLE",
      needsAuth: text(entry?.authPolicy, 60).toUpperCase() === "ON_INSTALL",
      installPath: text(entry?.source?.path, 1000),
    });
  }

  return Array.from(byId.values());
}

/**
 * Folds Claude's catalogue cache into the plugin rows.
 *
 * The CLI's own listing says what a plugin is but not what is in it. The cache
 * Claude Code writes beside it says exactly that — every skill, command and MCP
 * server, and what each costs in tokens — for plugins that are not installed as
 * well as those that are, which is the only way to answer "what would this cost
 * me" before installing rather than after.
 *
 * Enrichment only. A missing or stale cache costs component counts and token
 * figures, never the catalogue itself.
 */
function enrichWithCatalog(plugins, catalog) {
  const entries = catalog?.catalog?.plugins ?? catalog?.plugins ?? null;
  if (!entries || typeof entries !== "object") return asArray(plugins).map((plugin) => ({ ...plugin }));

  return asArray(plugins).map((plugin) => {
    const entry = entries[plugin.name] ?? entries[plugin.pluginId];
    if (!entry) return { ...plugin };

    const components = {};
    for (const kind of COMPONENT_KINDS) {
      components[kind] = asArray(entry?.components?.[kind])
        .map((item) => (typeof item === "string" ? { name: item } : item))
        .filter((item) => text(item?.name))
        .map((item) => ({
          name: text(item.name, 200),
          alwaysOn: Number.isFinite(item?.chars?.always_on) ? Number(item.chars.always_on) : null,
          onInvoke: Number.isFinite(item?.chars?.on_invoke) ? Number(item.chars.on_invoke) : null,
        }));
    }

    return {
      ...plugin,
      description: plugin.description || text(entry?.marketplace_entry?.description),
      author: text(entry?.marketplace_entry?.author?.name, 200),
      installs: plugin.installs ?? (Number.isFinite(entry?.unique_installs) ? Number(entry.unique_installs) : null),
      tokens: pickTokenCost(entry?.tokens),
      components,
    };
  });
}

/**
 * One always-on/on-invoke pair from the per-model table.
 *
 * The cache reports a figure per model and they differ by a third or more. The
 * largest is the honest one to show: it is what the plugin can cost, and a
 * number that turns out to have been the best case is worse than no number.
 */
function pickTokenCost(tokens) {
  if (!tokens || typeof tokens !== "object") return null;
  let alwaysOn = null;
  let onInvoke = null;
  for (const value of Object.values(tokens)) {
    if (Number.isFinite(value?.always_on)) alwaysOn = Math.max(alwaysOn ?? 0, Number(value.always_on));
    if (Number.isFinite(value?.on_invoke)) onInvoke = Math.max(onInvoke ?? 0, Number(value.on_invoke));
  }
  return alwaysOn === null && onInvoke === null ? null : { alwaysOn, onInvoke };
}

/**
 * Every skill in the catalogue, as its own row, carrying the plugin it needs.
 *
 * A skill row is a way to find a plugin, so it says which one outright — the
 * install button on a skill installs its plugin, and pretending otherwise would
 * leave people wondering why installing one skill brought eleven more.
 */
function flattenSkills(plugins) {
  const rows = [];
  for (const plugin of asArray(plugins)) {
    for (const skill of asArray(plugin.components?.skills)) {
      rows.push({
        name: skill.name,
        pluginId: plugin.pluginId,
        pluginName: plugin.name,
        marketplace: plugin.marketplace,
        installed: Boolean(plugin.installed),
        enabled: Boolean(plugin.enabled),
        alwaysOn: skill.alwaysOn ?? null,
        onInvoke: skill.onInvoke ?? null,
        siblings: asArray(plugin.components?.skills).length,
      });
    }
  }
  return rows;
}

/** Every MCP server a plugin would bring, as its own row. */
function flattenPluginMcpServers(plugins) {
  const rows = [];
  for (const plugin of asArray(plugins)) {
    for (const server of asArray(plugin.components?.mcpServers)) {
      rows.push({
        name: server.name,
        pluginId: plugin.pluginId,
        pluginName: plugin.name,
        marketplace: plugin.marketplace,
        installed: Boolean(plugin.installed),
        viaPlugin: true,
      });
    }
  }
  return rows;
}

/**
 * A Codex plugin, filled in from its own manifest.
 *
 * `codex plugin list --json` reports a name, a version and whether it is
 * installed — and nothing about what the thing *is*. Every card said "No
 * description published" and the Skills tab was empty, for a catalogue of a
 * hundred and eighty plugins that between them carry hundreds of skills.
 *
 * All of it is on disk. The marketplace snapshot is local, so each entry —
 * installed or not — has a `.codex-plugin/plugin.json` beside a `skills/`
 * directory and an `.mcp.json`. This shapes what was read there into the same
 * row Claude's catalogue produces, so one card renders both.
 */
function codexPluginDetails(manifest, { skills = [], mcpServers = [] } = {}) {
  const source = manifest && typeof manifest === "object" ? manifest : {};
  const face = source.interface && typeof source.interface === "object" ? source.interface : {};

  return {
    // The display name is what a person calls it: "Google Calendar", not
    // "google-calendar".
    title: text(face.displayName, 200),
    // Short first: the long one runs to a paragraph, and the card has three
    // lines.
    description: text(face.shortDescription, 600) || text(source.description, 600),
    author: text(source.author?.name, 200),
    homepage: text(source.homepage, 1000),
    components: {
      skills: asArray(skills).map((name) => ({ name: text(name, 200), alwaysOn: null, onInvoke: null })).filter((item) => item.name),
      mcpServers: asArray(mcpServers).map((name) => ({ name: text(name, 200), alwaysOn: null, onInvoke: null })).filter((item) => item.name),
      commands: [],
      agents: [],
      hooks: [],
      lspServers: [],
    },
  };
}

/**
 * Merges what was read off disk onto the rows the CLI reported.
 *
 * Used for both agents. Codex publishes no catalogue at all, and Claude's
 * covers only the marketplaces Anthropic curates — a plugin installed from
 * anyone else's had no description and no inventory, and read as an empty card
 * beside full ones.
 *
 * Never overwrites what a catalogue already said: this fills gaps.
 */
function enrichCodexPlugins(plugins, detailsByPluginId) {
  const details = detailsByPluginId instanceof Map ? detailsByPluginId : new Map(Object.entries(detailsByPluginId ?? {}));
  return asArray(plugins).map((plugin) => {
    const extra = details.get(plugin.pluginId);
    if (!extra) return { ...plugin };
    return {
      ...plugin,
      // The CLI's name is the identifier; the manifest's is the one to read.
      name: extra.title || plugin.name,
      description: plugin.description || extra.description,
      author: plugin.author || extra.author,
      // Only when the catalogue gave none: its inventory carries token costs
      // that a bare manifest cannot.
      components: plugin.components ?? extra.components,
    };
  });
}

/**
 * Orders a catalogue for someone who does not know what they are looking for.
 *
 * Installed first, because the question "what do I already have" is asked more
 * often than "what else is there". Then by how many people use it: with 346
 * plugins and no opinion of our own about which are good, install count is the
 * only signal available that is not alphabetical accident.
 */
function orderForBrowsing(rows) {
  return [...asArray(rows)].sort(
    (a, b) =>
      Number(Boolean(b.installed)) - Number(Boolean(a.installed)) ||
      (b.installs ?? -1) - (a.installs ?? -1) ||
      String(a.name || "").localeCompare(String(b.name || "")),
  );
}

/**
 * Filters a catalogue by what someone typed.
 *
 * Matches the name, the description and — for a skill — the plugin carrying it,
 * because "figma" should find `figma-use` whether that word is in the skill's
 * name or only in the plugin's.
 */
function matchesQuery(row, query) {
  const needle = text(query, 200).toLowerCase();
  if (!needle) return true;
  const haystack = [row?.name, row?.description, row?.pluginName, row?.marketplace, row?.author, row?.category]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

module.exports = {
  COMPONENT_KINDS,
  codexPluginDetails,
  enrichCodexPlugins,
  splitPluginId,
  parseClaudePlugins,
  parseCodexPlugins,
  enrichWithCatalog,
  pickTokenCost,
  flattenSkills,
  flattenPluginMcpServers,
  orderForBrowsing,
  matchesQuery,
};

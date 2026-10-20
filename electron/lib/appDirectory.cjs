/**
 * Turns the name of an app into the ways Pitwall can actually reach it.
 *
 * ## The problem this solves
 *
 * "Pick up my latest Linear ticket" and "pick up my latest Jira ticket" are the
 * same request. Writing one integration per tracker means the assistant only
 * knows the apps someone remembered to teach it, and the list is stale the day
 * it ships. What generalises is not the integration — it is the *resolution*:
 * given a name a person said, work out at runtime which channels exist.
 *
 * Three channels, in the order they are worth trying:
 *
 *   1. **MCP** — a configured server for that app. Structured, typed, and the
 *      only channel that can answer a question rather than just open a window.
 *   2. **App** — the app is installed on this Mac. Pitwall can open it and read
 *      the screen; it cannot query it.
 *   3. **Web** — a known site. Pitwall can open the page and nothing more.
 *
 * The ranking is not a preference, it is a capability ordering: each channel
 * down the list can do strictly less than the one above it.
 *
 * ## Why this refuses rather than guesses
 *
 * Resolution returns null when nothing matches well. An assistant that opens
 * the wrong app on an ambiguous name is worse than one that asks, because the
 * user has to notice the mistake before they can correct it. `matchApplication`
 * in osControl.cjs already takes this position for launching; this module keeps
 * it for everything else.
 */

/** Channels a resolved app can be reached through, best first. */
const CHANNEL_RANK = { mcp: 0, app: 1, web: 2 };

function squash(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Does an MCP server belong to the app the user named?
 *
 * Server names are chosen by whoever configured them, so they range from
 * "linear" to "plugin:figma:figma" to "atlassian-prod". Matching on the squashed
 * substring in either direction covers those without inventing a registry that
 * would need maintaining.
 */
function mcpServerMatches(serverName, wanted) {
  const key = squash(serverName);
  if (!key || !wanted) return false;
  if (key === wanted) return true;
  // "plugin:figma:figma" contains "figma"; "atlassian" is contained by nothing
  // the user would say, which is what the alias table below is for.
  return key.includes(wanted) || wanted.includes(key);
}

/**
 * Names people say for a product versus the name its MCP server or app bundle
 * actually uses. Kept deliberately short: this is for cases where the two
 * genuinely differ, not a catalogue of every tool in existence.
 */
const PRODUCT_ALIASES = {
  jira: ["jira", "atlassian"],
  confluence: ["confluence", "atlassian"],
  linear: ["linear"],
  figma: ["figma"],
  github: ["github", "gh"],
  gitlab: ["gitlab"],
  notion: ["notion"],
  slack: ["slack"],
  asana: ["asana"],
  trello: ["trello", "atlassian"],
  sentry: ["sentry"],
};

function aliasesFor(wanted) {
  return PRODUCT_ALIASES[wanted] || [wanted];
}

/**
 * Resolve a spoken app name into every channel currently available for it.
 *
 * Everything is injected — the MCP list, the installed apps, the site table —
 * so this stays pure and testable, and so "what is available" is always read
 * live rather than cached into a constant.
 *
 * @returns {{name: string, channels: Array<object>}|null}
 */
function resolveApp(spoken, options = {}) {
  const { mcpServers = [], installedApps = [], sites = {}, matchApplication } = options;

  const wanted = squash(spoken);
  if (!wanted) return null;

  const names = aliasesFor(wanted);
  const channels = [];

  // 1. MCP — only servers that are actually up. A configured-but-failed server
  //    is not a channel; offering it would produce a request that hangs.
  for (const server of mcpServers) {
    if (!names.some((name) => mcpServerMatches(server.name, squash(name)))) continue;
    channels.push({
      kind: "mcp",
      server: server.name,
      status: server.status,
      transport: server.transport || "",
      usable: server.status === "connected",
    });
  }

  // 2. Installed application.
  if (typeof matchApplication === "function" && installedApps.length) {
    for (const name of names) {
      const hit = matchApplication(name, installedApps);
      if (hit) {
        channels.push({ kind: "app", app: hit, usable: true });
        break;
      }
    }
  }

  // 3. A site we know the address of.
  for (const name of names) {
    const url = sites[squash(name)];
    if (url) {
      channels.push({ kind: "web", url, usable: true });
      break;
    }
  }

  if (!channels.length) return null;

  channels.sort((a, b) => CHANNEL_RANK[a.kind] - CHANNEL_RANK[b.kind]);
  return { name: String(spoken).trim(), channels };
}

/**
 * The channel to actually use: the most capable one that is currently working.
 *
 * A connected MCP server beats an installed app; a *failed* MCP server loses to
 * one, because "I can open Linear for you" is a real answer and "I tried to ask
 * Linear and it never replied" is not.
 */
function bestChannel(resolved) {
  if (!resolved) return null;
  return resolved.channels.find((channel) => channel.usable) || null;
}

/** A sentence explaining what Pitwall can and cannot do with this app. */
function describeReach(resolved) {
  if (!resolved) return "I don't know that app.";
  const channel = bestChannel(resolved);
  if (!channel) {
    const broken = resolved.channels.find((entry) => entry.kind === "mcp");
    return broken
      ? `${resolved.name} is connected but its server is ${broken.status}.`
      : `I can't reach ${resolved.name}.`;
  }
  if (channel.kind === "mcp") return `I can query ${resolved.name} directly.`;
  if (channel.kind === "app") return `I can open ${channel.app}, but I can't search inside it.`;
  return `I can open ${resolved.name} in the browser, but I can't search inside it.`;
}

module.exports = { resolveApp, bestChannel, describeReach, mcpServerMatches, PRODUCT_ALIASES };

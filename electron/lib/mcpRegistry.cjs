// Turning the public MCP registry into something a person can click Install on.
//
// Adding an MCP server meant knowing that it is `npx -y @scope/thing` rather
// than `uvx thing`, typing it into a form with four fields, and getting the
// transport right. That is a reasonable thing to ask of someone who already
// knows which server they want, and no help at all to anyone browsing.
//
// The registry at registry.modelcontextprotocol.io publishes what is needed to
// run each server. This shapes those entries into an install someone can press,
// per agent. Nothing here is invented: an entry Pitwall cannot build a command
// for is listed as not installable rather than guessed at.

/** Registries whose packages we know how to run. */
const RUNNERS = {
  npm: { command: "npx", lead: ["-y"] },
  pypi: { command: "uvx", lead: [] },
};

function text(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * The publisher, taken from the namespaced name.
 *
 * `io.github.microsoft/playwright-mcp` and `io.github.someone/playwright-mcp`
 * are different things by different people, and the registry ranks neither
 * above the other because it holds no popularity data at all. Who published it
 * is the only provenance signal there is, so it is shown rather than trimmed
 * off for tidiness.
 */
function splitServerName(name) {
  const full = text(name, 300);
  const slash = full.indexOf("/");
  if (slash <= 0) return { publisher: "", shortName: full };
  return { publisher: full.slice(0, slash), shortName: full.slice(slash + 1) };
}

/**
 * How to run one server, or null when we cannot say.
 *
 * Remotes win over packages: a hosted URL needs nothing installed and no
 * runtime present on the machine. Among packages, the first one we have a
 * runner for — `oci` entries are real but need Docker, which is a different
 * promise from "click Install".
 */
function resolveLaunch(server) {
  const remote = asArray(server?.remotes).find((item) => text(item?.url));
  if (remote) {
    const type = text(remote.type, 40).toLowerCase();
    return {
      kind: "remote",
      transport: type === "sse" ? "sse" : "http",
      url: text(remote.url, 1000),
    };
  }

  for (const pkg of asArray(server?.packages)) {
    const runner = RUNNERS[text(pkg?.registryType, 40).toLowerCase()];
    if (!runner) continue;
    const identifier = text(pkg?.identifier, 300);
    if (!identifier) continue;
    const version = text(pkg?.version, 100);
    return {
      kind: "package",
      transport: "stdio",
      command: runner.command,
      // Pinning the published version is the difference between installing what
      // the registry described and installing whatever was pushed since.
      args: [...runner.lead, version ? `${identifier}@${version}` : identifier],
      env: asArray(pkg?.environmentVariables)
        .map((item) => ({
          name: text(item?.name, 200),
          description: text(item?.description, 400),
          secret: Boolean(item?.isSecret),
        }))
        .filter((item) => item.name),
    };
  }

  return null;
}

/**
 * The registry's listing, reduced to one row per server.
 *
 * The API returns every version of every server as its own entry — one search
 * came back with the same server eleven times — so anything but the latest is
 * dropped, along with anything the registry has stopped listing as active.
 */
function normaliseRegistryServers(payload) {
  const byName = new Map();

  for (const entry of asArray(payload?.servers)) {
    const server = entry?.server;
    const meta = entry?._meta?.["io.modelcontextprotocol.registry/official"] ?? {};
    if (!server || meta.isLatest === false) continue;
    if (meta.status && meta.status !== "active") continue;

    const name = text(server.name, 300);
    if (!name || byName.has(name)) continue;

    const { publisher, shortName } = splitServerName(name);
    const launch = resolveLaunch(server);

    byName.set(name, {
      id: name,
      name: shortName,
      publisher,
      title: text(server.title, 200) || shortName,
      description: text(server.description, 600),
      version: text(server.version, 100),
      websiteUrl: text(server.websiteUrl, 1000),
      launch,
      // Said outright rather than shown as a button that fails. An `oci` server
      // is a real server we have no business pretending to install.
      installable: Boolean(launch),
      needsEnv: asArray(launch?.env).length > 0,
    });
  }

  return [...byName.values()];
}

/**
 * The npm package behind a server, when there is one.
 *
 * Only npm: it is the one registry with a public download count, and a number
 * for some servers and nothing for others is worse than no numbers at all if it
 * reads as "this one is unpopular" rather than "this one is not on npm".
 */
function npmIdentifier(entry) {
  const launch = entry?.launch;
  if (launch?.kind !== "package" || launch.command !== "npx") return null;
  const spec = asArray(launch.args).find((arg) => arg && !arg.startsWith("-"));
  if (!spec) return null;
  // Strip the pinned version without mistaking a scope's @ for it.
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

/**
 * Splits package names by how npm will let us ask about them.
 *
 * The bulk endpoint answers for up to a hundred packages at once and refuses
 * scoped names outright — "scoped packages are not currently supported in bulk
 * lookups" — so those have to be asked for one at a time.
 */
function splitForDownloadLookup(names, chunkSize = 100) {
  const unique = [...new Set(asArray(names).filter(Boolean))];
  const scoped = unique.filter((name) => name.startsWith("@"));
  const plain = unique.filter((name) => !name.startsWith("@"));
  const bulk = [];
  for (let index = 0; index < plain.length; index += chunkSize) {
    bulk.push(plain.slice(index, index + chunkSize));
  }
  return { bulk, single: scoped };
}

/** Folds download counts back onto the rows they belong to. */
function attachDownloads(rows, byPackage) {
  const counts = byPackage instanceof Map ? byPackage : new Map(Object.entries(byPackage ?? {}));
  return asArray(rows).map((row) => {
    const pkg = npmIdentifier(row);
    const weekly = pkg ? counts.get(pkg) : undefined;
    return Number.isFinite(weekly) ? { ...row, npmPackage: pkg, weeklyDownloads: Number(weekly) } : { ...row, npmPackage: pkg ?? null };
  });
}

/**
 * Orders search results when the registry cannot.
 *
 * The registry publishes no install count, no rating and no verification flag,
 * and returns matches in name order — so a fork sits above the thing it forked
 * purely on alphabet. Two signals stand in for the one it does not have: how
 * squarely the name answers what was typed, and how many people are actually
 * downloading it from npm. The second is what separates the real
 * `playwright-mcp` from four other things called `playwright-mcp`.
 */
function rankForQuery(rows, query) {
  const needle = text(query, 200).toLowerCase();
  const score = (row) => {
    if (!needle) return 0;
    const name = String(row.name ?? "").toLowerCase();
    if (name === needle) return 0;
    if (name.startsWith(needle)) return 1;
    if (name.includes(needle)) return 2;
    if (String(row.title ?? "").toLowerCase().includes(needle)) return 3;
    return 4;
  };

  return [...asArray(rows)].sort(
    (a, b) =>
      score(a) - score(b) ||
      // An entry we can install outranks one we can only describe.
      Number(Boolean(b.installable)) - Number(Boolean(a.installable)) ||
      (b.weeklyDownloads ?? -1) - (a.weeklyDownloads ?? -1) ||
      String(a.name ?? "").localeCompare(String(b.name ?? "")),
  );
}

/**
 * The command that installs one server into one agent.
 *
 * Both CLIs take the same three facts and want them in different orders, and
 * both use `--` to stop parsing so a server's own flags cannot be read as the
 * CLI's. Returned as argv rather than a string: none of this goes near a shell.
 */
function installPlan(entry, provider) {
  const launch = entry?.launch;
  if (!launch) return null;

  // The agent's config key. The registry's names are namespaced and long, and
  // `io.github.microsoft/playwright-mcp` is not a usable identifier.
  const name = text(entry.name, 100).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
  if (!name) return null;

  if (provider === "claude") {
    if (launch.kind === "remote") {
      return { command: "claude", args: ["mcp", "add", "--transport", launch.transport, name, launch.url] };
    }
    return { command: "claude", args: ["mcp", "add", name, "--", launch.command, ...launch.args] };
  }

  if (provider === "codex") {
    if (launch.kind === "remote") {
      // Codex speaks streamable HTTP only; it has no flag for SSE.
      if (launch.transport !== "http") return null;
      return { command: "codex", args: ["mcp", "add", name, "--url", launch.url] };
    }
    return { command: "codex", args: ["mcp", "add", name, "--", launch.command, ...launch.args] };
  }

  return null;
}

module.exports = {
  RUNNERS,
  npmIdentifier,
  splitForDownloadLookup,
  attachDownloads,
  splitServerName,
  resolveLaunch,
  normaliseRegistryServers,
  rankForQuery,
  installPlan,
};

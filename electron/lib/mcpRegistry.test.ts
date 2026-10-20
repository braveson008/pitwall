import { describe, expect, it } from "vitest";
import {
  npmIdentifier,
  splitForDownloadLookup,
  attachDownloads,
  splitServerName,
  resolveLaunch,
  normaliseRegistryServers,
  rankForQuery,
  installPlan,
} from "./mcpRegistry.cjs";

const listed = (server: unknown, meta: Record<string, unknown> = { isLatest: true, status: "active" }) => ({
  server,
  _meta: { "io.modelcontextprotocol.registry/official": meta },
});

describe("splitServerName", () => {
  // Who published it is the only provenance the registry carries — it holds no
  // install counts, ratings or verification flags at all.
  it("separates the publisher from the server", () => {
    expect(splitServerName("io.github.microsoft/playwright-mcp")).toEqual({
      publisher: "io.github.microsoft",
      shortName: "playwright-mcp",
    });
  });

  it("copes with a name that has no publisher", () => {
    expect(splitServerName("sentry")).toEqual({ publisher: "", shortName: "sentry" });
  });

  it("survives nothing", () => {
    expect(splitServerName(undefined)).toEqual({ publisher: "", shortName: "" });
  });
});

describe("resolveLaunch", () => {
  // A hosted URL needs no runtime on the machine and nothing downloaded, so it
  // is the one most likely to work when someone presses Install.
  it("prefers a remote over a package", () => {
    const launch = resolveLaunch({
      remotes: [{ type: "streamable-http", url: "https://mcp.example.com/mcp" }],
      packages: [{ registryType: "npm", identifier: "example-mcp" }],
    });
    expect(launch).toMatchObject({ kind: "remote", transport: "http", url: "https://mcp.example.com/mcp" });
  });

  it("keeps sse distinct from streamable http", () => {
    expect(resolveLaunch({ remotes: [{ type: "sse", url: "https://x/sse" }] })).toMatchObject({ transport: "sse" });
  });

  it("runs an npm package through npx", () => {
    expect(resolveLaunch({ packages: [{ registryType: "npm", identifier: "example-mcp", version: "1.2.3" }] }))
      .toMatchObject({ kind: "package", command: "npx", args: ["-y", "example-mcp@1.2.3"] });
  });

  it("runs a pypi package through uvx", () => {
    expect(resolveLaunch({ packages: [{ registryType: "pypi", identifier: "adeu", version: "1.5.2" }] }))
      .toMatchObject({ command: "uvx", args: ["adeu@1.5.2"] });
  });

  // Pinning is the difference between installing what the registry described
  // and installing whatever has been published since.
  it("pins the published version, and copes when there is none", () => {
    expect(resolveLaunch({ packages: [{ registryType: "npm", identifier: "example-mcp" }] }).args)
      .toEqual(["-y", "example-mcp"]);
  });

  // Real servers, but running one means Docker — a different promise from
  // "click Install".
  it("declines a container image rather than guessing at it", () => {
    expect(resolveLaunch({ packages: [{ registryType: "oci", identifier: "docker.io/x/y:1" }] })).toBeNull();
  });

  it("skips a runner it does not know and takes the next one it does", () => {
    expect(resolveLaunch({
      packages: [
        { registryType: "oci", identifier: "docker.io/x/y:1" },
        { registryType: "npm", identifier: "example-mcp" },
      ],
    })).toMatchObject({ command: "npx" });
  });

  it("carries the environment a server says it needs", () => {
    const launch = resolveLaunch({
      packages: [{
        registryType: "npm", identifier: "x",
        environmentVariables: [{ name: "API_KEY", description: "A key", isSecret: true }],
      }],
    });
    expect(launch.env).toEqual([{ name: "API_KEY", description: "A key", secret: true }]);
  });

  it("says nothing when there is nothing to run", () => {
    expect(resolveLaunch({})).toBeNull();
  });
});

describe("normaliseRegistryServers", () => {
  // The API returns every version of every server as its own entry; one search
  // came back with the same server eleven times.
  it("keeps only the latest version of each server", () => {
    const rows = normaliseRegistryServers({
      servers: [
        listed({ name: "a/x", version: "1.0.0" }, { isLatest: false, status: "active" }),
        listed({ name: "a/x", version: "2.0.0" }, { isLatest: true, status: "active" }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe("2.0.0");
  });

  it("drops anything the registry no longer lists as active", () => {
    expect(normaliseRegistryServers({
      servers: [listed({ name: "a/x" }, { isLatest: true, status: "deleted" })],
    })).toEqual([]);
  });

  it("keeps an entry whose metadata says nothing either way", () => {
    expect(normaliseRegistryServers({ servers: [{ server: { name: "a/x" } }] })).toHaveLength(1);
  });

  // A button that cannot work is worse than a row that explains itself.
  it("marks an entry it cannot build a command for as not installable", () => {
    const [row] = normaliseRegistryServers({
      servers: [listed({ name: "a/x", packages: [{ registryType: "oci", identifier: "d/x:1" }] })],
    });
    expect(row.installable).toBe(false);
  });

  it("flags a server that will need secrets before it runs", () => {
    const [row] = normaliseRegistryServers({
      servers: [listed({
        name: "a/x",
        packages: [{ registryType: "npm", identifier: "x", environmentVariables: [{ name: "API_KEY" }] }],
      })],
    });
    expect(row.needsEnv).toBe(true);
  });

  it("falls back to the short name when there is no title", () => {
    expect(normaliseRegistryServers({ servers: [listed({ name: "pub/thing" })] })[0].title).toBe("thing");
  });

  it("survives junk", () => {
    expect(normaliseRegistryServers(null)).toEqual([]);
    expect(normaliseRegistryServers({ servers: [{}, { server: {} }] })).toEqual([]);
  });
});

describe("rankForQuery", () => {
  const rows = [
    { name: "playwright-report-mcp", title: "", installable: true },
    { name: "playwright", title: "", installable: true },
    { name: "stealth-playwright", title: "", installable: true },
    { name: "unrelated", title: "Uses playwright", installable: true },
  ];

  // The registry returns matches in name order, so a fork can sit above the
  // thing it forked. How squarely the name answers the query is the only proxy.
  it("puts an exact name first, then a prefix, then a substring", () => {
    expect(rankForQuery(rows, "playwright").map((row) => row.name)).toEqual([
      "playwright",
      "playwright-report-mcp",
      "stealth-playwright",
      "unrelated",
    ]);
  });

  it("prefers something installable when nothing else separates them", () => {
    const ranked = rankForQuery([{ name: "a", installable: false }, { name: "a", installable: true }], "a");
    expect(ranked[0].installable).toBe(true);
  });

  it("falls back to name order with no query", () => {
    expect(rankForQuery([{ name: "b" }, { name: "a" }], "").map((row) => row.name)).toEqual(["a", "b"]);
  });

  it("does not mutate what it was given", () => {
    const source = [{ name: "b" }, { name: "a" }];
    rankForQuery(source, "");
    expect(source.map((row) => row.name)).toEqual(["b", "a"]);
  });
});

describe("installPlan", () => {
  const remote = { name: "sentry", launch: { kind: "remote", transport: "http", url: "https://mcp.sentry.dev/mcp" } };
  const pkg = { name: "filesystem", launch: { kind: "package", command: "npx", args: ["-y", "server-fs@1.0.0"] } };

  it("adds a hosted server to Claude with its transport", () => {
    expect(installPlan(remote, "claude")).toEqual({
      command: "claude",
      args: ["mcp", "add", "--transport", "http", "sentry", "https://mcp.sentry.dev/mcp"],
    });
  });

  it("adds a hosted server to Codex through --url", () => {
    expect(installPlan(remote, "codex")).toEqual({
      command: "codex",
      args: ["mcp", "add", "sentry", "--url", "https://mcp.sentry.dev/mcp"],
    });
  });

  // Codex has no SSE flag. Refusing is right; inventing one is not.
  it("refuses an sse server for Codex rather than inventing a flag", () => {
    expect(installPlan({ ...remote, launch: { ...remote.launch, transport: "sse" } }, "codex")).toBeNull();
  });

  // `--` stops the CLI parsing, so a server's own flags cannot be read as the
  // agent CLI's.
  it("puts a command behind -- for both agents", () => {
    expect(installPlan(pkg, "claude").args).toEqual(["mcp", "add", "filesystem", "--", "npx", "-y", "server-fs@1.0.0"]);
    expect(installPlan(pkg, "codex").args).toEqual(["mcp", "add", "filesystem", "--", "npx", "-y", "server-fs@1.0.0"]);
  });

  // The registry's names are namespaced and long; agents want a config key.
  it("reduces a name to something an agent will accept as a key", () => {
    expect(installPlan({ name: "My Server!/v2", launch: pkg.launch }, "claude").args[2]).toBe("My-Server--v2");
  });

  it("refuses when there is nothing left of the name", () => {
    expect(installPlan({ name: "!!!", launch: pkg.launch }, "claude")).toBeNull();
  });

  it("refuses an entry with no way to launch it", () => {
    expect(installPlan({ name: "x" }, "claude")).toBeNull();
  });

  it("refuses an agent it does not know", () => {
    expect(installPlan(pkg, "gemini")).toBeNull();
  });
});

describe("npmIdentifier", () => {
  it("reads the package out of the launch command", () => {
    expect(npmIdentifier({ launch: { kind: "package", command: "npx", args: ["-y", "playwright-mcp@1.2.3"] } }))
      .toBe("playwright-mcp");
  });

  // The scope's @ is not the version's.
  it("keeps the scope and drops only the version", () => {
    expect(npmIdentifier({ launch: { kind: "package", command: "npx", args: ["-y", "@playwright/mcp@0.0.79"] } }))
      .toBe("@playwright/mcp");
  });

  it("copes with an unpinned package", () => {
    expect(npmIdentifier({ launch: { kind: "package", command: "npx", args: ["-y", "@scope/thing"] } }))
      .toBe("@scope/thing");
  });

  // npm is the only registry here with a public download count; a number for
  // some and nothing for others must not read as "this one is unpopular".
  it("says nothing for anything that is not npm", () => {
    expect(npmIdentifier({ launch: { kind: "package", command: "uvx", args: ["adeu"] } })).toBeNull();
    expect(npmIdentifier({ launch: { kind: "remote", url: "https://x" } })).toBeNull();
    expect(npmIdentifier({})).toBeNull();
  });
});

describe("splitForDownloadLookup", () => {
  // "scoped packages are not currently supported in bulk lookups" — npm's words.
  it("keeps scoped packages out of the bulk request", () => {
    const { bulk, single } = splitForDownloadLookup(["express", "@playwright/mcp", "lodash"]);
    expect(bulk).toEqual([["express", "lodash"]]);
    expect(single).toEqual(["@playwright/mcp"]);
  });

  it("chunks the bulk request", () => {
    const { bulk } = splitForDownloadLookup(["a", "b", "c", "d", "e"], 2);
    expect(bulk).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("asks about each package once", () => {
    expect(splitForDownloadLookup(["a", "a", "b"]).bulk).toEqual([["a", "b"]]);
  });

  it("survives nothing", () => {
    expect(splitForDownloadLookup(undefined)).toEqual({ bulk: [], single: [] });
  });
});

describe("attachDownloads", () => {
  const row = { name: "x", launch: { kind: "package", command: "npx", args: ["-y", "thing@1.0.0"] } };

  it("folds the count onto the row it belongs to", () => {
    const [out] = attachDownloads([row], new Map([["thing", 5000]]));
    expect(out).toMatchObject({ npmPackage: "thing", weeklyDownloads: 5000 });
  });

  it("accepts a plain object as well as a map", () => {
    expect(attachDownloads([row], { thing: 12 })[0].weeklyDownloads).toBe(12);
  });

  // A missing count means "not known", never "zero".
  it("leaves the count off when nothing is known", () => {
    expect(attachDownloads([row], new Map())[0].weeklyDownloads).toBeUndefined();
  });

  it("does not invent a package for a hosted server", () => {
    const [out] = attachDownloads([{ name: "y", launch: { kind: "remote", url: "https://x" } }], new Map());
    expect(out.npmPackage).toBeNull();
  });
});

describe("rankForQuery with download counts", () => {
  // The reason this exists: four things are called playwright-mcp and the
  // registry sorts them alphabetically.
  it("puts the widely used one first when the names tie", () => {
    const ranked = rankForQuery(
      [
        { name: "playwright-mcp", installable: true, weeklyDownloads: 400 },
        { name: "playwright-mcp", installable: true, weeklyDownloads: 5808831 },
      ],
      "playwright-mcp",
    );
    expect(ranked[0].weeklyDownloads).toBe(5808831);
  });

  // Relevance still outranks popularity: a hugely popular near-miss must not
  // bury the thing that was actually asked for.
  it("does not let popularity beat a better name match", () => {
    const ranked = rankForQuery(
      [
        { name: "playwright-extras", installable: true, weeklyDownloads: 9000000 },
        { name: "playwright", installable: true, weeklyDownloads: 5 },
      ],
      "playwright",
    );
    expect(ranked[0].name).toBe("playwright");
  });

  it("ranks a known count above an unknown one", () => {
    const ranked = rankForQuery(
      [{ name: "a", installable: true }, { name: "b", installable: true, weeklyDownloads: 1 }],
      "",
    );
    expect(ranked[0].name).toBe("b");
  });
});

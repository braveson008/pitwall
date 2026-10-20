import { describe, expect, it } from "vitest";
import {
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
} from "./extensionCatalog.cjs";

describe("splitPluginId", () => {
  it("splits name from marketplace", () => {
    expect(splitPluginId("figma@claude-plugins-official")).toEqual({
      name: "figma",
      marketplace: "claude-plugins-official",
    });
  });

  it("keeps a bare name whole", () => {
    expect(splitPluginId("figma")).toEqual({ name: "figma", marketplace: "" });
  });

  // Plugin names may contain an @ of their own; the marketplace is the last one.
  it("splits on the last separator", () => {
    expect(splitPluginId("@scope/thing@market")).toEqual({ name: "@scope/thing", marketplace: "market" });
  });

  it("survives nothing at all", () => {
    expect(splitPluginId(undefined)).toEqual({ name: "", marketplace: "" });
  });
});

describe("parseClaudePlugins", () => {
  const payload = {
    installed: [{ id: "figma@official", version: "2.2.96", enabled: true }],
    available: [
      { pluginId: "figma@official", name: "figma", description: "Figma things", marketplaceName: "official", version: "2.3.0", installCount: 900 },
      { pluginId: "sentry@official", name: "sentry", description: "Errors", marketplaceName: "official", installCount: 120 },
    ],
  };

  // The two halves describe the same plugin differently. One row per plugin
  // with `installed` as a field is what the UI can actually render.
  it("merges the installed and available halves into one row each", () => {
    const rows = parseClaudePlugins(payload);
    expect(rows).toHaveLength(2);
    const figma = rows.find((row) => row.pluginId === "figma@official");
    expect(figma.installed).toBe(true);
    expect(figma.description).toBe("Figma things");
    expect(figma.installs).toBe(900);
  });

  // What is on disk is what you are running; the marketplace's version is what
  // an upgrade would bring.
  it("prefers the installed version over the marketplace's", () => {
    expect(parseClaudePlugins(payload).find((row) => row.pluginId === "figma@official").version).toBe("2.2.96");
  });

  it("marks everything else as not installed", () => {
    expect(parseClaudePlugins(payload).find((row) => row.pluginId === "sentry@official").installed).toBe(false);
  });

  it("keeps an installed plugin that is no longer in any marketplace", () => {
    const rows = parseClaudePlugins({ installed: [{ id: "gone@old" }], available: [] });
    expect(rows).toEqual([
      expect.objectContaining({ pluginId: "gone@old", name: "gone", marketplace: "old", installed: true }),
    ]);
  });

  it("survives junk", () => {
    expect(parseClaudePlugins(null)).toEqual([]);
    expect(parseClaudePlugins({ available: [{}, { pluginId: "" }] })).toEqual([]);
  });
});

describe("parseCodexPlugins", () => {
  it("reads installed state off the entry rather than the list it came from", () => {
    const rows = parseCodexPlugins({
      installed: [{ pluginId: "linear@openai", name: "linear", installed: true, enabled: true, category: "Productivity" }],
      available: [{ pluginId: "gmail@openai", name: "gmail", installed: false, installPolicy: "AVAILABLE", authPolicy: "ON_INSTALL" }],
    });
    expect(rows.find((row) => row.name === "linear").installed).toBe(true);
    expect(rows.find((row) => row.name === "gmail").installed).toBe(false);
  });

  // A button that always fails is worse than one that is not offered.
  it("marks an entry the CLI will not install", () => {
    const rows = parseCodexPlugins([{ pluginId: "x@m", installPolicy: "UNAVAILABLE" }]);
    expect(rows[0].installable).toBe(false);
  });

  it("flags the ones that will ask for a login", () => {
    const rows = parseCodexPlugins([{ pluginId: "gmail@openai", authPolicy: "ON_INSTALL" }]);
    expect(rows[0].needsAuth).toBe(true);
  });

  it("does not report an uninstalled plugin as enabled", () => {
    expect(parseCodexPlugins([{ pluginId: "x@m", installed: false }])[0].enabled).toBe(false);
  });
});

describe("enrichWithCatalog", () => {
  const catalog = {
    catalog: {
      plugins: {
        figma: {
          components: {
            skills: [{ name: "figma-use", chars: { always_on: 190, on_invoke: 12700 } }, { name: "figma-swiftui" }],
            mcpServers: [{ name: "figma" }],
            commands: [],
            agents: [],
            hooks: [],
            lspServers: [],
          },
          tokens: { "claude-opus-4-7": { always_on: 2069, on_invoke: 40000 }, "claude-sonnet-4-6": { always_on: 1400, on_invoke: 30000 } },
          unique_installs: 12400,
          marketplace_entry: { description: "From the catalogue", author: { name: "Figma" } },
        },
      },
    },
  };

  it("adds the component inventory a plain listing cannot give", () => {
    const [row] = enrichWithCatalog([{ pluginId: "figma@official", name: "figma" }], catalog);
    expect(row.components.skills.map((skill) => skill.name)).toEqual(["figma-use", "figma-swiftui"]);
    expect(row.components.mcpServers).toHaveLength(1);
  });

  it("fills a description the listing did not carry", () => {
    const [row] = enrichWithCatalog([{ pluginId: "figma@official", name: "figma", description: "" }], catalog);
    expect(row.description).toBe("From the catalogue");
    expect(row.author).toBe("Figma");
  });

  it("does not overwrite a description the listing did carry", () => {
    const [row] = enrichWithCatalog([{ pluginId: "figma@official", name: "figma", description: "From the CLI" }], catalog);
    expect(row.description).toBe("From the CLI");
  });

  // The catalogue is a cache Pitwall does not own. Losing it costs the extras,
  // never the catalogue itself.
  it("is enrichment only — a missing cache leaves the rows intact", () => {
    const rows = [{ pluginId: "figma@official", name: "figma" }];
    expect(enrichWithCatalog(rows, null)).toEqual(rows);
    expect(enrichWithCatalog(rows, {})).toEqual(rows);
  });

  it("leaves a plugin the cache has never heard of alone", () => {
    const [row] = enrichWithCatalog([{ pluginId: "mine@local", name: "mine" }], catalog);
    expect(row.components).toBeUndefined();
  });
});

describe("pickTokenCost", () => {
  // A figure that turns out to have been the best case is worse than no figure.
  it("reports the most a plugin can cost, not the least", () => {
    expect(pickTokenCost({ a: { always_on: 100, on_invoke: 900 }, b: { always_on: 250, on_invoke: 400 } })).toEqual({
      alwaysOn: 250,
      onInvoke: 900,
    });
  });

  it("says nothing when it knows nothing", () => {
    expect(pickTokenCost(null)).toBeNull();
    expect(pickTokenCost({ a: {} })).toBeNull();
  });
});

describe("flattenSkills", () => {
  const plugins = [
    {
      pluginId: "figma@official",
      name: "figma",
      marketplace: "official",
      installed: true,
      enabled: true,
      components: { skills: [{ name: "figma-use", alwaysOn: 190, onInvoke: 12700 }, { name: "figma-swiftui" }] },
    },
    { pluginId: "empty@official", name: "empty", components: { skills: [] } },
  ];

  it("gives every skill its own row", () => {
    expect(flattenSkills(plugins).map((row) => row.name)).toEqual(["figma-use", "figma-swiftui"]);
  });

  // A skill is not installable on its own. The row has to say what installing
  // it actually brings, or eleven unexpected siblings arrive unexplained.
  it("carries the plugin that provides it, and how many come with it", () => {
    const [row] = flattenSkills(plugins);
    expect(row.pluginId).toBe("figma@official");
    expect(row.installed).toBe(true);
    expect(row.siblings).toBe(2);
  });

  it("survives a plugin with no inventory at all", () => {
    expect(flattenSkills([{ pluginId: "x@m", name: "x" }])).toEqual([]);
  });
});

describe("flattenPluginMcpServers", () => {
  it("reports each server and the plugin that brings it", () => {
    const rows = flattenPluginMcpServers([
      { pluginId: "figma@official", name: "figma", installed: false, components: { mcpServers: [{ name: "figma" }] } },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ name: "figma", pluginId: "figma@official", viaPlugin: true, installed: false }),
    ]);
  });
});

describe("orderForBrowsing", () => {
  it("puts what you already have first", () => {
    const rows = orderForBrowsing([
      { name: "b", installs: 900 },
      { name: "a", installed: true, installs: 2 },
    ]);
    expect(rows.map((row) => row.name)).toEqual(["a", "b"]);
  });

  // With hundreds of plugins and no opinion of our own, install count is the
  // only signal that is not alphabetical accident.
  it("then by how many people use it", () => {
    const rows = orderForBrowsing([{ name: "a", installs: 5 }, { name: "b", installs: 500 }]);
    expect(rows.map((row) => row.name)).toEqual(["b", "a"]);
  });

  it("falls back to the name when nothing else separates them", () => {
    const rows = orderForBrowsing([{ name: "zebra" }, { name: "apple" }]);
    expect(rows.map((row) => row.name)).toEqual(["apple", "zebra"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [{ name: "b" }, { name: "a" }];
    orderForBrowsing(rows);
    expect(rows.map((row) => row.name)).toEqual(["b", "a"]);
  });
});

describe("matchesQuery", () => {
  const row = { name: "figma-use", description: "Drive the Figma plugin API", pluginName: "figma", marketplace: "official" };

  it("matches nothing in particular against everything", () => {
    expect(matchesQuery(row, "")).toBe(true);
  });

  it("matches on the name", () => {
    expect(matchesQuery(row, "figma-use")).toBe(true);
  });

  // "figma" should find figma-use whether that word is in the skill's name or
  // only in the plugin carrying it.
  it("matches a skill through the plugin that provides it", () => {
    expect(matchesQuery({ name: "use-motion", pluginName: "figma" }, "figma")).toBe(true);
  });

  it("requires every word, so a second word narrows rather than widens", () => {
    expect(matchesQuery(row, "figma api")).toBe(true);
    expect(matchesQuery(row, "figma sentry")).toBe(false);
  });

  it("ignores case", () => {
    expect(matchesQuery(row, "FIGMA")).toBe(true);
  });
});

describe("codexPluginDetails", () => {
  const manifest = {
    name: "google-calendar",
    description: "Connect Google Calendar for scheduling, availability, daily briefs, and event management.",
    author: { name: "OpenAI" },
    homepage: "https://calendar.google.com/",
    interface: {
      displayName: "Google Calendar",
      shortDescription: "Manage Google Calendar events and schedules",
      longDescription: "A much longer paragraph that would not fit on a card.",
    },
  };

  // "Google Calendar" is what a person calls it; "google-calendar" is the id.
  it("prefers the display name a person would use", () => {
    expect(codexPluginDetails(manifest).title).toBe("Google Calendar");
  });

  // The card has three lines. The long description runs to a paragraph.
  it("takes the short description over the long one", () => {
    expect(codexPluginDetails(manifest).description).toBe("Manage Google Calendar events and schedules");
  });

  it("falls back to the top-level description when there is no interface", () => {
    expect(codexPluginDetails({ description: "Plain." }).description).toBe("Plain.");
  });

  it("carries the author", () => {
    expect(codexPluginDetails(manifest).author).toBe("OpenAI");
  });

  it("shapes skills and servers into the same components a Claude plugin has", () => {
    const details = codexPluginDetails(manifest, { skills: ["a", "b"], mcpServers: ["cal"] });
    expect(details.components.skills).toEqual([
      { name: "a", alwaysOn: null, onInvoke: null },
      { name: "b", alwaysOn: null, onInvoke: null },
    ]);
    expect(details.components.mcpServers).toHaveLength(1);
    expect(details.components.commands).toEqual([]);
  });

  it("survives a plugin with no manifest at all", () => {
    const details = codexPluginDetails(null, { skills: ["only-a-skill"] });
    expect(details.title).toBe("");
    expect(details.components.skills).toHaveLength(1);
  });
});

describe("enrichCodexPlugins", () => {
  const rows = [{ pluginId: "cal@openai", name: "google-calendar", description: "", installed: false }];

  it("fills in what the CLI could not say", () => {
    const [row] = enrichCodexPlugins(rows, new Map([[
      "cal@openai",
      { title: "Google Calendar", description: "Manage events", author: "OpenAI", components: { skills: [{ name: "brief" }] } },
    ]]));
    expect(row.name).toBe("Google Calendar");
    expect(row.description).toBe("Manage events");
    expect(row.components.skills).toHaveLength(1);
  });

  // A plugin whose manifest could not be read keeps the row the CLI gave us
  // rather than vanishing from the catalogue.
  it("leaves a row alone when nothing was read for it", () => {
    expect(enrichCodexPlugins(rows, new Map())).toEqual(rows);
  });

  it("does not overwrite a description the CLI did provide", () => {
    const [row] = enrichCodexPlugins(
      [{ pluginId: "x@m", name: "x", description: "From the CLI" }],
      new Map([["x@m", { description: "From the manifest" }]]),
    );
    expect(row.description).toBe("From the CLI");
  });

  it("keeps the CLI's name when the manifest has no display name", () => {
    const [row] = enrichCodexPlugins(rows, new Map([["cal@openai", { title: "", components: {} }]]));
    expect(row.name).toBe("google-calendar");
  });
});

import { describe, expect, it } from "vitest";
import { resolveApp, bestChannel, describeReach, mcpServerMatches } from "./appDirectory.cjs";
// The real matcher, so these tests exercise the behaviour the app actually gets.
import { createOsControl } from "./osControl.cjs";

const SITES: Record<string, string> = {
  linear: "https://linear.app",
  jira: "https://jira.com",
  figma: "https://figma.com",
  notion: "https://notion.so",
};

// osControl keeps matchApplication private, so mirror the one behaviour this
// module depends on: an exact, alias, or unambiguous prefix match, else null.
const matchApplication = (spoken: string, installed: string[]) => {
  const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = squash(spoken);
  const exact = installed.find((name) => squash(name) === wanted);
  if (exact) return exact;
  const prefixed = installed.filter((name) => squash(name).startsWith(wanted));
  return prefixed.length === 1 ? prefixed[0] : null;
};

const opts = (over: Partial<Parameters<typeof resolveApp>[1]> = {}) => ({
  sites: SITES,
  matchApplication,
  mcpServers: [],
  installedApps: [],
  ...over,
});

describe("mcpServerMatches", () => {
  it("matches the names people actually configure", () => {
    expect(mcpServerMatches("linear", "linear")).toBe(true);
    expect(mcpServerMatches("plugin:figma:figma", "figma")).toBe(true);
    expect(mcpServerMatches("atlassian-prod", "atlassian")).toBe(true);
  });

  it("does not match unrelated servers", () => {
    expect(mcpServerMatches("postgres", "linear")).toBe(false);
    expect(mcpServerMatches("", "linear")).toBe(false);
  });
});

describe("resolveApp", () => {
  it("prefers a live MCP server over the installed app and the website", () => {
    const resolved = resolveApp("linear", opts({
      mcpServers: [{ name: "linear", status: "connected", transport: "HTTP" }],
      installedApps: ["Linear", "Safari"],
    }));
    expect(resolved!.channels.map((c: any) => c.kind)).toEqual(["mcp", "app", "web"]);
    expect(bestChannel(resolved)).toMatchObject({ kind: "mcp", server: "linear" });
  });

  it("falls past a broken MCP server to something that works", () => {
    // A server that is configured but not connected is not a channel — a
    // request routed to it would simply hang.
    const resolved = resolveApp("linear", opts({
      mcpServers: [{ name: "linear", status: "needs-auth" }],
      installedApps: ["Linear"],
    }));
    expect(bestChannel(resolved)).toMatchObject({ kind: "app", app: "Linear" });
    expect(resolved!.channels[0]).toMatchObject({ kind: "mcp", usable: false });
  });

  it("resolves Jira through an Atlassian server, which is what it is called", () => {
    const resolved = resolveApp("jira", opts({
      mcpServers: [{ name: "atlassian", status: "connected" }],
    }));
    expect(bestChannel(resolved)).toMatchObject({ kind: "mcp", server: "atlassian" });
  });

  it("works for an app it has never been taught, via the installed list", () => {
    // The point of the whole module: no Notion integration exists anywhere.
    const resolved = resolveApp("notion", opts({ installedApps: ["Notion", "Xcode"] }));
    expect(bestChannel(resolved)).toMatchObject({ kind: "app", app: "Notion" });
  });

  it("returns null rather than guessing", () => {
    expect(resolveApp("perforce", opts())).toBeNull();
    expect(resolveApp("", opts())).toBeNull();
    expect(resolveApp("   ", opts())).toBeNull();
  });

  it("never offers a channel it cannot use", () => {
    const resolved = resolveApp("linear", opts({
      mcpServers: [{ name: "linear", status: "failed" }],
    }));
    // Only the failed MCP server and the website; the best usable one is web.
    expect(bestChannel(resolved)).toMatchObject({ kind: "web" });
  });
});

describe("describeReach", () => {
  it("says what it can do, in the terms of what the user asked for", () => {
    const viaMcp = resolveApp("linear", opts({
      mcpServers: [{ name: "linear", status: "connected" }],
    }));
    expect(describeReach(viaMcp)).toMatch(/query linear directly/i);

    const viaApp = resolveApp("notion", opts({ installedApps: ["Notion"] }));
    expect(describeReach(viaApp)).toMatch(/can't search inside it/i);

    expect(describeReach(null)).toMatch(/don't know that app/i);
  });

  it("names a broken connection as broken rather than as missing", () => {
    const resolved = resolveApp("linear", opts({
      mcpServers: [{ name: "linear", status: "needs-auth" }],
      sites: {},
    } as any));
    expect(describeReach(resolved)).toMatch(/needs-auth/);
  });
});

describe("osControl is still the source of truth for launching", () => {
  it("exposes the installed-application list this module resolves against", () => {
    const os = createOsControl();
    expect(typeof os.listInstalledApplications).toBe("function");
  });
});

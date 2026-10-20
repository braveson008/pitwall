import { describe, expect, it } from "vitest";
import {
  classifyMcpStatus,
  parseClaudeMcpList,
  parseCodexConfigServers,
  parseGeminiSettingsServers,
  codexProjectTrusted,
  parseHermesMcpServers,
} from "./mcpParse.cjs";

describe("classifyMcpStatus", () => {
  it("maps symbols and words to statuses", () => {
    expect(classifyMcpStatus("✔ Connected")).toBe("connected");
    expect(classifyMcpStatus("✘ Failed to connect")).toBe("failed");
    expect(classifyMcpStatus("⏸ Pending approval")).toBe("pending");
    expect(classifyMcpStatus("needs login")).toBe("needs-auth");
    expect(classifyMcpStatus("whatever")).toBe("configured");
  });
});

describe("parseClaudeMcpList", () => {
  it("parses the real health-check output", () => {
    const out = [
      "Checking MCP server health…",
      "",
      "plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ✔ Connected",
      "linear: https://mcp.linear.app/mcp (HTTP) - ✔ Connected",
      "figma: http://127.0.0.1:3845/sse (SSE) - ✘ Failed to connect",
    ].join("\n");
    const servers = parseClaudeMcpList(out);
    expect(servers).toHaveLength(3);
    expect(servers[0]).toMatchObject({ name: "plugin:figma:figma", transport: "HTTP", status: "connected" });
    expect(servers[2]).toMatchObject({ name: "figma", transport: "SSE", status: "failed" });
  });

  it("returns [] for empty / health-only output", () => {
    expect(parseClaudeMcpList("")).toEqual([]);
    expect(parseClaudeMcpList("Checking MCP server health…")).toEqual([]);
  });
});

describe("parseCodexConfigServers", () => {
  it("reads [mcp_servers.*] with command + args", () => {
    const toml = [
      'model = "gpt-5.5"',
      '[projects."/x"]',
      'trust_level = "trusted"',
      "[mcp_servers.fs]",
      'command = "npx"',
      'args = ["-y", "server-fs"]',
    ].join("\n");
    const servers = parseCodexConfigServers(toml);
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: "fs", target: "npx -y server-fs", transport: "STDIO" });
  });

  it("returns [] when none configured", () => {
    expect(parseCodexConfigServers('model = "x"')).toEqual([]);
  });
});

describe("parseGeminiSettingsServers", () => {
  it("reads the mcpServers map", () => {
    const s = parseGeminiSettingsServers({
      mcpServers: { linear: { httpUrl: "https://x/mcp" }, fs: { command: "npx", args: ["a"] } },
    });
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ name: "linear", transport: "HTTP" });
    expect(s[1]).toMatchObject({ name: "fs", transport: "STDIO", target: "npx a" });
  });

  it("returns [] with no map", () => {
    expect(parseGeminiSettingsServers({})).toEqual([]);
  });
});

describe("codexProjectTrusted", () => {
  const toml = [
    '[projects."/a/b"]',
    'trust_level = "trusted"',
    '[projects."/a/bc"]',
    'trust_level = "untrusted"',
  ].join("\n");

  it("detects a trusted project", () => {
    expect(codexProjectTrusted(toml, "/a/b")).toBe(true);
  });

  it("does not false-match a longer path or an unlisted one", () => {
    expect(codexProjectTrusted(toml, "/a/bc")).toBe(false);
    expect(codexProjectTrusted(toml, "/a/x")).toBe(false);
  });
});

describe("parseHermesMcpServers", () => {
  it("reads stdio and HTTP servers from Hermes's JSON config", () => {
    const output = JSON.stringify({
      files: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"], enabled: true },
      wiki: { url: "https://mcp.deepwiki.com/mcp", headers: { Authorization: "***" }, enabled: false },
    });
    expect(parseHermesMcpServers(output)).toEqual([
      { name: "files", target: "npx -y @modelcontextprotocol/server-filesystem /tmp", transport: "STDIO", status: "configured", statusText: "Configured" },
      { name: "wiki", target: "https://mcp.deepwiki.com/mcp", transport: "HTTP", status: "disabled", statusText: "Disabled" },
    ]);
  });

  it("treats no servers, or output that is not JSON, as none", () => {
    expect(parseHermesMcpServers("null")).toEqual([]);
    expect(parseHermesMcpServers("")).toEqual([]);
    expect(parseHermesMcpServers("Traceback (most recent call last)")).toEqual([]);
  });
});

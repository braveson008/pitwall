// Pure parsers for MCP CLI output + Codex trust config. Kept dependency-free so
// they can be unit-tested without booting Electron.

function classifyMcpStatus(statusText) {
  const text = String(statusText || "");
  if (text.includes("✔") || text.includes("✓")) return "connected";
  if (text.includes("✘") || text.includes("✗")) return "failed";
  if (text.includes("⏸")) return "pending";
  const lower = text.toLowerCase();
  if (lower.includes("connected")) return "connected";
  if (lower.includes("fail") || lower.includes("error") || lower.includes("cannot")) return "failed";
  if (lower.includes("pending") || lower.includes("approval")) return "pending";
  if (lower.includes("auth") || lower.includes("login") || lower.includes("unauthor")) return "needs-auth";
  return "configured";
}

// Parses `claude mcp list`, whose lines look like:
//   name: https://host/mcp (HTTP) - ✔ Connected
//   name: node server.js (STDIO) - ✘ Failed to connect
function parseClaudeMcpList(stdout) {
  const servers = [];
  for (const rawLine of String(stdout || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/checking mcp server health/i.test(line)) continue;

    let match = line.match(/^(.+?):\s+(.*?)\s+\((HTTP|SSE|STDIO)\)\s+-\s+(.*)$/i);
    let name;
    let target;
    let transport = "";
    let statusText;

    if (match) {
      [, name, target, transport, statusText] = match;
    } else {
      const fallback = line.match(/^(.+?):\s+(.*?)\s+-\s+(.*)$/);
      if (!fallback) continue;
      [, name, target, statusText] = fallback;
    }

    servers.push({
      name: name.trim(),
      target: target.trim(),
      transport: transport.toUpperCase(),
      status: classifyMcpStatus(statusText),
      statusText: statusText.trim(),
    });
  }
  return servers;
}

// Minimal TOML section reader for `[mcp_servers.<name>]` blocks in a Codex config.
function parseCodexConfigServers(tomlText) {
  const servers = [];
  let current = null;

  const flush = () => {
    if (current) servers.push(current);
    current = null;
  };

  for (const rawLine of String(tomlText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const header = line.match(/^\[mcp_servers\.(?:"([^"]+)"|([^\].]+))\]$/);
    if (header) {
      flush();
      current = {
        name: header[1] || header[2],
        target: "",
        transport: "STDIO",
        status: "configured",
        statusText: "Configured",
      };
      continue;
    }

    if (line.startsWith("[")) {
      // A nested table like [mcp_servers.name.env] keeps the current server;
      // any other top-level section closes it.
      if (!current || !line.startsWith(`[mcp_servers.`)) flush();
      continue;
    }

    if (!current) continue;

    const url = line.match(/^url\s*=\s*"(.*)"$/);
    if (url) {
      current.target = url[1];
      current.transport = "HTTP";
      continue;
    }
    const command = line.match(/^command\s*=\s*"(.*)"$/);
    if (command && !current.target) {
      current.target = command[1];
      continue;
    }
    const args = line.match(/^args\s*=\s*(\[.*\])$/);
    if (args && current.transport === "STDIO") {
      try {
        const parsed = JSON.parse(args[1].replace(/'/g, '"'));
        if (Array.isArray(parsed) && parsed.length) {
          current.target = `${current.target} ${parsed.join(" ")}`.trim();
        }
      } catch {
        // Leave the bare command if args can't be parsed.
      }
    }
  }

  flush();
  return servers;
}

// Reads `mcpServers` from a Gemini settings.json (project or user scope).
function parseGeminiSettingsServers(settings) {
  const map = settings?.mcpServers;
  if (!map || typeof map !== "object") return [];
  return Object.entries(map).map(([name, config]) => {
    const url = config?.httpUrl || config?.url;
    return {
      name,
      target: url || [config?.command, ...(config?.args || [])].filter(Boolean).join(" "),
      transport: url ? "HTTP" : "STDIO",
      status: "configured",
      statusText: "Configured",
    };
  });
}

/**
 * Hermes's MCP servers, from `hermes config get mcp_servers --json` — the
 * table `hermes mcp list` prints cuts commands short. Hermes masks credential
 * values in that output, so nothing secret passes through here.
 */
function parseHermesMcpServers(output) {
  let map;
  try {
    map = JSON.parse(String(output || "").trim() || "null");
  } catch {
    return [];
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  return Object.entries(map).map(([name, config]) => {
    const url = config?.url;
    const enabled = config?.enabled !== false;
    return {
      name,
      target: url || [config?.command, ...(Array.isArray(config?.args) ? config.args : [])].filter(Boolean).join(" "),
      transport: url ? "HTTP" : "STDIO",
      status: enabled ? "configured" : "disabled",
      statusText: enabled ? "Configured" : "Disabled",
    };
  });
}

function parseKimiMcpList(stdout) {
  const servers = [];
  for (const rawLine of String(stdout || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^MCP config file:/i.test(line)) continue;
    const match = line.match(/^(.+?)\s+\((stdio|http|sse)\):\s+(.+?)(?:\s+\[([^\]]+)\])?$/i);
    if (!match) continue;
    const [, name, transport, target, annotation = ""] = match;
    servers.push({
      name: name.trim(),
      target: target.trim(),
      transport: transport.toUpperCase(),
      status: /authorization required|needs? auth|unauthor/i.test(annotation) ? "needs-auth" : "configured",
      statusText: annotation || "Configured",
    });
  }
  return servers;
}

function codexProjectHeader(cwd) {
  return `[projects.${JSON.stringify(cwd)}]`;
}

// Codex writes Windows paths as literal strings ('C:\x'); a second, JSON-quoted table for the same path is a
// duplicate key that stops Codex from starting.
function codexProjectHeaderPath(line) {
  const match = /^\[\s*projects\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*\]$/.exec(String(line).trim());
  if (!match) return null;
  if (match[2] !== undefined) return match[2];
  try { return JSON.parse(`"${match[1]}"`); } catch { return null; }
}

function codexProjectTrusted(toml, cwd) {
  let inSection = false;
  for (const rawLine of String(toml).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      inSection = codexProjectHeaderPath(line) === cwd;
      continue;
    }
    if (inSection && /^trust_level\s*=\s*"trusted"/.test(line)) return true;
  }
  return false;
}

module.exports = {
  classifyMcpStatus,
  parseClaudeMcpList,
  parseCodexConfigServers,
  parseGeminiSettingsServers,
  parseKimiMcpList,
  parseHermesMcpServers,
  codexProjectHeader,
  codexProjectHeaderPath,
  codexProjectTrusted,
};

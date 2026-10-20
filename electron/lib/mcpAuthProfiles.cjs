const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { trackerSourceFamily } = require("./trackerTasks.cjs");

function defaultState() {
  return { version: 1, projects: {} };
}

function readState(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed?.version === 1 && parsed.projects ? parsed : defaultState();
  } catch {
    return defaultState();
  }
}

function normalizeProjectPath(projectPath) {
  return projectPath ? path.resolve(projectPath) : "";
}

function createMcpAlias({ projectId, provider, name, target }) {
  const slug = String(name || "mcp")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28) || "mcp";
  const digest = createHash("sha256")
    .update(`${projectId}\0${provider}\0${name}\0${target}`)
    .digest("hex")
    .slice(0, 10);
  return `braveli_${slug}_${digest}`;
}

function tomlKeySegment(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function codexMcpArgs(bindings) {
  const args = [];
  for (const binding of bindings) {
    args.push("-c", `mcp_servers.${tomlKeySegment(binding.alias)}.url=${JSON.stringify(binding.target)}`);
    args.push("-c", `mcp_servers.${tomlKeySegment(binding.name)}.enabled=false`);
  }
  return args;
}

function claudeMcpConfig(bindings) {
  return {
    mcpServers: Object.fromEntries(bindings.map((binding) => [
      binding.alias,
      {
        type: String(binding.transport).toLowerCase() === "sse" ? "sse" : "http",
        url: binding.target,
      },
    ])),
  };
}

function kimiMcpConfig(bindings) {
  return {
    mcpServers: Object.fromEntries(bindings.map((binding) => [binding.alias, {
      url: binding.target,
      transport: "http",
      auth: "oauth",
    }])),
  };
}

function mergeMcpAuthProfiles(servers, profiles) {
  const privateAliases = new Set(profiles.map((profile) => profile.alias));
  const aliases = new Map(profiles.map((profile) => [profile.name, servers.find((server) => server.name === profile.alias)]));
  const merged = servers.filter((server) => !privateAliases.has(server.name)).map((server) => ({ ...server }));
  for (const profile of profiles) {
    const index = merged.findIndex((server) => server.name === profile.name);
    const discovered = aliases.get(profile.name) || (index >= 0 ? merged[index] : null);
    if (index >= 0 && !profile.authenticatedAt) continue;
    const server = {
      name: profile.name,
      target: profile.target,
      transport: String(profile.transport || "HTTP").toUpperCase(),
      status: discovered?.status || (profile.authenticatedAt ? "configured" : "needs-auth"),
      statusText: discovered?.statusText || (profile.authenticatedAt ? "Project auth configured; recheck connection" : "Needs authentication"),
    };
    if (index >= 0) merged[index] = server;
    else merged.push(server);
  }
  return merged;
}

/**
 * Remote tracker servers an agent in this project must not use. A remote
 * server's OAuth token is keyed by its name and URL, not by project, so a plain
 * `atlassian` answers as whichever account last logged in anywhere. Only this
 * project's own aliases carry its own login.
 */
function borrowedTrackerServers(servers, bindings) {
  const own = new Set(bindings.map((binding) => binding.alias));
  return servers
    .filter((server) => /http|sse/i.test(server.transport || ""))
    .filter((server) => trackerSourceFamily(server.name, server.target))
    .filter((server) => !own.has(server.name))
    .map((server) => server.name);
}

function createMcpAuthProfileStore(filePath) {
  let state = readState(filePath);

  function write() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // Some platforms do not expose POSIX permissions.
    }
  }

  function findProject({ projectId, projectPath }) {
    if (projectId && state.projects[projectId]) return state.projects[projectId];
    const normalizedPath = normalizeProjectPath(projectPath);
    if (!normalizedPath) return null;
    return Object.values(state.projects).find((project) => project.projectPath === normalizedPath) || null;
  }

  return {
    exportAll() {
      return JSON.parse(JSON.stringify(state));
    },
    /** One project's bindings, as another computer has them, under this computer's path for it. */
    replaceProject({ projectId, projectPath, bindings }) {
      state.projects[projectId] = { projectId, projectPath: normalizeProjectPath(projectPath), bindings: Array.isArray(bindings) ? bindings : [] };
      write();
    },
    list(payload = {}) {
      const project = findProject(payload);
      const bindings = Array.isArray(project?.bindings) ? project.bindings : [];
      return bindings.filter((binding) => !payload.provider || binding.provider === payload.provider);
    },
    upsert({ projectId, projectPath, provider, name, target, transport = "http" }) {
      if (!projectId || !projectPath) throw new Error("Project id and path are required");
      if (!provider || !name || !target) throw new Error("Provider, server name, and URL are required");
      const project = findProject({ projectId, projectPath }) || {
        projectId,
        projectPath: normalizeProjectPath(projectPath),
        bindings: [],
      };
      const alias = createMcpAlias({ projectId, provider, name, target });
      const existing = project.bindings.find((binding) => binding.provider === provider && binding.name === name);
      const next = {
        provider,
        name,
        alias,
        target,
        transport,
        authenticatedAt: existing?.target === target ? existing.authenticatedAt || null : null,
        ...(existing?.scope ? { scope: existing.scope } : {}),
        updatedAt: new Date().toISOString(),
      };
      project.bindings = [
        ...project.bindings.filter((binding) => !(binding.provider === provider && binding.name === name)),
        next,
      ];
      state.projects[projectId] = project;
      write();
      return next;
    },
    markAuthenticated(payload = {}) {
      const project = findProject(payload);
      const binding = project?.bindings.find(
        (item) => item.provider === payload.provider && item.name === payload.name,
      );
      if (!binding) return null;
      binding.authenticatedAt = new Date().toISOString();
      binding.updatedAt = binding.authenticatedAt;
      write();
      return binding;
    },
    setScope(payload = {}) {
      const project = findProject(payload);
      const binding = project?.bindings.find(
        (item) => item.provider === payload.provider && item.name === payload.name,
      );
      if (!binding) return null;
      const scope = String(payload.scope || "").trim().slice(0, 120);
      if (scope) binding.scope = scope;
      else delete binding.scope;
      binding.updatedAt = new Date().toISOString();
      write();
      return binding;
    },
    forget(payload = {}) {
      const project = findProject(payload);
      if (!project) return false;
      const previousLength = project.bindings.length;
      project.bindings = project.bindings.filter(
        (binding) => !(binding.provider === payload.provider && binding.name === payload.name),
      );
      if (project.bindings.length !== previousLength) write();
      return project.bindings.length !== previousLength;
    },
  };
}

module.exports = {
  borrowedTrackerServers,
  claudeMcpConfig,
  codexMcpArgs,
  createMcpAlias,
  createMcpAuthProfileStore,
  kimiMcpConfig,
  mergeMcpAuthProfiles,
  tomlKeySegment,
};

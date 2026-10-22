const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { codexProjectHeader, codexProjectHeaderPath, codexProjectTrusted } = require("./mcpParse.cjs");

const writers = new Map();

function withConfigLock(file, update) {
  const key = path.resolve(file);
  const pending = (writers.get(key) || Promise.resolve()).catch(() => {}).then(update);
  writers.set(key, pending);
  return pending.finally(() => { if (writers.get(key) === pending) writers.delete(key); });
}

// Windows refuses to replace a file another process has open (an agent reading its config), briefly.
async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await fs.promises.rename(from, to); }
    catch (error) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

async function atomicWriteFile(file, contents) {
  const tmp = `${file}.pitwall-${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tmp, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await renameWithRetry(tmp, file);
  } finally {
    await fs.promises.unlink(tmp).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function backupOnce(file, contents) {
  try {
    await fs.promises.writeFile(`${file}.pitwall.bak`, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await fs.promises.chmod(`${file}.pitwall.bak`, 0o600);
}

async function protectConfig(file) {
  await fs.promises.chmod(file, 0o600);
  await fs.promises.chmod(`${file}.pitwall.bak`, 0o600).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

// Claude on Windows keys projects as C:/Users/x; older builds used backslashes. Both spellings are read and written.
function claudeProjectKeys(cwd, platform = process.platform) {
  return platform === "win32" ? [...new Set([cwd.replace(/\\/g, "/"), cwd])] : [cwd];
}

function ensureClaudeTrust(cwd, home, platform = process.platform) {
  const file = path.join(home, ".claude.json");
  return withConfigLock(file, async () => {
    const raw = await fs.promises.readFile(file, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (raw === null) return { ok: false, trusted: false, message: "~/.claude.json not found — run claude once first" };
    let data;
    try { data = JSON.parse(raw); } catch { return { ok: false, trusted: false, message: "Could not parse ~/.claude.json" }; }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, trusted: false, message: "Invalid ~/.claude.json" };
    if (!data.projects || typeof data.projects !== "object" || Array.isArray(data.projects)) data.projects = {};
    const keys = claudeProjectKeys(cwd, platform);
    if (keys.some((key) => data.projects[key]?.hasTrustDialogAccepted === true)) {
      await protectConfig(file);
      return { ok: true, trusted: true, changed: false };
    }
    for (const key of keys) data.projects[key] = { ...(data.projects[key] || {}), hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true };
    await backupOnce(file, raw);
    await atomicWriteFile(file, JSON.stringify(data, null, 2));
    return { ok: true, trusted: true, changed: true };
  });
}

function ensureCodexTrust(cwd, home) {
  const file = path.join(home, ".codex", "config.toml");
  return withConfigLock(file, async () => {
    const original = await fs.promises.readFile(file, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    if (codexProjectTrusted(original, cwd)) {
      await protectConfig(file);
      return { ok: true, trusted: true, changed: false };
    }
    const header = codexProjectHeader(cwd);
    const lines = original.split(/\r?\n/);
    const start = lines.findIndex((line) => codexProjectHeaderPath(line) === cwd);
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && !lines[end].trim().startsWith("[")) end += 1;
      const trust = lines.findIndex((line, index) => index > start && index < end && /^\s*trust_level\s*=/.test(line));
      if (trust >= 0) lines[trust] = 'trust_level = "trusted"';
      else lines.splice(start + 1, 0, 'trust_level = "trusted"');
    } else {
      lines.push("", header, 'trust_level = "trusted"', "");
    }
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    if (original) await backupOnce(file, original);
    await atomicWriteFile(file, lines.join("\n"));
    return { ok: true, trusted: true, changed: true };
  });
}

function ensureClaudeBypassAccepted(cwd) {
  const file = path.join(cwd, ".claude", "settings.local.json");
  return withConfigLock(file, async () => {
    let existing = {};
    try { existing = JSON.parse(await fs.promises.readFile(file, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) throw new Error("Invalid Claude project settings");
    if (existing.skipDangerousModePermissionPrompt === true) return { ok: true, changed: false };
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await atomicWriteFile(file, JSON.stringify({ ...existing, skipDangerousModePermissionPrompt: true }, null, 2));
    return { ok: true, changed: true };
  });
}

const CARRIED_LISTS = ["allowedTools", "enabledMcpjsonServers", "disabledMcpjsonServers", "mcpContextUris"];

/** Gives `toPath` the MCP servers, tool approvals and trust Claude recorded for `fromPath`; `toPath`'s own entries win. */
function carryClaudeProjectConfig(fromPath, toPath, home, platform = process.platform) {
  const file = path.join(home, ".claude.json");
  return withConfigLock(file, async () => {
    const raw = await fs.promises.readFile(file, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (raw === null) return { ok: true, changed: false };
    const data = JSON.parse(raw);
    const fromKey = claudeProjectKeys(fromPath, platform).find((key) => data?.projects?.[key]);
    const from = fromKey && data.projects[fromKey];
    if (!from || typeof from !== "object") return { ok: true, changed: false };
    const toKeys = claudeProjectKeys(toPath, platform);
    const to = data.projects[toKeys.find((key) => data.projects[key])] || {};
    const next = { ...from, ...to, mcpServers: { ...(from.mcpServers || {}), ...(to.mcpServers || {}) } };
    for (const key of CARRIED_LISTS) next[key] = [...new Set([...(from[key] || []), ...(to[key] || [])])];
    if (from.hasTrustDialogAccepted === true) next.hasTrustDialogAccepted = true;
    if (toKeys.every((key) => JSON.stringify(next) === JSON.stringify(data.projects[key]))) return { ok: true, changed: false };
    for (const key of toKeys) data.projects[key] = next;
    await backupOnce(file, raw);
    await atomicWriteFile(file, JSON.stringify(data, null, 2));
    return { ok: true, changed: true };
  });
}

module.exports = { atomicWriteFile, claudeProjectKeys, carryClaudeProjectConfig, ensureClaudeTrust, ensureCodexTrust, ensureClaudeBypassAccepted };

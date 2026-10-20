const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { carryClaudeProjectConfig } = require("./projectTrust.cjs");

// Claude Code's folder name for a project's transcripts under ~/.claude/projects.
function claudeProjectFolder(projectPath) {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

// Mirrors the repository id in projectKnowledge.cjs for a primary checkout.
function knowledgeId(projectPath) {
  return crypto.createHash("sha256").update(`git:${path.join(projectPath, ".git")}`).digest("hex").slice(0, 32);
}

async function linkTranscripts(home, fromPath, toPath) {
  const root = path.join(home, ".claude", "projects");
  const from = path.join(root, claudeProjectFolder(fromPath));
  const to = path.join(root, claudeProjectFolder(toPath));
  const names = await fs.promises.readdir(from).catch(() => []);
  if (!names.length) return 0;
  await fs.promises.mkdir(to, { recursive: true });
  let linked = 0;
  for (const name of names) {
    try {
      await fs.promises.symlink(path.join(from, name), path.join(to, name));
      linked += 1;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return linked;
}

async function copyKnowledge(directory, fromPath, toPath) {
  const toId = knowledgeId(toPath);
  const source = path.join(directory, `${knowledgeId(fromPath)}.json`);
  const target = path.join(directory, `${toId}.json`);
  const raw = await fs.promises.readFile(source, "utf8").catch(() => null);
  if (raw === null) return false;
  const state = JSON.parse(raw);
  try {
    await fs.promises.writeFile(target, JSON.stringify({ ...state, repositoryId: toId }), { mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Agents resolve a project's real path, and Claude keys MCP servers, trust and
 * transcripts by it, as Pitwall keys project knowledge. When a project is
 * reached through a symlink (moved, e.g. by iCloud Desktop sync) all of that
 * looks lost, so it is carried from the registered path to the real one.
 */
async function carryMovedProjects({ projectPaths, home, knowledgeDirectory, log = () => {} }) {
  const carried = [];
  for (const projectPath of new Set(projectPaths)) {
    const real = await fs.promises.realpath(projectPath).catch(() => null);
    if (!real || real === path.resolve(projectPath)) continue;
    try {
      const config = await carryClaudeProjectConfig(projectPath, real, home);
      const transcripts = await linkTranscripts(home, projectPath, real);
      const knowledge = knowledgeDirectory ? await copyKnowledge(knowledgeDirectory, projectPath, real) : false;
      if (config.changed || transcripts || knowledge) {
        carried.push(real);
        log(`[projects] carried ${projectPath} -> ${real} (config ${config.changed}, ${transcripts} transcripts, knowledge ${knowledge})`);
      }
    } catch (error) {
      log(`[projects] could not carry ${projectPath}: ${error.message}`);
    }
  }
  return carried;
}

module.exports = { carryMovedProjects, claudeProjectFolder, knowledgeId };

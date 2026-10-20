import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { carryMovedProjects, claudeProjectFolder, knowledgeId } = require("./projectMoves.cjs");

let home: string;
let knowledge: string;
let oldPath: string;
let realPath: string;

const readConfig = () => JSON.parse(fs.readFileSync(path.join(home, ".claude.json"), "utf8"));

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-moves-")));
  knowledge = path.join(home, "knowledge");
  fs.mkdirSync(knowledge);
  realPath = path.join(home, "Desktop - Mac", "Work", "admin");
  fs.mkdirSync(path.join(realPath, ".git"), { recursive: true });
  fs.mkdirSync(path.join(home, "Desktop"));
  fs.symlinkSync(path.dirname(realPath), path.join(home, "Desktop", "Work"));
  oldPath = path.join(home, "Desktop", "Work", "admin");

  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({
    projects: {
      [oldPath]: { hasTrustDialogAccepted: true, allowedTools: ["Bash(git:*)"], mcpServers: { atlassian: { type: "http" }, figma: { type: "http" } } },
      [realPath]: { allowedTools: ["Read"], mcpServers: { figma: { type: "stdio" } }, lastSessionId: "new" },
    },
  }));
  const transcripts = path.join(home, ".claude", "projects", claudeProjectFolder(oldPath));
  fs.mkdirSync(transcripts, { recursive: true });
  fs.writeFileSync(path.join(transcripts, "one.jsonl"), "{}\n");
  fs.writeFileSync(path.join(knowledge, `${knowledgeId(oldPath)}.json`), JSON.stringify({ version: 1, repositoryId: knowledgeId(oldPath), records: [{ id: "r" }] }));
});

afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe("carrying a moved project's state", () => {
  it("gives the real path the MCP servers, trust, transcripts and knowledge of the registered one", async () => {
    expect(await carryMovedProjects({ projectPaths: [oldPath], home, knowledgeDirectory: knowledge })).toEqual([realPath]);

    const carried = readConfig().projects[realPath];
    expect(carried.mcpServers).toEqual({ atlassian: { type: "http" }, figma: { type: "stdio" } });
    expect(carried.allowedTools).toEqual(["Bash(git:*)", "Read"]);
    expect(carried).toMatchObject({ hasTrustDialogAccepted: true, lastSessionId: "new" });
    expect(fs.readFileSync(path.join(home, ".claude", "projects", claudeProjectFolder(realPath), "one.jsonl"), "utf8")).toBe("{}\n");
    const copied = JSON.parse(fs.readFileSync(path.join(knowledge, `${knowledgeId(realPath)}.json`), "utf8"));
    expect(copied).toMatchObject({ repositoryId: knowledgeId(realPath), records: [{ id: "r" }] });
  });

  it("does nothing the second time, or for a project that was not moved", async () => {
    await carryMovedProjects({ projectPaths: [oldPath], home, knowledgeDirectory: knowledge });
    const before = fs.readFileSync(path.join(home, ".claude.json"), "utf8");

    expect(await carryMovedProjects({ projectPaths: [oldPath, realPath, path.join(home, "gone")], home, knowledgeDirectory: knowledge })).toEqual([]);
    expect(fs.readFileSync(path.join(home, ".claude.json"), "utf8")).toBe(before);
  });

  it("keeps knowledge already gathered at the real path", async () => {
    const existing = path.join(knowledge, `${knowledgeId(realPath)}.json`);
    fs.writeFileSync(existing, JSON.stringify({ repositoryId: knowledgeId(realPath), records: [] }));

    await carryMovedProjects({ projectPaths: [oldPath], home, knowledgeDirectory: knowledge });
    expect(JSON.parse(fs.readFileSync(existing, "utf8")).records).toEqual([]);
  });
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import scheduleModule from "../schedule.cjs";
import watchModule from "../watch.cjs";
import automationModule from "../automationSettings.cjs";
import memoryModule from "../memoryStore.cjs";
import mcpModule from "../mcpAuthProfiles.cjs";
import knowledgeModule from "../projectKnowledge.cjs";
import githubCredentialsModule from "../githubCredentials.cjs";
import fileStoresModule from "./fileStores.cjs";
import attachmentsModule from "./attachments.cjs";

const { collectFileStoreRecords, createFileStoreApplier, runsHere } = fileStoresModule;
const { applyAttachment, attachmentRecords, createAttachmentCollector, MAX_ATTACHMENT_BYTES } = attachmentsModule;

const temp = (name: string) => fs.mkdtempSync(path.join(os.tmpdir(), `pitwall-${name}-`));

function repo() {
  const dir = temp("repo");
  execFileSync("git", ["init", "-q", dir]);
  fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return dir;
}

function computer() {
  const userDataPath = temp("profile");
  const stores = {
    schedule: scheduleModule.createScheduleStore(path.join(userDataPath, "schedule.json")),
    watches: watchModule.createWatchStore(path.join(userDataPath, "watches.json")),
    automation: automationModule.createAutomationSettings(path.join(userDataPath, "automation-settings.json")),
    memory: memoryModule.createMemoryStore(path.join(userDataPath, "voice-memory.json")),
    mcp: mcpModule.createMcpAuthProfileStore(path.join(userDataPath, "mcp-auth-profiles.json")),
    knowledge: knowledgeModule.createProjectKnowledgeStore({ directory: path.join(userDataPath, "project-knowledge") }),
    voiceSettingsFile: path.join(userDataPath, "voice-settings.json"),
    credentials: githubCredentialsModule.createGitHubCredentialStore(path.join(userDataPath, "github-credentials.json"), {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => Buffer.from(`sealed:${text}`),
      decryptString: (buffer: Buffer) => String(buffer).slice("sealed:".length),
    }),
  };
  return { userDataPath, stores, applier: createFileStoreApplier({ stores, userDataPath }) };
}

describe("file stores", () => {
  it("carry schedules, watches, settings, memory, MCP bindings and project memory to another computer", async () => {
    const a = computer();
    const b = computer();
    const repoA = repo();
    const repoB = repo();
    a.stores.schedule.save({ id: "job-1", hour: 9, minute: 0, prompt: "Morning review", projectId: "shop", agent: "Claude", enabled: true, days: [] });
    a.stores.watches.addWatch({ projectId: "shop", projectPath: repoA, kind: "review-requested" });
    a.stores.automation.set({ boardSyncMinutes: 15 });
    a.stores.memory.remember({ note: "Prefers small PRs", projectId: "shop" });
    fs.writeFileSync(a.stores.voiceSettingsFile, JSON.stringify({ preset: "calm" }));
    a.stores.mcp.upsert({ projectId: "shop", projectPath: repoA, provider: "claude", name: "linear", target: "https://mcp.linear.app/sse" });
    const learned = await a.stores.knowledge.remember({ projectPath: repoA, observations: [{ title: "Use pnpm", content: "This repo installs with pnpm.", kind: "convention", origin: "user" }] });
    expect(learned.ok).not.toBe(false);

    const records = await collectFileStoreRecords(a.stores, [{ id: "shop", path: repoA }]);
    const kinds = records.map((record: { kind: string }) => record.kind).sort();
    expect(kinds).toEqual(["automationSettings", "knowledge", "mcpBindings", "schedule", "voiceMemory", "voiceSettings", "watch"]);
    expect(JSON.stringify(records.filter((record: { kind: string }) => record.kind === "watch"))).not.toContain(repoA);

    await b.applier.apply(records, (projectId: string) => (projectId === "shop" ? repoB : null));
    expect(b.stores.schedule.list()).toEqual([expect.objectContaining({ id: "job-1", prompt: "Morning review" })]);
    expect(b.stores.watches.list().watches).toEqual([expect.objectContaining({ projectId: "shop", projectPath: repoB })]);
    expect(b.stores.automation.get().boardSyncMinutes).toBe(15);
    expect(b.stores.memory.exportAll().notes.map((note: { note: string }) => note.note)).toEqual(["Prefers small PRs"]);
    expect(JSON.parse(fs.readFileSync(b.stores.voiceSettingsFile, "utf8"))).toEqual({ preset: "calm" });
    expect(b.stores.mcp.list({ projectId: "shop" })).toEqual([expect.objectContaining({ name: "linear" })]);
    const knowledge = await b.stores.knowledge.exportState({ projectPath: repoB });
    expect(knowledge.records.map((record: { title: string }) => record.title)).toEqual(["Use pnpm"]);
  });

  it("parks what belongs to a project this computer doesn't have yet, and applies it when it arrives", async () => {
    const a = computer();
    const b = computer();
    const repoA = repo();
    a.stores.watches.addWatch({ projectId: "shop", projectPath: repoA, kind: "review-requested" });
    const records = await collectFileStoreRecords(a.stores, []);
    await b.applier.apply(records, () => null);
    expect(b.stores.watches.list().watches).toEqual([]);
    expect(b.applier.parked()).toHaveLength(1);
    const repoB = repo();
    await b.applier.releaseParked((projectId: string) => (projectId === "shop" ? repoB : null));
    expect(b.stores.watches.list().watches).toEqual([expect.objectContaining({ projectPath: repoB })]);
    expect(b.applier.parked()).toEqual([]);
  });

  it("ties each job and watch to the computer it was made on, so it runs there only", async () => {
    const a = computer();
    const b = computer();
    const repoA = repo();
    a.stores.schedule.save({ id: "job-1", hour: 9, minute: 0, prompt: "Morning review", projectId: "shop", agent: "Claude", enabled: true, days: [] });
    a.stores.watches.addWatch({ projectId: "shop", projectPath: repoA, kind: "review-requested" });
    const records = await collectFileStoreRecords(a.stores, [{ id: "shop", path: repoA }], { deviceId: "mac" });
    expect(a.stores.schedule.list()[0].runsOn).toBe("mac");
    expect(a.stores.watches.list().watches[0].runsOn).toBe("mac");
    await b.applier.apply(records, () => repo());
    const job = b.stores.schedule.list()[0];
    expect(job.runsOn).toBe("mac");
    expect(runsHere(job, "pc")).toBe(false);
    expect(runsHere(job, "mac")).toBe(true);
    // Made before sync existed, or with sync off: runs where it is.
    expect(runsHere({ id: "old" }, "pc")).toBe(true);
    expect(runsHere(job, null)).toBe(true);
  });

  it("carries a project's git sign-in to another computer, once the project is there", async () => {
    const a = computer();
    const b = computer();
    const repoA = repo();
    a.stores.credentials.remember({ projectId: "shop", projectPath: repoA, host: "github.com", kind: "github", login: "someone", token: "ghp_fixture", source: "remote" });
    const records = await collectFileStoreRecords(a.stores, [{ id: "shop", path: repoA }]);
    expect(records.find((record: { kind: string }) => record.kind === "gitCredential")?.data).toMatchObject({ host: "github.com", login: "someone", token: "ghp_fixture" });
    await b.applier.apply(records, () => null);
    expect(b.stores.credentials.getStatus({ projectId: "shop" }).configured).toBe(false);
    expect(b.applier.credentialFor("shop")).toMatchObject({ host: "github.com", token: "ghp_fixture" });
    const repoB = repo();
    await b.applier.releaseParked((projectId: string) => (projectId === "shop" ? repoB : null));
    expect(b.stores.credentials.getEnvironment({ projectPath: repoB })).toMatchObject({ GH_TOKEN: "ghp_fixture" });
  });

  it("carries MCP servers but not whether this computer is signed in to them", async () => {
    const a = computer();
    const b = computer();
    const repoA = repo();
    const repoB = repo();
    a.stores.mcp.upsert({ projectId: "shop", projectPath: repoA, provider: "claude", name: "linear", target: "https://mcp.linear.app/sse" });
    a.stores.mcp.markAuthenticated?.({ projectId: "shop", projectPath: repoA, provider: "claude", name: "linear" });
    const state = a.stores.mcp.exportAll();
    state.projects.shop.bindings = state.projects.shop.bindings.map((binding: Record<string, unknown>) => ({ ...binding, authenticatedAt: "2026-10-12T10:00:00.000Z" }));
    const records = await collectFileStoreRecords({ ...a.stores, mcp: { ...a.stores.mcp, exportAll: () => state } }, [{ id: "shop", path: repoA }]);
    const sent = records.find((record: { kind: string }) => record.kind === "mcpBindings")?.data;
    expect(JSON.stringify(sent)).not.toContain("authenticatedAt");
    await b.applier.apply(records, () => repoB);
    expect(b.stores.mcp.list({ projectId: "shop" })).toEqual([expect.objectContaining({ name: "linear" })]);
    expect(b.stores.mcp.list({ projectId: "shop" })[0].authenticatedAt).toBeUndefined();
  });

  it("removes what was deleted elsewhere", async () => {
    const b = computer();
    b.stores.schedule.save({ id: "job-1", hour: 9, minute: 0, prompt: "x", projectId: "shop", agent: "Claude", enabled: true, days: [] });
    await b.applier.apply([{ kind: "schedule", localId: "job-1", data: null }], () => null);
    expect(b.stores.schedule.list()).toEqual([]);
  });
});

describe("attachments", () => {
  it("carries a task's image to the same place under the other computer's attachments", () => {
    const rootA = temp("attach-a");
    const rootB = temp("attach-b");
    const image = path.join(rootA, "task-draft-1", "shot.png");
    fs.mkdirSync(path.dirname(image));
    fs.writeFileSync(image, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
    const { records } = attachmentRecords([{ images: [image, "/elsewhere/not-ours.png"] }], rootA);
    expect(records).toHaveLength(1);
    expect(records[0].localId).toBe("task-draft-1/shot.png");
    const written = applyAttachment(rootB, records[0].data);
    expect(written).toBe(path.join(rootB, "task-draft-1", "shot.png"));
    expect(fs.readFileSync(written)).toEqual(fs.readFileSync(image));
  });

  it("skips an image over the size limit and says which", () => {
    const root = temp("attach-big");
    const image = path.join(root, "big.png");
    fs.writeFileSync(image, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    expect(attachmentRecords([{ images: [image] }], root)).toEqual({ records: [], skipped: ["big.png"] });
  });

  it("reads an image again only when the file changes", () => {
    const root = temp("attach-cache");
    const image = path.join(root, "shot.png");
    fs.writeFileSync(image, Buffer.from([1, 2, 3]));
    const collector = createAttachmentCollector();
    const first = collector.collect([{ images: [image] }], root).records[0];
    expect(collector.collect([{ images: [image] }], root).records[0]).toBe(first);
    expect(collector.reads()).toBe(1);
    fs.writeFileSync(image, Buffer.from([1, 2, 3, 4]));
    expect(collector.collect([{ images: [image] }], root).records[0].data.size).toBe(4);
    expect(collector.reads()).toBe(2);
  });

  it("refuses to write outside the attachments folder", () => {
    expect(applyAttachment(temp("attach-c"), { rel: "../../escape.png", bytes: "AA==" })).toBeNull();
  });
});

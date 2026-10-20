import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import transcripts from "./transcripts.cjs";

const { claudeDirName, locateTranscript, rewriteTranscript, supported, transplant } = transcripts;
const FROM = "/Users/fixture/Projects/shop";
const TO = "C:\\Users\\b\\Projects\\shop";
const claudeText = fs.readFileSync(path.join(__dirname, "__fixtures__", "claude-2.1.296.jsonl"), "utf8");
const codexText = fs.readFileSync(path.join(__dirname, "__fixtures__", "codex-0.162.1.jsonl"), "utf8");
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pitwall-transcripts-"));

function stripPaths(value: unknown): unknown {
  if (typeof value === "string") return value.split(FROM).join("<cwd>").split(TO).join("<cwd>").replace(/\\/g, "/");
  if (Array.isArray(value)) return value.map(stripPaths);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripPaths(item)]));
  return value;
}

describe("transcript rewriting", () => {
  it.each([["Claude Code", claudeText], ["Codex", codexText]])("moves every %s path to the new folder and changes nothing else", (_name, text) => {
    const moved = rewriteTranscript(text, { from: FROM, to: TO });
    expect(moved).not.toContain(FROM);
    expect(moved.split("\n")).toHaveLength(text.split("\n").length);
    const before = text.trim().split("\n").map((line) => stripPaths(JSON.parse(line)));
    const after = moved.trim().split("\n").map((line) => stripPaths(JSON.parse(line)));
    expect(after).toEqual(before);
  });

  it("rewrites the working directory, tool inputs and paths inside messages", () => {
    const lines = rewriteTranscript(claudeText, { from: FROM, to: "/home/b/shop" }).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[1].cwd).toBe("/home/b/shop");
    expect(lines[1].message.content).toBe("Fix the cart total in /home/b/shop/src/cart.ts please");
    expect(lines[2].message.content[0].input.file_path).toBe("/home/b/shop/src/cart.ts");
  });

  it("keeps a line it cannot parse, such as one still being written", () => {
    expect(rewriteTranscript(`${claudeText}{"type":"assist`, { from: FROM, to: "/x" }).endsWith('{"type":"assist')).toBe(true);
  });
});

describe("versions", () => {
  it("moves only versions a rewriter was checked against", () => {
    expect(supported("claude", "2.1.296")).toBe(true);
    expect(supported("claude", "3.0.0")).toBe(false);
    expect(supported("claude", "1.9.9")).toBe(false);
    expect(supported("codex", "0.162.1")).toBe(true);
    expect(supported("codex", "codex-cli 1.0.0")).toBe(false);
    expect(supported("hermes", "1.0.0")).toBe(false);
    expect(supported("claude", "")).toBe(false);
  });

  it("refuses to move an unsupported version", () => {
    const home = temp();
    expect(transplant({ cli: "claude", version: "3.0.0", files: [{ rel: "x.jsonl", bytes: Buffer.from(claudeText) }], from: FROM, to: "/x", home })).toEqual({ ok: false, reason: "unsupported-version" });
    expect(fs.readdirSync(home)).toEqual([]);
  });
});

describe("locating and transplanting", () => {
  it("finds a Claude conversation with its subagents, and writes it where Claude looks on the other computer", () => {
    const source = temp();
    const id = "11111111-2222-3333-4444-555555555555";
    const project = path.join(source, ".claude", "projects", claudeDirName(FROM));
    fs.mkdirSync(path.join(project, id, "subagents"), { recursive: true });
    fs.writeFileSync(path.join(project, `${id}.jsonl`), claudeText);
    fs.writeFileSync(path.join(project, id, "subagents", "agent-1.jsonl"), claudeText);
    const found = locateTranscript({ cli: "claude", nativeId: id, home: source });
    expect(found).toMatchObject({ version: "2.1.296", cwd: FROM });
    expect(found.files.map((file: { rel: string }) => file.rel).sort()).toEqual([`${id}.jsonl`, `${id}/subagents/agent-1.jsonl`]);

    const target = temp();
    const files = found.files.map((file: { abs: string; rel: string }) => ({ rel: file.rel, bytes: fs.readFileSync(file.abs) }));
    const result = transplant({ cli: "claude", version: found.version, files, from: FROM, to: "/Users/b/Projects/shop", home: target });
    expect(result.ok).toBe(true);
    const written = path.join(target, ".claude", "projects", "-Users-b-Projects-shop", `${id}.jsonl`);
    expect(fs.readFileSync(written, "utf8")).toContain('"cwd":"/Users/b/Projects/shop"');
    expect(fs.existsSync(path.join(target, ".claude", "projects", "-Users-b-Projects-shop", id, "subagents", "agent-1.jsonl"))).toBe(true);
    expect(locateTranscript({ cli: "claude", nativeId: id, home: target })?.cwd).toBe("/Users/b/Projects/shop");
  });

  it("finds a Codex rollout by id and keeps its dated place", () => {
    const source = temp();
    const id = "019fdb82-1972-7bb1-8d5b-73626a797dae";
    const day = path.join(source, ".codex", "sessions", "2026", "10", "12");
    fs.mkdirSync(day, { recursive: true });
    fs.writeFileSync(path.join(day, `rollout-2026-10-12T10-00-00-${id}.jsonl`), codexText);
    const found = locateTranscript({ cli: "codex", nativeId: id, home: source });
    expect(found).toMatchObject({ version: "0.162.1", cwd: FROM, files: [{ rel: `2026/10/12/rollout-2026-10-12T10-00-00-${id}.jsonl` }] });
    const target = temp();
    transplant({ cli: "codex", version: found.version, files: [{ rel: found.files[0].rel, bytes: Buffer.from(codexText) }], from: FROM, to: "/srv/shop", home: target });
    expect(locateTranscript({ cli: "codex", nativeId: id, home: target })?.cwd).toBe("/srv/shop");
  });

  it("keeps a copy that was continued differently here, instead of overwriting it", () => {
    const target = temp();
    const id = "11111111-2222-3333-4444-555555555555";
    const existing = path.join(target, ".claude", "projects", "-x", `${id}.jsonl`);
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    const divergent = `${claudeText.split("\n").slice(0, 2).join("\n")}\n{"type":"user","cwd":"/x","message":{"role":"user","content":"only here"}}\n`;
    fs.writeFileSync(existing, divergent);
    const incoming = `${claudeText}${claudeText}`;
    const result = transplant({ cli: "claude", version: "2.1.296", files: [{ rel: `${id}.jsonl`, bytes: Buffer.from(incoming) }], from: FROM, to: "/x", home: target });
    expect(result.ok).toBe(true);
    const backups = fs.readdirSync(path.dirname(existing)).filter((name) => name.includes(".pitwall-") && name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(existing), backups[0]), "utf8")).toBe(divergent);
  });

  it("leaves a longer local copy alone: it is the same conversation, continued here", () => {
    const target = temp();
    const id = "11111111-2222-3333-4444-555555555555";
    const existing = path.join(target, ".claude", "projects", "-x", `${id}.jsonl`);
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, rewriteTranscript(`${claudeText}${claudeText}${claudeText}`, { from: FROM, to: "/x" }));
    const result = transplant({ cli: "claude", version: "2.1.296", files: [{ rel: `${id}.jsonl`, bytes: Buffer.from(claudeText) }], from: FROM, to: "/x", home: target });
    expect(result).toEqual({ ok: true, written: [] });
    expect(fs.readFileSync(existing, "utf8")).toBe(rewriteTranscript(`${claudeText}${claudeText}${claudeText}`, { from: FROM, to: "/x" }));
  });
});

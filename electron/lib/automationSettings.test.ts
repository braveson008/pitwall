import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAutomationSettings, modelFor } from "./automationSettings.cjs";

const file = () => path.join(mkdtempSync(path.join(os.tmpdir(), "auto-")), "automation-settings.json");

describe("automation settings", () => {
  it("defaults to Sonnet everywhere and a 15-minute board re-read", () => {
    expect(createAutomationSettings(file()).get()).toEqual({ models: { tracker: "sonnet", review: "sonnet", fix: "sonnet", writer: "sonnet" }, boardSyncMinutes: 15 });
  });

  it("keeps what the person set, across a restart, and refuses nonsense", () => {
    const where = file();
    const settings = createAutomationSettings(where);
    settings.set({ models: { review: "opus", tracker: "claude-haiku-5-5" }, boardSyncMinutes: 60 });
    settings.set({ models: { fix: "rm -rf /" }, boardSyncMinutes: 7 });
    const again = createAutomationSettings(where).get();
    expect(again.models).toEqual({ tracker: "claude-haiku-5-5", review: "opus", fix: "sonnet", writer: "sonnet" });
    expect(again.boardSyncMinutes).toBe(60);
    expect(JSON.parse(readFileSync(where, "utf8")).models.review).toBe("opus");
  });

  it("lets a watch override the default for everything it does", () => {
    const settings = createAutomationSettings(file()).get();
    expect(modelFor(settings, "review", { config: {} })).toBe("sonnet");
    expect(modelFor(settings, "review", { config: { model: "opus" } })).toBe("opus");
    expect(modelFor(settings, "tracker", { config: { model: "" } })).toBe("sonnet");
  });

  it("takes a Codex model for any work but tracker reads", () => {
    const settings = createAutomationSettings(file());
    const saved = settings.set({ models: { review: "codex:gpt-6-astra", tracker: "codex:gpt-6-astra" } });
    expect(saved.models.review).toBe("codex:gpt-6-astra");
    expect(saved.models.tracker).toBe("sonnet");
  });

  it("takes Hermes for reviews only", () => {
    const settings = createAutomationSettings(file());
    const saved = settings.set({ models: { review: "hermes", fix: "hermes", writer: "hermes:poolside/laguna:free" } });
    expect(saved.models).toMatchObject({ review: "hermes", fix: "sonnet", writer: "sonnet" });
  });

  it("can turn the board's re-read off", () => {
    const settings = createAutomationSettings(file());
    expect(settings.set({ boardSyncMinutes: 0 }).boardSyncMinutes).toBe(0);
  });
});

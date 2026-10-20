import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import profiles from "./hermesProfiles.cjs";

const { hermesProfileName, withHermesProfile } = profiles;

describe("Hermes profiles", () => {
  it("names one profile per project, in Hermes's allowed form", () => {
    const name = hermesProfileName("project-123");
    expect(name).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    expect(hermesProfileName("project-123")).toBe(name);
    expect(hermesProfileName("project-456")).not.toBe(name);
    expect(hermesProfileName("")).toBe("");
  });

  it("puts the profile before the subcommand, where Hermes reads it", () => {
    const launch = { command: "hermes", args: ["chat", "--cli", "--resume", "20261006_224344_f695b1"], display: "" };
    const profiled = withHermesProfile(launch, "pitwall-abc");
    expect(profiled.args).toEqual(["-p", "pitwall-abc", "chat", "--cli", "--resume", "20261006_224344_f695b1"]);
    expect(profiled.hermesProfile).toBe("pitwall-abc");
    expect(withHermesProfile(launch, "")).toBe(launch);
  });

  it("keeps using a profile made under the old name, and prefers the new one once it exists", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pitwall-hermes-profiles-"));
    try {
      const fresh = hermesProfileName("project-123");
      const legacy = fresh.replace(/^pitwall-/, "braveli-");
      expect(hermesProfileName("project-123", dir)).toBe(fresh);
      mkdirSync(path.join(dir, legacy));
      expect(hermesProfileName("project-123", dir)).toBe(legacy);
      mkdirSync(path.join(dir, fresh));
      expect(hermesProfileName("project-123", dir)).toBe(fresh);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

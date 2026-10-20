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
    const profiled = withHermesProfile(launch, "braveli-abc");
    expect(profiled.args).toEqual(["-p", "braveli-abc", "chat", "--cli", "--resume", "20261006_224344_f695b1"]);
    expect(profiled.hermesProfile).toBe("braveli-abc");
    expect(withHermesProfile(launch, "")).toBe(launch);
  });
});

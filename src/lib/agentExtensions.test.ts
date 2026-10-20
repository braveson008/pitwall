import { describe, expect, it } from "vitest";
import { formatInstalls, formatTokens, matchesQuery, skillInstallNote } from "./agentExtensions";

describe("matchesQuery", () => {
  const row = { name: "figma-use", description: "Drive the Figma plugin API", pluginName: "figma" };

  it("matches everything against an empty search", () => {
    expect(matchesQuery(row, "")).toBe(true);
    expect(matchesQuery(row, "   ")).toBe(true);
  });

  // "figma" should find figma-use whether that word is in the skill's own name
  // or only in the plugin carrying it.
  it("finds a skill through the plugin that provides it", () => {
    expect(matchesQuery({ name: "use-motion", pluginName: "figma" }, "figma")).toBe(true);
  });

  it("narrows on a second word rather than widening", () => {
    expect(matchesQuery(row, "figma api")).toBe(true);
    expect(matchesQuery(row, "figma sentry")).toBe(false);
  });

  it("ignores case", () => {
    expect(matchesQuery(row, "FIGMA")).toBe(true);
  });

  it("survives a row with nothing in it", () => {
    expect(matchesQuery({}, "figma")).toBe(false);
  });
});

describe("formatTokens", () => {
  // The gap between 800 and 40,000 is the gap between "fine" and "a third of
  // the context before you type anything", so the unit has to be visible.
  it("keeps small counts exact", () => {
    expect(formatTokens(190)).toBe("190");
    expect(formatTokens(999)).toBe("999");
  });

  it("switches to thousands, with one decimal while that still means something", () => {
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(2069)).toBe("2.1k");
  });

  it("drops the decimal once the number is large enough not to need it", () => {
    expect(formatTokens(12700)).toBe("13k");
    expect(formatTokens(2000)).toBe("2k");
  });

  it("says nothing rather than zero", () => {
    expect(formatTokens(0)).toBe("");
    expect(formatTokens(null)).toBe("");
    expect(formatTokens(undefined)).toBe("");
  });
});

describe("formatInstalls", () => {
  it("rounds to the precision that is actually useful", () => {
    expect(formatInstalls(1_193_335)).toBe("1.2M");
    expect(formatInstalls(175_055)).toBe("175k");
    expect(formatInstalls(2713)).toBe("3k");
    expect(formatInstalls(120)).toBe("120");
  });

  it("says nothing when nobody has reported a count", () => {
    expect(formatInstalls(null)).toBe("");
    expect(formatInstalls(0)).toBe("");
  });
});

describe("skillInstallNote", () => {
  // Installing one skill and receiving twelve is a surprise worth heading off
  // on the row rather than explaining afterwards.
  it("says how many other skills come with it", () => {
    expect(skillInstallNote({ pluginName: "figma", siblings: 12 })).toBe("Installs figma, with 11 more skills");
  });

  it("gets the singular right", () => {
    expect(skillInstallNote({ pluginName: "figma", siblings: 2 })).toBe("Installs figma, with 1 more skill");
  });

  it("says just the plugin when the skill is the whole of it", () => {
    expect(skillInstallNote({ pluginName: "frontend-design", siblings: 1 })).toBe("Installs frontend-design");
  });
});

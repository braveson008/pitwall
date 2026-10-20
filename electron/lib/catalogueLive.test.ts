import { describe, expect, it } from "vitest";
import { npmPackage, activity, formatDownloads, repositoryMatches, fetchPackage } from "./catalogueLive.cjs";

const NOW = Date.parse("2026-08-28T00:00:00Z");

describe("npmPackage", () => {
  it("reads the package out of an install command", () => {
    expect(npmPackage("npm install -g opencode-ai")).toBe("opencode-ai");
    expect(npmPackage("npm i -g @qwen-code/qwen-code")).toBe("@qwen-code/qwen-code");
  });

  // Goose is a Homebrew formula and Aider a Python tool; neither has a
  // version on npm to look up.
  it("says nothing for an install that is not npm", () => {
    expect(npmPackage("brew install block-goose-cli")).toBe("");
    expect(npmPackage("uv tool install aider-chat")).toBe("");
    expect(npmPackage("")).toBe("");
  });
});

describe("activity", () => {
  const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

  it("says how recently it shipped, in words", () => {
    expect(activity(ago(3), NOW).label).toBe("updated this week");
    expect(activity(ago(40), NOW).label).toBe("updated this month");
    expect(activity(ago(120), NOW).label).toContain("months ago");
  });

  // Not a judgement about quality — plenty of finished software is finished.
  // It is the line past which the question is worth asking on screen.
  it("marks a package nobody has shipped in half a year", () => {
    expect(activity(ago(400), NOW).stale).toBe(true);
    expect(activity(ago(100), NOW).stale).toBe(false);
  });

  it("says nothing rather than guessing when there is no date", () => {
    expect(activity("", NOW)).toEqual({ label: "", stale: false });
    expect(activity("not a date", NOW).label).toBe("");
  });
});

describe("formatDownloads", () => {
  it("reads at the scale it is", () => {
    expect(formatDownloads(2_400_000)).toBe("2.4M");
    expect(formatDownloads(12_400)).toBe("12k");
    expect(formatDownloads(340)).toBe("340");
  });

  it("says nothing for a package with no figure", () => {
    expect(formatDownloads(0)).toBe("");
    expect(formatDownloads(Number.NaN)).toBe("");
  });
});

describe("repositoryMatches", () => {
  // The check that kept `grok-cli` out: a name that matches, publishing
  // something else. Re-run at runtime, because a package can change hands
  // after a list is written.
  it("catches a package pointing at a different project", () => {
    expect(repositoryMatches("git+https://github.com/whitesmith/grok-cli.git", "https://github.com/superagent-ai/grok-cli")).toBe(false);
  });

  it("passes a package pointing at its own project", () => {
    expect(repositoryMatches("git+https://github.com/QwenLM/qwen-code.git", "https://github.com/QwenLM/qwen-code")).toBe(true);
  });

  // Docs that are not on GitHub cannot be compared, and saying "mismatch"
  // there would flag every entry whose documentation has its own domain.
  it("declines to judge when there is nothing to compare", () => {
    expect(repositoryMatches("", "https://github.com/a/b")).toBeNull();
    expect(repositoryMatches("git+https://github.com/a/b.git", "https://opencode.ai/docs/")).toBeNull();
  });
});

describe("fetchPackage", () => {
  const reply = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

  it("reads version, date, downloads and repository", async () => {
    const result = await fetchPackage("demo", ((url: string) =>
      url.includes("downloads")
        ? reply({ downloads: 1234 })
        : reply({
            "dist-tags": { latest: "1.2.3" },
            time: { "1.2.3": "2026-08-01T00:00:00Z" },
            versions: { "1.2.3": { repository: { url: "git+https://github.com/a/b.git" } } },
          })) as unknown as typeof fetch);
    expect(result).toMatchObject({ version: "1.2.3", downloads: 1234, repository: "git+https://github.com/a/b.git" });
  });

  // A registry that is down must leave the catalogue readable, not empty.
  it("returns nothing rather than throwing when the registry is unreachable", async () => {
    const result = await fetchPackage("demo", (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch);
    expect(result).toBeNull();
  });
});

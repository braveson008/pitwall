import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { feedFromConfig, updaterYaml } = require("./updateFeed.cjs");

describe("update feed", () => {
  it("reads a generic feed, and an environment override wins", () => {
    expect(feedFromConfig({ enabled: true, url: "https://downloads.example/pitwall" }, {})).toEqual({ provider: "generic", url: "https://downloads.example/pitwall" });
    expect(feedFromConfig({ enabled: true, provider: "github", owner: "o", repo: "r" }, { PITWALL_UPDATE_URL: "http://127.0.0.1:9/" })).toEqual({ provider: "generic", url: "http://127.0.0.1:9/" });
  });

  it("reads a GitHub releases feed", () => {
    expect(feedFromConfig({ enabled: true, provider: "github", owner: "braveson008", repo: "pitwall" }, {})).toEqual({ provider: "github", owner: "braveson008", repo: "pitwall" });
  });

  it("has no feed when the build has none or switched it off", () => {
    expect(feedFromConfig(null, {})).toBeNull();
    expect(feedFromConfig({ enabled: false, url: "https://x" }, {})).toBeNull();
    expect(feedFromConfig({ enabled: true, provider: "github", owner: "", repo: "r" }, {})).toBeNull();
  });

  it("writes the updater's own configuration for either feed", () => {
    expect(updaterYaml({ provider: "generic", url: "https://x/p" })).toBe('provider: generic\nurl: "https://x/p"\nupdaterCacheDirName: pitwall-updater\n');
    expect(updaterYaml({ provider: "github", owner: "o", repo: "r" })).toBe('provider: github\nowner: "o"\nrepo: "r"\nupdaterCacheDirName: pitwall-updater\n');
  });
});

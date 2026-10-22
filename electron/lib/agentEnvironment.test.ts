import { describe, expect, it } from "vitest";
import { agentEnvironment, inheritedSessionMarkers, localeEnvironment } from "./agentEnvironment.cjs";

describe("agentEnvironment", () => {
  it("drops the markers of the session that launched Pitwall", () => {
    // Pitwall opened from inside a Claude Code session inherits its markers.
    // The spawned CLI reads them, decides it is a child of that session and
    // turns transcript saving off — so the conversation is never written to
    // disk and anything reading it afterwards sees nothing.
    const environment = agentEnvironment({
      PATH: "/usr/bin",
      LANG: "en_GB.UTF-8",
      CLAUDE_CODE_CHILD_SESSION: "1",
      CLAUDE_CODE_SESSION_ID: "5c1684a9-2917-4b4d-941c-bd1ca8118d5d",
      CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/72792.sock",
      CLAUDE_CODE_MESSAGING_TOKEN: "secret",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      CLAUDE_CODE_EXECPATH: "/somewhere/2.1.234",
    });

    for (const marker of inheritedSessionMarkers()) {
      expect(environment).not.toHaveProperty(marker);
    }
    expect(environment.PATH).toBe("/usr/bin");
  });

  it("leaves everything else alone", () => {
    const environment = agentEnvironment({
      PATH: "/usr/bin",
      LANG: "en_GB.UTF-8",
      ANTHROPIC_API_KEY: "kept",
      HOME: "/Users/someone",
    });
    expect(environment).toMatchObject({
      PATH: "/usr/bin",
      LANG: "en_GB.UTF-8",
      ANTHROPIC_API_KEY: "kept",
      HOME: "/Users/someone",
    });
  });

  it("does not mutate the environment it was given", () => {
    const base = { CLAUDE_CODE_CHILD_SESSION: "1", PATH: "/usr/bin" };
    agentEnvironment(base);
    expect(base.CLAUDE_CODE_CHILD_SESSION).toBe("1");
  });

  it("fills in a UTF-8 locale only when there is none", () => {
    expect(agentEnvironment({ PATH: "/usr/bin" })).toMatchObject({
      LANG: "en_US.UTF-8",
      LC_CTYPE: "en_US.UTF-8",
    });
    // A user who has chosen a locale keeps it, including a non-English one.
    expect(agentEnvironment({ LANG: "de_DE.UTF-8" }).LANG).toBe("de_DE.UTF-8");
    expect(agentEnvironment({ LC_ALL: "ja_JP.UTF-8" })).not.toHaveProperty("LANG");
  });
});

describe("localeEnvironment", () => {
  it("says nothing when a locale is already set", () => {
    expect(localeEnvironment({ LANG: "en_GB.UTF-8" })).toEqual({});
    expect(localeEnvironment({ LC_ALL: "C.UTF-8" })).toEqual({});
  });

  it("supplies one when the environment is silent — a GUI launch", () => {
    expect(localeEnvironment({})).toEqual({ LANG: "en_US.UTF-8", LC_CTYPE: "en_US.UTF-8" });
  });
});

describe("colour on Windows", () => {
  it("tells a CLI under ConPTY it may use truecolor, where no TERM says so", () => {
    expect(agentEnvironment({ PATH: "x" }, "win32").COLORTERM).toBe("truecolor");
    expect(agentEnvironment({ PATH: "x", COLORTERM: "24bit" }, "win32").COLORTERM).toBe("24bit");
    expect(agentEnvironment({ PATH: "x" }, "darwin").COLORTERM).toBeUndefined();
  });
});

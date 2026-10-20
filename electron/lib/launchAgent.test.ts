import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEDULER_LABEL, plistPath, renderPlist, syncLaunchAgent } from "./launchAgent.cjs";

describe("renderPlist", () => {
  const xml = renderPlist({
    executablePath: "/Applications/Pitwall.app/Contents/MacOS/Pitwall",
    times: [{ hour: 13, minute: 0 }, { hour: 9, minute: 5 }],
  });

  it("labels the agent and runs the executable with the fire flag", () => {
    expect(xml).toContain(`<string>${SCHEDULER_LABEL}</string>`);
    expect(xml).toContain("<string>/Applications/Pitwall.app/Contents/MacOS/Pitwall</string>");
    expect(xml).toContain("<string>--braveli-scheduler-fire</string>");
  });

  it("writes one StartCalendarInterval entry per time", () => {
    expect(xml.match(/<key>Hour<\/key>/g)).toHaveLength(2);
    expect(xml).toContain("<integer>13</integer>");
    expect(xml).toContain("<integer>5</integer>");
  });

  it("escapes a path containing XML metacharacters", () => {
    // An application folder can contain an ampersand. Unescaped, launchd
    // rejects the whole file and every job silently stops.
    const escaped = renderPlist({ executablePath: "/Apps/A & B/Pitwall", times: [{ hour: 1, minute: 0 }] });
    expect(escaped).toContain("/Apps/A &amp; B/Pitwall");
    expect(escaped).not.toContain("A & B");
  });

  it("names the weekday only when the booking has named days", () => {
    // An omitted key is a wildcard to launchd, so a booking with no days must
    // not carry Weekday at all — carrying 0 would pin it to Sunday.
    const every = renderPlist({ executablePath: "/x", times: [{ hour: 8, minute: 0 }] });
    expect(every).not.toContain("<key>Weekday</key>");
    const monday = renderPlist({ executablePath: "/x", times: [{ hour: 8, minute: 0, weekday: 1 }] });
    expect(monday).toContain("<key>Weekday</key><integer>1</integer>");
  });

  it("writes Sunday as a weekday rather than dropping it", () => {
    // 0 is falsy and is also a real day; a truthiness check here would wake
    // the machine every day for a booking made for Sundays only.
    expect(renderPlist({ executablePath: "/x", times: [{ hour: 8, minute: 0, weekday: 0 }] }))
      .toContain("<key>Weekday</key><integer>0</integer>");
  });

  it("is valid with no times", () => {
    expect(renderPlist({ executablePath: "/x", times: [] })).toContain("<array/>");
  });
});

describe("plistPath", () => {
  // launchd is macOS only; Windows schedules through Task Scheduler instead.
  it.skipIf(process.platform === "win32")("is in the user's LaunchAgents folder", () => {
    expect(plistPath("/Users/x")).toBe(`/Users/x/Library/LaunchAgents/${SCHEDULER_LABEL}.plist`);
  });
});

const home = () => mkdtempSync(join(tmpdir(), "home-"));

describe("syncLaunchAgent", () => {
  it("writes the plist and loads it", () => {
    const h = home();
    const commands: string[][] = [];
    const result = syncLaunchAgent({
      home: h, executablePath: "/x/Pitwall", times: [{ hour: 13, minute: 0 }], run: (args) => commands.push(args),
    });
    expect(result.written).toBe(true);
    expect(readFileSync(plistPath(h), "utf8")).toContain("<integer>13</integer>");
    expect(commands.some((args) => args[0] === "bootout")).toBe(true);
    expect(commands.some((args) => args[0] === "bootstrap")).toBe(true);
  });

  it("removes the plist when there are no times left", () => {
    const h = home();
    syncLaunchAgent({ home: h, executablePath: "/x/Pitwall", times: [{ hour: 1, minute: 0 }], run: () => {} });
    const result = syncLaunchAgent({ home: h, executablePath: "/x/Pitwall", times: [], run: () => {} });
    expect(result.removed).toBe(true);
    expect(existsSync(plistPath(h))).toBe(false);
  });

  it("rewrites when the executable has moved", () => {
    // The plist holds an absolute path. Moving the app out of /Applications
    // would otherwise stop every job with nothing saying so.
    const h = home();
    syncLaunchAgent({ home: h, executablePath: "/old/Pitwall", times: [{ hour: 1, minute: 0 }], run: () => {} });
    syncLaunchAgent({ home: h, executablePath: "/new/Pitwall", times: [{ hour: 1, minute: 0 }], run: () => {} });
    expect(readFileSync(plistPath(h), "utf8")).toContain("/new/Pitwall");
  });

  it("does not rewrite or reload when nothing changed", () => {
    // bootout on a live agent is a real action on the user's machine. It
    // happens when the file changes, not every time the app starts.
    const h = home();
    syncLaunchAgent({ home: h, executablePath: "/x/Pitwall", times: [{ hour: 1, minute: 0 }], run: () => {} });
    const commands: string[][] = [];
    const result = syncLaunchAgent({
      home: h, executablePath: "/x/Pitwall", times: [{ hour: 1, minute: 0 }], run: (args) => commands.push(args),
    });
    expect(result.written).toBe(false);
    expect(commands).toEqual([]);
  });

  it("survives launchctl refusing to unload something that was never loaded", () => {
    const h = home();
    expect(() => syncLaunchAgent({
      home: h, executablePath: "/x/Pitwall", times: [{ hour: 2, minute: 0 }],
      run: (args) => { if (args[0] === "bootout") throw new Error("No such process"); },
    })).not.toThrow();
    expect(existsSync(plistPath(h))).toBe(true);
  });
});

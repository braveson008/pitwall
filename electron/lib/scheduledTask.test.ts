import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error - CommonJS module without types
import { renderTaskXml, syncScheduledTask, taskXmlPath, TASK_NAME, FIRE_FLAG } from "./scheduledTask.cjs";

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "braveli-task-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

const EXE = "C:\\Program Files\\Pitwall\\Pitwall.exe";

describe("renderTaskXml", () => {
  it("gives a booking with no named days a daily trigger", () => {
    const xml = renderTaskXml({ executablePath: EXE, times: [{ hour: 8, minute: 0 }] });
    expect(xml).toContain("<StartBoundary>2020-01-01T08:00:00</StartBoundary>");
    expect(xml).toContain("<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>");
    expect(xml).not.toContain("ScheduleByWeek");
  });

  it("names the day for a booking that has one, in launchd's numbering", () => {
    // 0 is Sunday, which is what the schedule store already speaks.
    const xml = renderTaskXml({ executablePath: EXE, times: [{ hour: 9, minute: 30, weekday: 0 }] });
    expect(xml).toContain("<Sunday />");
    const monday = renderTaskXml({ executablePath: EXE, times: [{ hour: 9, minute: 30, weekday: 1 }] });
    expect(monday).toContain("<Monday />");
    const saturday = renderTaskXml({ executablePath: EXE, times: [{ hour: 9, minute: 30, weekday: 6 }] });
    expect(saturday).toContain("<Saturday />");
  });

  it("pads an hour and a minute, because the boundary is a fixed-width timestamp", () => {
    const xml = renderTaskXml({ executablePath: EXE, times: [{ hour: 7, minute: 5 }] });
    expect(xml).toContain("2020-01-01T07:05:00");
  });

  it("writes one trigger per booked time", () => {
    const xml = renderTaskXml({
      executablePath: EXE,
      times: [{ hour: 8, minute: 0 }, { hour: 12, minute: 0 }, { hour: 20, minute: 0 }],
    });
    expect(xml.match(/<CalendarTrigger>/g)).toHaveLength(3);
  });

  it("states the three settings whose defaults would stop it running", () => {
    const xml = renderTaskXml({ executablePath: EXE, times: [{ hour: 8, minute: 0 }] });
    // On a laptop off mains, Windows' default is to not run the task at all.
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    // And to kill it if the charger is pulled out mid-run.
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    // A time that passed while the machine slept is made up, as launchd does.
    expect(xml).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
  });

  it("escapes a path, so Program Files and an ampersand cannot break the XML", () => {
    const xml = renderTaskXml({
      executablePath: "C:\\Program Files\\Bits & Bobs\\Pitwall.exe",
      times: [{ hour: 8, minute: 0 }],
    });
    expect(xml).toContain("Bits &amp; Bobs");
    expect(xml).not.toContain("Bits & Bobs");
  });

  it("carries the flag the app fires on", () => {
    const xml = renderTaskXml({ executablePath: EXE, times: [{ hour: 8, minute: 0 }] });
    expect(xml).toContain(`<Arguments>${FIRE_FLAG}</Arguments>`);
  });
});

describe("syncScheduledTask", () => {
  it("registers with /F, so there is no window with no task in it", () => {
    const calls: string[][] = [];
    const result = syncScheduledTask({
      executablePath: EXE,
      times: [{ hour: 8, minute: 0 }],
      run: (args: string[]) => { calls.push(args); },
      directory,
    });
    expect(result).toEqual({ written: true, removed: false, name: TASK_NAME });
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 4)).toEqual(["/Create", "/TN", TASK_NAME, "/XML"]);
    // Replace rather than delete-then-create: a booked time cannot fall in a gap.
    expect(calls[0]).toContain("/F");
  });

  it("writes the definition as UTF-16 with a mark, which is the only form schtasks reads", () => {
    let staged = "";
    syncScheduledTask({
      executablePath: EXE,
      times: [{ hour: 8, minute: 0 }],
      // Read the file while it still exists — sync removes it afterwards.
      run: (args: string[]) => { staged = readFileSync(args[args.indexOf("/XML") + 1]).toString("utf16le"); },
      directory,
    });
    expect(staged.charCodeAt(0)).toBe(0xfeff);
    expect(staged).toContain("<Task version=");
    expect(staged).toContain("Pitwall.exe");
  });

  it("clears the staged file away once it has been read", () => {
    syncScheduledTask({
      executablePath: EXE,
      times: [{ hour: 8, minute: 0 }],
      run: () => {},
      directory,
    });
    expect(existsSync(taskXmlPath(directory))).toBe(false);
  });

  it("removes the task when nothing is booked", () => {
    const calls: string[][] = [];
    const result = syncScheduledTask({
      executablePath: EXE,
      times: [],
      run: (args: string[]) => { calls.push(args); },
      directory,
    });
    expect(result).toEqual({ written: false, removed: true, name: TASK_NAME });
    expect(calls).toEqual([["/Delete", "/TN", TASK_NAME, "/F"]]);
  });

  it("treats deleting a task that was never registered as the outcome asked for", () => {
    const result = syncScheduledTask({
      executablePath: EXE,
      times: [],
      run: () => { throw new Error("ERROR: The system cannot find the file specified."); },
      directory,
    });
    expect(result.removed).toBe(true);
  });
});

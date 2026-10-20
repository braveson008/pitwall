import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createTaskSimulatorCleaner } = require("./taskSimulators.cjs");

type Device = { udid: string; name: string; state: string };

function fakeSimctl(devices: Device[]) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[0] === "list") {
      return JSON.stringify({ devices: { "com.apple.CoreSimulator.SimRuntime.iOS-26-2": devices } });
    }
    return "";
  };
  return { calls, run };
}

const owned = { udid: "A", name: "Pitwall WEB-1-0123456789ab", state: "Shutdown" };
const booted = { udid: "B", name: "Pitwall WEB-2-0123456789ab", state: "Booted" };
const stock = { udid: "C", name: "iPhone 17 Pro", state: "Shutdown" };
const lookalike = { udid: "D", name: "Pitwall demo", state: "Shutdown" };
const otherApp = { udid: "E", name: "Other WEB-3-0123456789ab", state: "Shutdown" };

describe("task simulator cleanup", () => {
  it("deletes a released task's device, shutting it down first when booted", async () => {
    const simctl = fakeSimctl([owned, booted, stock]);
    const cleaner = createTaskSimulatorCleaner({ simctl: simctl.run, platform: "darwin" });

    expect(await cleaner.deleteNamed([owned.name, booted.name])).toBe(2);
    expect(simctl.calls.slice(1)).toEqual([["delete", "A"], ["shutdown", "B"], ["delete", "B"]]);
  });

  it("sweeps only shut-down devices that follow this app's task naming", async () => {
    const simctl = fakeSimctl([owned, booted, stock, lookalike, otherApp]);
    const cleaner = createTaskSimulatorCleaner({ simctl: simctl.run, platform: "darwin" });

    expect(await cleaner.sweepOrphans("Pitwall")).toBe(1);
    expect(simctl.calls.slice(1)).toEqual([["delete", "A"]]);
  });

  it("keeps devices a live task still owns", async () => {
    const simctl = fakeSimctl([owned]);
    const cleaner = createTaskSimulatorCleaner({ simctl: simctl.run, platform: "darwin" });

    expect(await cleaner.sweepOrphans("Pitwall", [owned.name])).toBe(0);
  });

  it("does nothing off macOS or without Xcode", async () => {
    const simctl = fakeSimctl([owned]);
    expect(await createTaskSimulatorCleaner({ simctl: simctl.run, platform: "win32" }).deleteNamed([owned.name])).toBe(0);
    expect(simctl.calls).toEqual([]);

    const missing = async () => {
      throw Object.assign(new Error("spawn xcrun ENOENT"), { code: "ENOENT" });
    };
    expect(await createTaskSimulatorCleaner({ simctl: missing, platform: "darwin" }).sweepOrphans("Pitwall")).toBe(0);
  });

  it("keeps going when one device cannot be deleted", async () => {
    const second = { ...owned, udid: "F", name: "Pitwall WEB-9-0123456789ab" };
    const logged: string[] = [];
    const run = async (args: string[]) => {
      if (args[0] === "list") return JSON.stringify({ devices: { ios: [owned, second] } });
      if (args[1] === "A") throw new Error("busy");
      return "";
    };
    const cleaner = createTaskSimulatorCleaner({ simctl: run, platform: "darwin", log: (message: string) => logged.push(message) });

    expect(await cleaner.sweepOrphans("Pitwall")).toBe(1);
    expect(logged).toHaveLength(1);
  });
});

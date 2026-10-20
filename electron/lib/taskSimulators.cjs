const { execFile } = require("node:child_process");

function simctl(args) {
  return new Promise((resolve, reject) => {
    execFile("xcrun", ["simctl", ...args], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function listedDevices(json) {
  const devices = JSON.parse(json || "{}").devices || {};
  return Object.values(devices).flat().filter((device) => device?.udid && device?.name);
}

function taskDevicePattern(prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped} .+-[a-f0-9]{12}$`);
}

// Agents create one simulator per task (taskRuntime.cjs); without this each finished task leaves GBs behind.
function createTaskSimulatorCleaner(options = {}) {
  const run = options.simctl || simctl;
  const platform = options.platform || process.platform;
  const log = options.log || (() => {});

  async function devices() {
    if (platform !== "darwin") return [];
    try {
      return listedDevices(await run(["list", "devices", "--json"]));
    } catch (error) {
      if (error?.code !== "ENOENT") log("simulator list failed", error);
      return [];
    }
  }

  async function remove(device) {
    try {
      if (device.state === "Booted") await run(["shutdown", device.udid]);
      await run(["delete", device.udid]);
      return true;
    } catch (error) {
      log(`simulator ${device.name} could not be deleted`, error);
      return false;
    }
  }

  return {
    async deleteNamed(names) {
      const wanted = new Set(names.filter(Boolean));
      if (!wanted.size) return 0;
      let deleted = 0;
      for (const device of await devices()) {
        if (wanted.has(device.name) && (await remove(device))) deleted += 1;
      }
      return deleted;
    },
    // Booted devices are skipped: a task resumed after a restart may be using one.
    async sweepOrphans(prefix, keepNames = []) {
      const pattern = taskDevicePattern(prefix);
      const keep = new Set(keepNames);
      let deleted = 0;
      for (const device of await devices()) {
        if (device.state === "Booted" || keep.has(device.name) || !pattern.test(device.name)) continue;
        if (await remove(device)) deleted += 1;
      }
      return deleted;
    },
  };
}

module.exports = { createTaskSimulatorCleaner };

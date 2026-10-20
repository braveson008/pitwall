"use strict";

/**
 * The LaunchAgent that wakes Pitwall at a scheduled time.
 *
 * Rendering the plist is kept apart from writing it, because the XML is the
 * part that can be wrong in ways nothing notices: launchd rejects a malformed
 * file silently, and every job simply stops happening. That failure is worth
 * a unit test; touching `~/Library` is not.
 */

const fs = require("node:fs");
const path = require("node:path");

const SCHEDULER_LABEL = "app.pitwall.scheduler";
const FIRE_FLAG = "--braveli-scheduler-fire";

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function plistPath(home) {
  return path.join(home, "Library", "LaunchAgents", `${SCHEDULER_LABEL}.plist`);
}

/**
 * One agent for every job.
 *
 * `StartCalendarInterval` takes an array, so a plist per job would buy nothing
 * and would leave orphans behind whenever a job was deleted while the app was
 * closed — an agent still waking a machine for work that no longer exists.
 */
function renderPlist({ executablePath, times = [] }) {
  const entries = times
    .map(({ hour, minute, weekday }) => {
      // Omitted keys are wildcards to launchd, so leaving Weekday out is what
      // makes a booking with no named days wake every day.
      const day = weekday === undefined || weekday === null
        ? ""
        : `<key>Weekday</key><integer>${Number(weekday)}</integer>`;
      return `      <dict>${day}<key>Hour</key><integer>${Number(hour)}</integer><key>Minute</key><integer>${Number(minute)}</integer></dict>`;
    })
    .join("\n");
  const interval = entries ? `    <array>\n${entries}\n    </array>` : "    <array/>";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${SCHEDULER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${escapeXml(executablePath)}</string>
      <string>${FIRE_FLAG}</string>
    </array>
    <key>StartCalendarInterval</key>
${interval}
    <key>ProcessType</key>
    <string>Interactive</string>
  </dict>
</plist>
`;
}

/**
 * Bring the agent into line with the jobs that exist.
 *
 * `run` takes an argv array rather than a command line: the plist path comes
 * from the user's home directory and must never be concatenated into a shell
 * string. Reloading is visible — `bootout` stops a live agent — so it happens
 * only when the file's contents actually change, not on every launch.
 */
function syncLaunchAgent({ home, executablePath, times = [], run }) {
  const target = plistPath(home);
  const wanted = times.length ? renderPlist({ executablePath, times }) : "";

  let current = "";
  try {
    current = fs.readFileSync(target, "utf8");
  } catch {
    current = "";
  }
  if (current === wanted) return { written: false, removed: false, path: target };

  const domain = `gui/${typeof process.getuid === "function" ? process.getuid() : ""}`;

  if (!wanted) {
    try {
      run(["bootout", `${domain}/${SCHEDULER_LABEL}`]);
    } catch {
      // Not loaded. Removing the file is still the right outcome.
    }
    try {
      fs.rmSync(target);
    } catch {
      // Already gone.
    }
    return { written: false, removed: true, path: target };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, wanted, "utf8");
  try {
    run(["bootout", `${domain}/${SCHEDULER_LABEL}`]);
  } catch {
    // It was not loaded yet, which is the normal first-run case.
  }
  run(["bootstrap", domain, target]);
  return { written: true, removed: false, path: target };
}

module.exports = { SCHEDULER_LABEL, FIRE_FLAG, escapeXml, plistPath, renderPlist, syncLaunchAgent };

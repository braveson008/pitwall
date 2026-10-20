"use strict";

/**
 * The Windows scheduled task that wakes Pitwall at a booked time.
 *
 * The counterpart to launchAgent.cjs, and split the same way: rendering the XML
 * is kept apart from registering it, because the XML is the part that can be
 * wrong in ways nothing notices. Task Scheduler rejects a malformed definition
 * with a number, and a definition it accepts can still never fire — which is
 * the failure this whole screen exists to prevent. That is worth a unit test;
 * touching the real scheduler is not.
 *
 * ## The defaults that would otherwise sink this
 *
 * A task created without an explicit `<Settings>` block inherits Windows'
 * defaults, and three of them are wrong for a booking someone made:
 *
 * - `DisallowStartIfOnBatteries` defaults to true, so on a laptop that is not
 *   plugged in the task simply does not run, and says nothing.
 * - `StopIfGoingOnBatteries` defaults to true, so unplugging mid-run kills the
 *   agent.
 * - `StartWhenAvailable` defaults to false, so a time that passed while the
 *   machine was asleep is not made up — where launchd fires on wake.
 *
 * All three are stated below, because a scheduler that quietly does nothing is
 * worse than one that is obviously broken.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TASK_NAME = "Pitwall\\Scheduler";
const FIRE_FLAG = "--braveli-scheduler-fire";

/** launchd's weekday numbering, which is what the schedule store already speaks. */
const WEEKDAY_ELEMENTS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pad(value) {
  return String(Number(value)).padStart(2, "0");
}

/**
 * One trigger per booked time, as launchd gets one dict per booked time.
 *
 * A trigger needs a start date as well as a start time even when it repeats
 * daily, so a fixed date in the past is used: it is the time of day and the
 * recurrence that matter, and a boundary already passed means the first
 * occurrence is the next matching time rather than one skipped day.
 */
function renderTrigger({ hour, minute, weekday }) {
  const boundary = `2020-01-01T${pad(hour)}:${pad(minute)}:00`;
  const schedule = weekday === undefined || weekday === null
    ? "<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>"
    : `<ScheduleByWeek><DaysOfWeek><${WEEKDAY_ELEMENTS[Number(weekday) % 7]} /></DaysOfWeek><WeeksInterval>1</WeeksInterval></ScheduleByWeek>`;
  return `    <CalendarTrigger>\n`
    + `      <StartBoundary>${boundary}</StartBoundary>\n`
    + `      <Enabled>true</Enabled>\n`
    + `      ${schedule}\n`
    + `    </CalendarTrigger>`;
}

function renderTaskXml({ executablePath, times = [] }) {
  const triggers = times.map(renderTrigger).join("\n");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Pitwall</Author>
    <Description>Wakes Pitwall to run its booked work.</Description>
    <URI>\\${escapeXml(TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
${triggers}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowHardTerminate>false</AllowHardTerminate>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(executablePath)}</Command>
      <Arguments>${escapeXml(FIRE_FLAG)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

/** Where the definition is staged before `schtasks` reads it back. */
function taskXmlPath(directory = os.tmpdir()) {
  return path.join(directory, "braveli-scheduler.xml");
}

/**
 * Registers the task, or removes it when nothing is booked.
 *
 * The file is written as UTF-16LE with a byte order mark, which is not a
 * stylistic choice: `schtasks /XML` reads the file as UTF-16 and a UTF-8 one is
 * rejected as malformed however correct its contents are.
 *
 * `run` is injected so the caller owns how a command is executed, and so this
 * can be tested without a scheduler.
 */
function syncScheduledTask({ executablePath, times = [], run, directory = os.tmpdir() }) {
  const wanted = times.length ? renderTaskXml({ executablePath, times }) : "";

  if (!wanted) {
    try {
      run(["/Delete", "/TN", TASK_NAME, "/F"]);
    } catch {
      // Not registered. Nothing to remove is the outcome asked for.
    }
    return { written: false, removed: true, name: TASK_NAME };
  }

  const target = taskXmlPath(directory);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `﻿${wanted}`, "utf16le");
  // /F replaces an existing registration, so there is no delete-then-create
  // window in which a booked time could be missed.
  run(["/Create", "/TN", TASK_NAME, "/XML", target, "/F"]);
  try {
    fs.rmSync(target);
  } catch {
    // Left behind in the temp directory, which is where it belongs anyway.
  }
  return { written: true, removed: false, name: TASK_NAME };
}

module.exports = {
  TASK_NAME,
  FIRE_FLAG,
  WEEKDAY_ELEMENTS,
  escapeXml,
  renderTrigger,
  renderTaskXml,
  taskXmlPath,
  syncScheduledTask,
};

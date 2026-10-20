/**
 * The launch line an agent actually receives.
 *
 * A council member shipped as `claude --permission-mode` with no value and died
 * with "argument missing", because the main process filtered launch arguments
 * to those beginning with "-" and threw the value away. Both halves of that
 * bug — the filter, and a token-level duplicate check — were invisible to unit
 * tests, which only ever saw the renderer's half of the arguments.
 *
 * So this asserts on the command line resolveLaunch builds, which is the thing
 * that was wrong.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "electron", "main.cjs"), "utf8");

// resolveLaunch is not exported — main.cjs boots Electron on require. The
// function is lifted out and evaluated on its own, which is enough to test the
// argument handling and needs no app.
const start = source.indexOf("function resolveLaunch(");
assert.ok(start > 0, "resolveLaunch not found in electron/main.cjs");
const body = source.slice(start, source.indexOf("\nfunction ", start + 10));

const stubs = `
  const expandHome = (p) => p || "";
  const agentProfiles = {
    Claude: { command: "claude", args: (model) => (!model || model === "auto" ? [] : ["--model", model]) },
  };
  const buildLaunchCommand = (profile, model) => [profile.command, ...profile.args(model)].join(" ");
  const applyNativeSessionLaunch = (launch) => launch;
  const applyInitialPromptLaunch = (launch) => launch;
  const promptFitsCommandLine = () => true;
`;
const resolveLaunch = new Function(`${stubs}\n${body}\nreturn resolveLaunch;`)();

// A flag that takes a value keeps its value.
{
  const launch = resolveLaunch(
    { agent: "Claude", model: "auto", extraArgs: ["--permission-mode", "auto"] },
    "/tmp/x",
  );
  assert.deepEqual(launch.args, ["--permission-mode", "auto"]);
  assert.ok(!/--permission-mode\s*$/.test(launch.display), "value was dropped from the display line");
  console.log("  OK  a flag's value survives (this is the bug that killed every Claude member)");
}

// A value matching something already present is not a duplicate flag.
{
  const launch = resolveLaunch(
    { agent: "Claude", model: "sonnet", extraArgs: ["--permission-mode", "sonnet"] },
    "/tmp/x",
  );
  assert.deepEqual(launch.args, ["--model", "sonnet", "--permission-mode", "sonnet"]);
  console.log("  OK  a value colliding with an existing argument is kept");
}

// The flag itself is still never repeated.
{
  const launch = resolveLaunch(
    { command: "claude", args: ["--dangerously-skip-permissions"], extraArgs: ["--dangerously-skip-permissions"] },
    "/tmp/x",
  );
  assert.deepEqual(launch.args, ["--dangerously-skip-permissions"]);
  console.log("  OK  a flag already present is not added twice");
}

// No extras means no change.
{
  const launch = resolveLaunch({ agent: "Claude", model: "auto" }, "/tmp/x");
  assert.deepEqual(launch.args, []);
  console.log("  OK  a session without the mode is launched exactly as before");
}

console.log("Pitwall launch argument smoke test passed.");

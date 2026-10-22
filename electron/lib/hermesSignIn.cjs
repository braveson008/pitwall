"use strict";

/**
 * Signs Hermes back in to Nous from inside Pitwall.
 *
 * Runs Hermes's own `hermes auth add nous --type oauth` for the main Hermes
 * home; project profiles carry no login of their own and borrow that one, so
 * one sign-in reconnects every project. When a still-valid shared login
 * exists Hermes offers to import it, and Pitwall accepts; otherwise Hermes
 * opens the browser for a device-code approval and waits for it.
 *
 * Wording checked against Hermes 0.21.5 (auth_commands.py, auth_device_flow.py).
 */

const { spawn } = require("node:child_process");
const { commandInvocation } = require("./platform.cjs");

/** What the login has printed so far, as one state. */
function readSignIn(text) {
  const value = String(text || "");
  if (/(?:Saved|Imported) nous OAuth (?:device-code )?credentials/i.test(value)) return { state: "done" };
  const code = value.match(/enter code:\s*([A-Z0-9-]+)/i)?.[1];
  const url = value.match(/Open:\s*(https:\/\/\S+)/)?.[1];
  if (code) return { state: "approve", code, url: url || "" };
  return { state: "starting" };
}

/**
 * Starts the login. `onState` hears "approve" (with the code to confirm) and
 * then "done" or "failed". Returns a function that cancels it.
 */
function startHermesSignIn({ command = "hermes", env, onState, spawnImpl = spawn, timeoutMs = 15 * 60_000 }) {
  let output = "";
  let last = "";
  let settled = false;
  // A real program on a Mac; on Windows a pip launcher or a .cmd shim, which only cmd can start.
  const start = commandInvocation(command, ["auth", "add", "nous", "--type", "oauth", "--timeout", "30"], { pathValue: env?.PATH });
  const child = spawnImpl(start.file, start.args, {
    ...start.spawnOptions,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const finish = (state) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    onState(state);
  };
  const timer = setTimeout(() => {
    try { child.kill(); } catch { /* already gone */ }
    finish({ state: "failed", message: "The sign-in was not approved in time." });
  }, timeoutMs);
  // Accepts the shared login if Hermes offers it; the device flow never reads stdin.
  try { child.stdin.write("y\n"); child.stdin.end(); } catch { /* nothing to answer */ }
  const read = (chunk) => {
    output = (output + chunk.toString()).slice(-20_000);
    const now = readSignIn(output);
    if (now.state === "approve" && last !== now.code) {
      last = now.code;
      onState(now);
    }
  };
  child.stdout.on("data", read);
  child.stderr.on("data", read);
  child.on("error", () => finish({ state: "failed", message: "Hermes could not be started." }));
  child.on("exit", (code) => {
    if (readSignIn(output).state === "done" || code === 0) finish({ state: "done" });
    else {
      const said = output.trim().split("\n").filter(Boolean).pop() || "";
      finish({ state: "failed", message: said.slice(0, 240) || "Hermes did not sign in." });
    }
  });
  return () => {
    try { child.kill(); } catch { /* already gone */ }
    finish({ state: "failed", message: "Sign-in cancelled." });
  };
}

module.exports = { readSignIn, startHermesSignIn };

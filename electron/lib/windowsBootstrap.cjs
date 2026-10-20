/**
 * Two process-wide defaults Windows needs, applied before anything else in the
 * main process loads. Does nothing on a Mac.
 *
 * 1. No console windows. Pitwall is a GUI app, and every git read, CLI probe
 *    and helper it starts would otherwise flash a console window (or, for a
 *    detached one like `ollama serve`, leave one open that closing kills).
 *    `windowsHide` becomes the default for every child_process call, including
 *    the ones libraries make; a caller can still pass `windowsHide: false`.
 *
 * 2. One spelling of PATH. Windows hands the process its environment with the
 *    key spelled `Path`. Code everywhere builds child environments as
 *    `{ ...process.env, PATH: extra }`, which then carries both `Path` and
 *    `PATH`, and the child reads whichever comes first — the inherited one —
 *    so the extra directories silently do nothing. Renaming the key once here
 *    makes every such spread replace it instead.
 */
const childProcess = require("node:child_process");

function hideByDefault(options) {
  if (options && typeof options === "object" && !Array.isArray(options)) {
    return options.windowsHide === undefined ? { ...options, windowsHide: true } : options;
  }
  return { windowsHide: true };
}

/** `fn(file, [args], [options], [callback])` with options in any optional slot. */
function patchArgsOptions(name) {
  const original = childProcess[name];
  if (typeof original !== "function" || original.__pitwallHidden) return;
  const patched = function patchedChildProcess(file, ...rest) {
    let index = 0;
    if (Array.isArray(rest[0])) index = 1;
    const candidate = rest[index];
    if (candidate === undefined || typeof candidate === "function") {
      rest.splice(index, 0, hideByDefault(undefined));
    } else if (candidate && typeof candidate === "object") {
      rest[index] = hideByDefault(candidate);
    }
    return original.call(this, file, ...rest);
  };
  patched.__pitwallHidden = true;
  childProcess[name] = patched;
}

/** `exec(command, [options], [callback])`. */
function patchCommandOptions(name) {
  const original = childProcess[name];
  if (typeof original !== "function" || original.__pitwallHidden) return;
  const patched = function patchedChildProcess(command, options, ...rest) {
    if (typeof options === "function" || options === undefined) {
      return original.call(this, command, hideByDefault(undefined), ...(options ? [options, ...rest] : rest));
    }
    return original.call(this, command, hideByDefault(options), ...rest);
  };
  patched.__pitwallHidden = true;
  childProcess[name] = patched;
}

function normalisePathKey(environment) {
  const keys = Object.keys(environment).filter((key) => key.toUpperCase() === "PATH");
  if (keys.length === 1 && keys[0] === "PATH") return;
  const value = keys.map((key) => environment[key]).find((entry) => entry) || "";
  for (const key of keys) delete environment[key];
  environment.PATH = value;
}

function applyWindowsDefaults(platform = process.platform, environment = process.env) {
  if (platform !== "win32") return false;
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "fork"]) patchArgsOptions(name);
  for (const name of ["exec", "execSync"]) patchCommandOptions(name);
  normalisePathKey(environment);
  return true;
}

applyWindowsDefaults();

module.exports = { applyWindowsDefaults, hideByDefault, normalisePathKey };

// Playwright's Electron launcher, made to run the smokes' fakes on Windows as well. On a Mac it is the launcher
// itself. On Windows two things a smoke takes for granted are not so:
//  - the fake CLIs are bash scripts, which Windows cannot run: each gets the `.cmd` beside it that an npm-installed
//    CLI has, handing it to Git for Windows' bash, so Pitwall finds and starts it the way it starts the real ones;
//  - a fake home is HOME, which Windows ignores for the home directory: USERPROFILE is set to it too.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright";

const isWindows = process.platform === "win32";
const traced = new Set();
process.on("exit", () => {
  for (const directory of traced) {
    try { console.log(`[shim calls]\n${readFileSync(path.join(directory, "shim-calls.log"), "utf8").slice(-6000)}`); } catch { /* none made */ }
  }
});

function gitBash() {
  const candidates = [
    process.env.PITWALL_TEST_BASH,
    ...String(process.env.PATH || "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "..", "bin", "bash.exe")),
    "C:\\Program Files\\Git\\bin\\bash.exe",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("The smokes' fake CLIs need Git for Windows' bash.exe");
  return path.resolve(found);
}

/** Writes `<name>.cmd` beside every script in `directory` that starts with #!, and has none yet. */
export function shimScripts(directory) {
  if (!isWindows || !existsSync(directory)) return;
  let bash;
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    if (path.extname(name) || name.startsWith("_shim") || existsSync(`${file}.cmd`) || !statSync(file).isFile()) continue;
    const shebang = readFileSync(file, "utf8").split("\n", 1)[0];
    if (!shebang.startsWith("#!")) continue;
    // A script for a Windows program (#!C:\...\node.exe) runs under it; a shell script under Git's bash.
    const interpreter = shebang.slice(2).trim();
    if (/\.exe$/i.test(interpreter) && existsSync(interpreter)) {
      writeFileSync(`${file}.cmd`, `@"${interpreter}" "%~dp0${name}" %*\r\n`);
      continue;
    }
    bash ??= gitBash();
    // Traced, each call's arguments as bash received them go to shim-calls.log beside it.
    const logger = path.join(directory, "_shim-log.sh");
    if (process.env.PITWALL_SMOKE_TRACE === "1" && !existsSync(logger)) {
      writeFileSync(logger, `#!/bin/bash\nprintf '%s\\n' "$(basename "$1") \${*:2}" >> "$(dirname "$1")/shim-calls.log"\nexec "$@"\n`);
    }
    const record = process.env.PITWALL_SMOKE_TRACE === "1" ? `"%~dp0_shim-log.sh" ` : "";
    writeFileSync(`${file}.cmd`, `@"${bash}" ${record}"%~dp0${name}" %*\r\n`);
    traced.add(directory);
  }
}

// Only directories a smoke made: shimming the runner's own PATH would be writing into the machine.
function testDirectories(pathValue) {
  const temp = path.resolve(os.tmpdir()).toLowerCase();
  return String(pathValue || "").split(path.delimiter).filter((dir) => dir && path.resolve(dir).toLowerCase().startsWith(temp));
}

// PITWALL_SMOKE_TRACE=1: the main process's output and every notice the app shows, in the smoke's own log.
async function trace(app) {
  const child = app.process();
  child.stdout?.on("data", (chunk) => process.stdout.write(String(chunk).replace(/^/gm, "[main] ")));
  child.stderr?.on("data", (chunk) => process.stdout.write(String(chunk).replace(/^/gm, "[main!] ")));
  let last = "";
  const timer = setInterval(async () => {
    try {
      const page = app.windows()[0];
      if (!page) return;
      const text = await page.evaluate(() => [...document.querySelectorAll(".dk-toast, [role='alert'], [role='status']")].map((node) => node.textContent?.trim()).filter(Boolean).join(" | "));
      if (text && text !== last) console.log(`[notice] ${text}`);
      last = text;
    } catch { /* between windows */ }
  }, 500);
  timer.unref();
  app.on("close", () => clearInterval(timer));
}

export const electron = {
  ..._electron,
  async launch(options = {}) {
    const env = { ...(options.env || process.env) };
    if (isWindows) {
      if (env.HOME) env.USERPROFILE = env.HOME;
      for (const directory of testDirectories(env.PATH || env.Path)) shimScripts(directory);
    }
    const app = await _electron.launch(isWindows ? { ...options, env } : options);
    if (process.env.PITWALL_SMOKE_TRACE === "1") await trace(app);
    return app;
  },
};

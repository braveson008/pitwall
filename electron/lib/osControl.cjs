/**
 * Controlling the computer itself: launching applications and revealing paths.
 *
 * Everything here goes through `open(1)` with argv arrays rather than a shell
 * string, and application names are resolved against what is *actually
 * installed* before anything is launched. That resolution is the security
 * boundary — a spoken name never reaches a command line unchecked, so a
 * mis-transcription fails to match instead of executing something unexpected.
 *
 * Name matching is its own pure function because it is the part that has to
 * cope with human speech: "VS Code", "vscode" and "the editor" all mean one
 * app, and the transcriber will spell it a different way each time.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const APPLICATION_DIRECTORIES = [
  "/Applications",
  "/Applications/Utilities",
  "/System/Applications",
  "/System/Applications/Utilities",
];

/**
 * Spoken shorthand → the app names it could mean, in preference order. Only
 * the ambiguous or heavily-abbreviated cases need an entry; an exact name
 * matches on its own.
 */
const ALIASES = {
  vscode: ["visualstudiocode", "code", "cursor", "vscodium"],
  editor: ["visualstudiocode", "cursor", "sublimetext", "zed"],
  browser: ["googlechrome", "arc", "safari", "firefox", "microsoftedge"],
  chrome: ["googlechrome"],
  terminal: ["iterm", "iterm2", "warp", "ghostty", "terminal", "alacritty"],
  shell: ["iterm", "warp", "terminal"],
  design: ["figma", "sketch"],
  chat: ["slack", "discord"],
  music: ["spotify", "music"],
  notes: ["notion", "obsidian", "notes"],
  mail: ["mail", "superhuman", "sparkmail"],
  calendar: ["calendar", "fantastical"],
  docker: ["docker", "orbstack"],
  postman: ["postman", "insomnia"],
};

const ARTICLES = new Set(["the", "a", "an", "my", "our"]);

function squash(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripArticles(value) {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word && !ARTICLES.has(word))
    .join(" ");
}

/**
 * Resolve a spoken application name against a list of installed application
 * names. Returns the installed name verbatim, or null when nothing matches —
 * never a best guess, because launching the wrong app is a real surprise.
 */
function matchApplication(spoken, installed) {
  const phrase = stripArticles(spoken);
  if (!phrase) return null;

  const wanted = squash(phrase);
  const index = installed.map((name) => ({ name, key: squash(name) }));

  const exact = index.find((entry) => entry.key === wanted);
  if (exact) return exact.name;

  for (const candidate of ALIASES[wanted] || []) {
    const hit = index.find((entry) => entry.key === candidate);
    if (hit) return hit.name;
  }

  // "visual studio" → "Visual Studio Code": a prefix match is safe because the
  // spoken form is shorter than the real name, which is the normal direction
  // for abbreviation.
  const prefixed = index.filter((entry) => entry.key.startsWith(wanted));
  if (prefixed.length === 1) return prefixed[0].name;

  const contained = index.filter((entry) => entry.key.includes(wanted));
  if (contained.length === 1) return contained[0].name;

  // Several apps match, so the request was genuinely ambiguous. Alias order
  // encodes a preference; without one, refuse rather than pick arbitrarily.
  return null;
}

/** Common sites people name rather than spell out. */
const SITE_SHORTHAND = {
  github: "https://github.com",
  gitlab: "https://gitlab.com",
  figma: "https://figma.com",
  linear: "https://linear.app",
  jira: "https://jira.com",
  slack: "https://slack.com",
  npm: "https://npmjs.com",
  mdn: "https://developer.mozilla.org",
  stackoverflow: "https://stackoverflow.com",
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
};

/**
 * Turn something a person said into a URL, or null.
 *
 * Only http/https survive. A scheme like `javascript:` or `file:` is not a
 * page, and a spoken request can never legitimately mean one.
 */
function normalizeSpokenUrl(spoken) {
  let value = String(spoken || "").trim();
  if (!value) return null;

  // "github dot com" / "github dot com slash braveson008"
  value = value
    .replace(/\s+dot\s+/gi, ".")
    .replace(/\s+slash\s+/gi, "/")
    .replace(/\s+/g, "");

  const shorthand = SITE_SHORTHAND[value.toLowerCase().replace(/[^a-z]/g, "")];
  if (shorthand) return shorthand;

  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) value = `https://${value}`;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // A host with no dot is not a domain — it is a mis-transcription.
  if (!parsed.hostname.includes(".")) return null;
  return parsed.toString();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Convert a git remote into the URL a person would open in a browser.
 * Handles both `git@host:owner/repo.git` and `https://host/owner/repo.git`.
 */
function remoteToWebUrl(remote) {
  const value = String(remote || "").trim();
  if (!value) return null;

  const ssh = value.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/i);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `https://${parsed.hostname}${parsed.pathname.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

function listInstalledApplications(directories = APPLICATION_DIRECTORIES) {
  const names = new Set();
  for (const directory of directories) {
    let entries = [];
    try {
      entries = fs.readdirSync(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".app")) names.add(entry.slice(0, -4));
    }
  }
  return Array.from(names).sort();
}

function runOpen(args) {
  if (process.platform !== "darwin") {
    return Promise.resolve({ ok: false, error: "Opening applications by name is available on macOS only." });
  }
  return new Promise((resolve) => {
    execFile("/usr/bin/open", args, { timeout: 15_000 }, (error, _stdout, stderr) => {
      if (error) resolve({ ok: false, error: (stderr || error.message).trim() });
      else resolve({ ok: true });
    });
  });
}

function createOsControl(options = {}) {
  const listApplications = options.listApplications || listInstalledApplications;
  const open = options.open || runOpen;

  async function launchApp(params, context = {}) {
    const installed = listApplications();
    const resolved = matchApplication(params.name, installed);
    if (!resolved) {
      return {
        ok: false,
        error: `No installed application matches "${params.name}".`,
        speak: `I couldn't find an app called ${params.name}.`,
      };
    }

    const args = ["-a", resolved];
    if (params.withProject && context.projectPath) args.push(context.projectPath);

    const result = await open(args);
    if (!result.ok) return { ok: false, error: result.error, speak: `I couldn't open ${resolved}.` };

    return {
      ok: true,
      opened: resolved,
      speak:
        params.withProject && context.projectPath
          ? `Opened ${resolved} on ${path.basename(context.projectPath)}.`
          : `Opened ${resolved}.`,
    };
  }

  /**
   * Open a web page, optionally in a named browser.
   *
   * Spoken URLs arrive without a scheme ("open github dot com") and sometimes
   * with the transcriber's spacing ("git hub.com"), so the input is normalised
   * before use. Only http and https are accepted: `javascript:`, `file:` and
   * `data:` URLs are all things a mis-transcription or a page-injected string
   * could plausibly produce, and none of them are ever what someone meant by
   * "open a page".
   */
  async function openUrl(params, context = {}) {
    const normalized = normalizeSpokenUrl(params.url);
    if (!normalized) {
      return { ok: false, error: `"${params.url}" is not a web address.`, speak: "That didn't look like a web address." };
    }

    const args = [];
    if (params.browser) {
      const resolved = matchApplication(params.browser, listApplications());
      if (!resolved) {
        return {
          ok: false,
          error: `No installed browser matches "${params.browser}".`,
          speak: `I couldn't find a browser called ${params.browser}.`,
        };
      }
      args.push("-a", resolved);
      const result = await open([...args, normalized]);
      if (!result.ok) return { ok: false, error: result.error, speak: `I couldn't open that in ${resolved}.` };
      return { ok: true, url: normalized, browser: resolved, speak: `Opened ${hostOf(normalized)} in ${resolved}.` };
    }

    const result = await open([normalized]);
    if (!result.ok) return { ok: false, error: result.error, speak: "I couldn't open that page." };
    return { ok: true, url: normalized, speak: `Opened ${hostOf(normalized)}.` };
  }

  async function revealPath(params, context = {}) {
    if (!context.projectPath) {
      return { ok: false, error: "No active project.", speak: "There's no active project to reveal." };
    }

    // Resolve inside the project and verify containment: a transcribed path is
    // untrusted input, and "../.." is a thing people say by accident.
    const root = path.resolve(context.projectPath);
    const target = params.path ? path.resolve(root, params.path) : root;
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      return { ok: false, error: "That path is outside the project.", speak: "That path is outside the project." };
    }
    if (!fs.existsSync(target)) {
      return { ok: false, error: `${params.path} does not exist.`, speak: `I couldn't find ${params.path}.` };
    }

    const result = await open(["-R", target]);
    if (!result.ok) return { ok: false, error: result.error, speak: "I couldn't reveal that in Finder." };
    return { ok: true, path: target, speak: `Showing ${path.basename(target)} in Finder.` };
  }

  return { launchApp, openUrl, revealPath, listInstalledApplications: listApplications };
}

module.exports = {
  createOsControl,
  matchApplication,
  normalizeSpokenUrl,
  remoteToWebUrl,
  listInstalledApplications,
  squash,
};

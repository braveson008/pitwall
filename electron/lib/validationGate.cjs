/**
 * The checks a project already has, run before any model is asked anything.
 *
 * A failing typecheck is not a matter of opinion. Sending one to a reviewer
 * spends judgement on something a compiler already decided, and the review it
 * writes will be about the error rather than about the work. So the cheap
 * deterministic answer comes first, every time, and the expensive one is only
 * asked when there is genuinely something to judge.
 *
 * ## Discovered, not configured
 *
 * The commands are read out of the project's own `package.json`. A gate that
 * has to be configured before it works is a gate most people never turn on,
 * and one that guesses `npm test` on a repository with no test script fails
 * loudly at the worst moment. What is there is run; what is not there is
 * reported as not configured, which is different from passing.
 */

const path = require("node:path");
const fs = require("node:fs");

/**
 * Which scripts count as which check.
 *
 * Ordered by cost. Typecheck and lint answer in seconds and catch most of
 * what an implementer gets wrong; a build or a test suite can take minutes,
 * so they run after the quick ones have had their say.
 */
const CHECK_SCRIPTS = [
  { name: "typecheck", candidates: ["typecheck", "type-check", "tsc", "types"] },
  { name: "lint", candidates: ["lint", "eslint"] },
  { name: "tests", candidates: ["test", "tests", "test:unit"] },
  { name: "build", candidates: ["build"] },
];

/** Reads the scripts a project actually has. */
function readScripts(projectPath) {
  try {
    const raw = fs.readFileSync(path.join(projectPath, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.scripts === "object" && parsed.scripts ? parsed.scripts : {};
  } catch {
    return {};
  }
}

/**
 * The checks this project can answer, in the order they should be asked.
 *
 * A check with no script is reported rather than dropped: "lint is not
 * configured" is a fact a reviewer should have, and it is not the same fact
 * as "lint passed".
 */
function planChecks(projectPath, { only } = {}) {
  const scripts = readScripts(projectPath);
  return CHECK_SCRIPTS
    .filter((check) => !only || only.includes(check.name))
    .map((check) => {
      const script = check.candidates.find((candidate) => typeof scripts[candidate] === "string" && scripts[candidate].trim());
      return {
        name: check.name,
        command: script ? `npm run ${script} --silent` : "",
        script: script || "",
        skipped: !script,
      };
    });
}

/**
 * Whether a run is worth showing a reviewer, and what to say about it.
 *
 * Skipped checks never make a run fail. A repository with no linter has not
 * failed its lint; it has no lint, and treating the two the same would block
 * every project that does not happen to share this one's conventions.
 */
function summarise(checks) {
  const ran = checks.filter((check) => !check.skipped);
  const failed = ran.filter((check) => !check.ok);
  return {
    ok: failed.length === 0,
    ranCount: ran.length,
    failedNames: failed.map((check) => check.name),
  };
}

/**
 * Keeps the end of a long output.
 *
 * A compiler prints the error last and the files it read first, so the tail
 * is the part worth carrying. Truncating from the front would reliably keep
 * the least useful half.
 */
function trimOutput(output, limit = 4000) {
  const text = String(output || "");
  if (text.length <= limit) return text;
  return `[…${text.length - limit} characters trimmed]\n${text.slice(-limit)}`;
}

module.exports = { CHECK_SCRIPTS, planChecks, readScripts, summarise, trimOutput };

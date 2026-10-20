/**
 * Working out what the user is looking at, and what just went wrong.
 *
 * Three tiers, cheapest and most accurate first:
 *
 *   1. **Pitwall's own state.** When the frontmost app is Pitwall, nothing
 *      needs observing — the terminal buffer, the open file, the branch and
 *      the last test run are already in hand, exactly, as text.
 *   2. **The accessibility tree.** For any other app, `pitwall-observe` reads
 *      the focused window as structured text. Free, exact, and it captures
 *      what is scrolled off screen.
 *   3. **A screenshot.** Only when the first two produce nothing usable —
 *      a Figma canvas, a video, an app that exposes no accessibility tree.
 *
 * The ordering is the product requirement, but it is also just correct: OCR of
 * a stack trace is strictly worse than the stack trace.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** Lines that look like something failed, most recent last. */
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed?\b/i,
  /\bexception\b/i,
  /\bcannot\b/i,
  /\bunable to\b/i,
  /\bnot found\b/i,
  /\bundefined is not\b/i,
  /\bis not a function\b/i,
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /\bSyntaxError\b/,
  /\bTraceback\b/,
  /^\s*at .+:\d+:\d+/,
  /\bECONN|\bENOENT|\bEACCES|\bEADDRINUSE/,
  /\bpanic:/,
  /✕|✗|FAIL\b/,
];

/**
 * Pull the failure out of a wall of output. Returns the error lines plus a few
 * lines of trailing context, because a stack trace without the line that
 * preceded it usually cannot be explained.
 */
function extractErrorLines(text, { maxLines = 60 } = {}) {
  if (typeof text !== "string" || !text.trim()) return [];
  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (ERROR_PATTERNS.some((pattern) => pattern.test(lines[index]))) hits.push(index);
  }
  if (!hits.length) return [];

  const keep = new Set();
  // Only the last cluster matters: earlier failures in a long-lived terminal
  // are usually ones the user already dealt with.
  const lastHit = hits[hits.length - 1];
  const clusterStart = hits.find((index) => lastHit - index < 40) ?? lastHit;
  for (let index = Math.max(0, clusterStart - 2); index <= Math.min(lines.length - 1, lastHit + 8); index += 1) {
    keep.add(index);
  }

  return Array.from(keep)
    .sort((a, b) => a - b)
    .slice(-maxLines)
    .map((index) => lines[index])
    .filter((line) => line.trim().length);
}

function runObserver(binaryPath, timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!binaryPath) {
      resolve({ ok: false, error: "The screen observer has not been built." });
      return;
    }
    execFile(binaryPath, [], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      try {
        resolve({ ok: true, ...JSON.parse(stdout) });
      } catch {
        resolve({ ok: false, error: "The screen observer returned unreadable output." });
      }
    });
  });
}

function captureScreenshot(timeoutMs = 10_000) {
  if (process.platform !== "darwin") {
    return Promise.resolve({ ok: false, error: "Reading the screen is available on macOS only." });
  }
  return new Promise((resolve) => {
    const target = path.join(os.tmpdir(), `pitwall-screen-${Date.now()}.png`);
    // -x silences the shutter, -o omits window shadow. This uses the Screen
    // Recording permission; without it macOS produces a desktop-only image
    // rather than failing, which is why the caller checks the file size.
    execFile("/usr/sbin/screencapture", ["-x", "-o", "-t", "png", target], { timeout: timeoutMs }, (error) => {
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }
      try {
        const { size } = fs.statSync(target);
        resolve({ ok: true, path: target, size });
      } catch {
        resolve({ ok: false, error: "The screenshot could not be written." });
      }
    });
  });
}

function describePitwallState(context) {
  return [
    context.projectName ? `Project: ${context.projectName}` : null,
    context.branch ? `Branch: ${context.branch}${context.dirty ? " (uncommitted changes)" : ""}` : null,
    context.openFile ? `Open in the editor: ${context.openFile}` : null,
    context.workbenchTab ? `Pitwall is showing the ${context.workbenchTab} pane` : null,
    context.activeSession ? `Active agent session: ${context.activeSession}` : null,
    context.terminalTail ? `Recent terminal output:\n${context.terminalTail}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function createScreenContext(deps) {
  const { runConductor, observerPath, observe = runObserver, capture = captureScreenshot } = deps;

  async function gather(params = {}, context = {}) {
    const evidence = { tier: null, pitwall: describePitwallState(context) };

    const observation = await observe(typeof observerPath === "function" ? observerPath() : observerPath);
    if (observation.ok) {
      evidence.app = observation.app;
      evidence.window = observation.window;
      evidence.selection = observation.selection || "";
      evidence.windowText = observation.text || "";
      evidence.accessibilityTrusted = observation.trusted !== false;
    } else {
      evidence.observerError = observation.error;
      evidence.accessibilityTrusted = false;
    }

    const looksLikePitwall = /pitwall|electron/i.test(evidence.app || "");
    if (looksLikePitwall && evidence.pitwall) {
      evidence.tier = "pitwall-state";
      return evidence;
    }

    if (evidence.windowText && evidence.windowText.trim().length > 40) {
      evidence.tier = "accessibility";
      return evidence;
    }

    // Nothing structured was readable. This is the case screenshots exist for.
    if (params.allowScreenshot !== false) {
      const shot = await capture();
      if (shot.ok) {
        evidence.tier = "screenshot";
        evidence.screenshotPath = shot.path;
      } else {
        evidence.screenshotError = shot.error;
      }
    }

    if (!evidence.tier) evidence.tier = evidence.pitwall ? "pitwall-state" : "none";
    return evidence;
  }

  function evidencePrompt(evidence, instruction) {
    const sections = [
      instruction,
      "",
      "Answer in one to three short sentences. This is read aloud, so no markdown, no bullet points, no code blocks.",
      "",
      "## Evidence",
      evidence.app ? `Frontmost application: ${evidence.app}` : null,
      evidence.window ? `Window title: ${evidence.window}` : null,
      evidence.selection ? `The user has this text selected:\n${evidence.selection}` : null,
      evidence.pitwall ? `Pitwall's own state:\n${evidence.pitwall}` : null,
      evidence.windowText ? `Text read from the window:\n${evidence.windowText.slice(0, 8000)}` : null,
      evidence.screenshotPath
        ? `No structured text was available, so a screenshot was taken. Read the image at ${evidence.screenshotPath} and describe it.`
        : null,
      evidence.tier === "none"
        ? "No screen information could be gathered. Say so plainly and mention that Accessibility permission may be needed."
        : null,
    ].filter((section) => section !== null);

    return sections.join("\n");
  }

  async function explain(evidence, instruction, fallbackSpeech) {
    const reply = await runConductor(evidencePrompt(evidence, instruction), {
      allowRead: Boolean(evidence.screenshotPath),
    });

    // The screenshot is transient evidence, not a file the user asked for.
    if (evidence.screenshotPath) fs.promises.rm(evidence.screenshotPath, { force: true }).catch(() => {});

    if (!reply?.ok) {
      return { ok: false, error: reply?.error || "I couldn't work out what's on screen.", speak: fallbackSpeech };
    }
    const answer = String(reply.raw || "").trim();
    if (!answer) return { ok: false, error: "Empty answer.", speak: fallbackSpeech };
    return { ok: true, tier: evidence.tier, app: evidence.app, speak: answer };
  }

  async function describe(params, context) {
    const evidence = await gather(params, context);
    return explain(
      evidence,
      "You are Pitwall, a voice assistant for a software engineer. The user asked what they are currently looking at. Describe it concretely — the application, what is being shown, and anything notable such as an error, a failing test, or unsaved work.",
      "I couldn't tell what's on screen.",
    );
  }

  async function explainError(params, context) {
    const evidence = await gather({ ...params, allowScreenshot: false }, context);

    // Pitwall's own output is the best source for a failure, because it has
    // the whole buffer rather than the visible portion of it.
    const sources = [context.terminalTail, context.lastTestOutput, evidence.selection, evidence.windowText];
    const errorLines = sources.flatMap((source) => extractErrorLines(source));

    if (!errorLines.length) {
      // Nothing looks like an error anywhere, which is itself the answer.
      return {
        ok: true,
        speak: "I can't see an error right now. Nothing in the terminal, the last test run, or the focused window looks like a failure.",
        tier: evidence.tier,
      };
    }

    evidence.errorText = errorLines.join("\n").slice(0, 6000);
    return explain(
      {
        ...evidence,
        windowText: "",
        pitwall: `${evidence.pitwall}\n\nThe failure:\n${evidence.errorText}`,
      },
      "You are Pitwall, a voice assistant for a software engineer. The user asked why something is failing. Explain what the error means and the most likely fix. Be specific about the file or command involved when the evidence names one.",
      "I found an error but couldn't explain it.",
    );
  }

  return { describe, explainError, gather, extractErrorLines };
}

module.exports = { createScreenContext, extractErrorLines, captureScreenshot, runObserver };

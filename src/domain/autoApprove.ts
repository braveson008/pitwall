/**
 * Running a council without a human answering permission prompts.
 *
 * A council is meant to run unattended: members hand work between themselves
 * for twenty turns while you do something else. But every one of these CLIs
 * stops and asks before it writes a file or runs a command, and a member
 * sitting on an unanswered prompt holds the whole relay — the conductor cannot
 * route past it, and the turn eventually times out having done nothing.
 *
 * So each member can be launched in the mode its own CLI provides for exactly
 * this. Pitwall does not implement the bypass; it passes the flag the CLI
 * already documents, and the CLI's own rules still apply.
 *
 * ## Every flag here was read out of the CLI, not remembered
 *
 * A wrong flag is not a broken feature. On a CLI that validates its arguments
 * the session fails to launch, which is at least loud; on one that ignores
 * unknown flags — Qwen Code accepts `--definitely-not-a-real-flag` without
 * complaint — the session starts, the user is told it is running unattended,
 * and it stops at the first prompt anyway. That is the worst outcome: a
 * promise the app cannot keep, failing silently.
 *
 * So an agent with no verified flag is not offered the mode at all. It runs
 * exactly as it does today and the UI says why, which is a smaller feature and
 * a true one.
 *
 * ## The flag being accepted is not the same as the mode working
 *
 * Claude accepts `--dangerously-skip-permissions` and then opens a consent
 * screen: "you accept all responsibility", Yes / No, and it exits 1 when
 * nothing answers. The flag was right and the feature was still broken, which
 * is why each entry here was checked by launching the CLI in a PTY and reading
 * what actually came back — not by confirming the argument parses.
 *
 * Pitwall does not click that screen. It records the acceptance the user
 * already gave — by switching this mode on — in the council worktree's own
 * settings, which is where Claude looks for it. The user's global Claude
 * config is untouched, so every session outside that worktree still asks.
 */

export interface AutoApproveMode {
  /** The agent's `command`, which is what a session is actually launched with. */
  command: string;
  /** Arguments appended at launch. */
  args: string[];
  /** How the CLI's own documentation describes the mode. */
  label: string;
  /** Where the flag was read from, so a future change can be re-checked. */
  verifiedFrom: string;
}

/**
 * Verified 2026-08-31 against the installed CLIs and, for Gemini, the packaged
 * tarball from npm. Re-check when a CLI is upgraded: these are other people's
 * command-line interfaces and they are free to change them.
 */
export const AUTO_APPROVE: AutoApproveMode[] = [
  {
    command: "claude",
    // Full bypass, which is what the mode says on the tin. `--permission-mode
    // auto` was tried first and is not the same thing: its classifier still
    // denies actions, so a council member gets blocked rather than asked, and
    // the person who turned this on cannot tell the difference from a stall.
    //
    // Claude will not enter this mode until the bypass disclaimer has been
    // accepted, and no flag skips that screen. Pitwall records the acceptance
    // in the council worktree's own `.claude/settings.local.json` when this
    // mode is switched on — scoped to that folder, so Claude keeps asking
    // everywhere else. See ensureClaudeBypassAccepted in electron/main.cjs.
    args: ["--dangerously-skip-permissions"],
    label: "Bypass all permission checks",
    verifiedFrom: "claude --help; disclaimer gate read from the binary (skipDangerousModePermissionPrompt)",
  },
  {
    command: "codex",
    // Codex separates the approval policy from the sandbox, and asking it to
    // skip approvals while leaving the sandbox on gets a member that stops
    // being asked and starts being denied — which stalls the relay just the
    // same, only less visibly. This is the single flag Codex documents for
    // "no prompts, no sandbox".
    args: ["--dangerously-bypass-approvals-and-sandbox"],
    label: "Skip all confirmation prompts and run without sandboxing",
    verifiedFrom: "codex --help",
  },
  {
    command: "gemini",
    args: ["--yolo"],
    label: "Automatically accept all actions",
    verifiedFrom: "@google/gemini-cli tarball, yargs option definition",
  },
  {
    command: "hermes",
    // Hermes gates only "dangerous" terminal commands; file writes never ask.
    // Checked in a PTY on 0.21.5: the status bar shows YOLO and nothing is
    // drawn in front of the input box.
    args: ["--yolo"],
    label: "Run dangerous commands without asking",
    verifiedFrom: "hermes chat --help; PTY launch on 0.21.5",
  },
  {
    command: "qwen",
    // Not from `qwen --help`, which does not list it: read from the yargs
    // option definition in the shipped bundle. The help test was worthless
    // anyway — Qwen accepts flags that do not exist.
    args: ["--yolo"],
    label: "Automatically accept all actions",
    verifiedFrom: "@qwen-code/qwen-code bundle, yargs option definition",
  },
];

const byCommand = new Map(AUTO_APPROVE.map((mode) => [mode.command, mode]));

/** The mode for an agent, or null when no flag has been verified for it. */
export function autoApproveFor(command: string | undefined): AutoApproveMode | null {
  return byCommand.get(String(command || "").trim()) ?? null;
}

export function supportsAutoApprove(command: string | undefined): boolean {
  return autoApproveFor(command) !== null;
}

/**
 * Launch arguments with the bypass appended, when one is known and wanted.
 *
 * Returns the arguments unchanged in every other case, so a caller can apply
 * this unconditionally and an agent Pitwall cannot vouch for simply keeps its
 * prompts.
 */
export function withAutoApprove(
  command: string | undefined,
  args: string[] | undefined,
  enabled: boolean,
): string[] {
  const base = args ?? [];
  if (!enabled) return base;
  const mode = autoApproveFor(command);
  if (!mode) return base;
  // Never twice: a repeated flag is an error on some CLIs and a confusing
  // command line on all of them.
  //
  // Decided on the flag, not on each token. Filtering tokens individually
  // looked equivalent and was not: `--permission-mode auto` against a session
  // already carrying `--model auto` dropped the value as a duplicate and
  // produced `--model auto --permission-mode` with nothing after it. "Auto" is
  // the default entry in the model dropdown, so that was the common case.
  const [flag] = mode.args;
  if (base.includes(flag)) return base;
  return [...base, ...mode.args];
}

/**
 * Which of a roster's agents will actually run unattended.
 *
 * The council setup shows this before you start, because "auto-approve" that
 * silently applies to three of four members is worse than none: you leave it
 * running and come back to one member that stopped on turn two.
 */
export function splitByAutoApprove(commands: string[]): { covered: string[]; uncovered: string[] } {
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const command of commands) {
    const target = supportsAutoApprove(command) ? covered : uncovered;
    if (command && !target.includes(command)) target.push(command);
  }
  return { covered, uncovered };
}

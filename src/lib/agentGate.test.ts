import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codexUpdatePromptShowing, looksLikeAgentGate } from "./agentGate";

describe("looksLikeAgentGate", () => {
  it("spots the trust prompt every CLI opens with", () => {
    expect(looksLikeAgentGate("Do you trust the files in this folder?")).toBe(true);
    expect(looksLikeAgentGate("? Do you trust the files in this directory")).toBe(true);
    expect(looksLikeAgentGate("This folder has not been trusted")).toBe(true);
    expect(looksLikeAgentGate("Press Enter to continue")).toBe(true);
  });

  it("spots sign-in and credential prompts", () => {
    expect(looksLikeAgentGate("Please sign in to continue")).toBe(true);
    expect(looksLikeAgentGate("Sign in with ChatGPT")).toBe(true);
    expect(looksLikeAgentGate("Enter your API key:")).toBe(true);
    expect(looksLikeAgentGate("Authentication required")).toBe(true);
    expect(looksLikeAgentGate("How would you like to authenticate?")).toBe(true);
    expect(looksLikeAgentGate("Select a login method")).toBe(true);
  });

  it("does not stall a council over an agent discussing authentication", () => {
    // Taken from a real council turn that was parked for this: the word
    // "unauthenticated" contains "authenticate", which the old substring check
    // matched, throwing away a twenty-minute turn.
    const realTurn = [
      "pattern syntax: 50% matched every shop, a_1 matched AB1, and a",
      "wildcard-dense term hands Postgres's backtracking matcher four text",
      "columns unauthenticated. Escaped, with the semantics checked in psql.",
    ].join("\n");
    expect(looksLikeAgentGate(realTurn)).toBe(false);
  });

  it("ignores other ordinary prose about auth", () => {
    expect(looksLikeAgentGate("Fixed an unauthorized access path in the shops service.")).toBe(false);
    expect(looksLikeAgentGate("The endpoint returns 401 for unauthenticated callers.")).toBe(false);
    expect(looksLikeAgentGate("I added tests covering the login flow and the signin redirect.")).toBe(false);
    expect(looksLikeAgentGate("Renamed authorizeUser to requireSession across 12 files.")).toBe(false);
  });

  it("treats a long line as prose even when it contains a prompt phrase", () => {
    const essay = `We considered whether to ${"pad ".repeat(60)} do you trust the files in this folder`;
    expect(essay.length).toBeGreaterThan(160);
    expect(looksLikeAgentGate(essay)).toBe(false);
  });

  it("only looks at the tail, so an old prompt does not gate a working pane", () => {
    const output = ["Do you trust the files in this folder?", ...Array.from({ length: 40 }, (_, i) => `working line ${i}`)].join("\n");
    expect(looksLikeAgentGate(output)).toBe(false);
  });

  it("sees through ANSI colouring", () => {
    expect(looksLikeAgentGate("[33mPlease sign in to continue[0m")).toBe(true);
  });

  it("treats empty or ordinary output as ready", () => {
    expect(looksLikeAgentGate("")).toBe(false);
    expect(looksLikeAgentGate("$ claude\nclaude ready\n")).toBe(false);
  });
});

describe("looksLikeAgentGate, against real terminal captures", () => {
  // Recorded from the actual CLIs on 2026-08-31 by spawning each in a PTY.
  // Hand-written approximations of TUI output are useless here: the whole
  // reason these prompts were missed is how the real bytes arrive.
  const fixture = (name: string) =>
    readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

  it("sees Codex's self-update prompt, which is one 656-character line", () => {
    // Missed before: the pane paints its layout with cursor movement rather
    // than newlines, so the whole screen was a single line and the
    // short-lines-only rule threw it away. Pitwall then typed a council brief
    // into it, and Enter chose the preselected "1. Update now" — a global npm
    // install that failed EACCES and killed the pane.
    expect(looksLikeAgentGate(fixture("codex-update-prompt.txt"))).toBe(true);
  });

  it("sees Codex's own sign-in screen", () => {
    // Missed before: every word and row is placed with cursor moves, so
    // deleting the escapes read "2.SigninwithDeviceCode" on one 500-character
    // line. The capture ends on it: a signed-out home, after the update menu.
    const skipped = fixture("codex-update-skipped.txt");
    expect(looksLikeAgentGate(skipped)).toBe(true);
    expect(looksLikeAgentGate(skipped.slice(skipped.indexOf("\x1b[1;1H  Welcome")))).toBe(true);
  });

  it("reads a cursor move as the space or line break it drew", () => {
    expect(looksLikeAgentGate("\x1b[9;6HSign\x1b[9;11Hin\x1b[9;14Hwith\x1b[9;19HDevice")).toBe(true);
    expect(looksLikeAgentGate("Sign\x1b[1Cin\x1b[1Cwith\x1b[1CChatGPT")).toBe(true);
    const rows = `\x1b[1;1H${"working ".repeat(15)}\x1b[2;1HPlease sign in to continue\x1b[3;1H${"working ".repeat(15)}`;
    expect(looksLikeAgentGate(rows)).toBe(true);
  });

  it("sees Claude's bypass-permissions consent screen", () => {
    // No flag combination skips this — every one the CLI accepts was tried.
    // Unanswered, the process exits 1 and the member never starts, so it has
    // to surface as a gate rather than as a dead pane.
    expect(looksLikeAgentGate(fixture("claude-bypass-consent.txt"))).toBe(true);
  });

  it("still reads an agent discussing auth as work, not as a prompt", () => {
    // The regression this whole file guards. Segmenting on box characters
    // must not make prose easier to mistake for a prompt.
    const prose = [
      "I reviewed the four ingestion paths. Two of them reach the API",
      "unauthenticated, which is why the nightly job silently drops rows.",
      "The fix is to require authentication at the boundary rather than",
      "per-handler — I have written that up in the handoff.",
    ].join("\n");
    expect(looksLikeAgentGate(prose)).toBe(false);
  });

  it("is not fooled by a member quoting a prompt it saw", () => {
    const quoted =
      "The previous run stopped because the CLI asked whether to trust the folder, " +
      "and nobody answered it, so I am recording that here for the next member rather " +
      "than trying to work around it myself in this turn of the council.";
    expect(looksLikeAgentGate(quoted)).toBe(false);
  });
});

describe("startup advice is not a gate", () => {
  // Every line here is real, copied from a council whose members sat idle
  // because Pitwall read the CLI's opening notices as a prompt and never sent
  // turn 1. None of them is waiting on anything: they name a command to run
  // later, which is the opposite of a question blocking the pane.
  it("lets a login-expiry notice through", () => {
    expect(looksLikeAgentGate("Your login expires in 1 day · run /login to renew")).toBe(false);
  });

  it("lets an MCP authentication notice through", () => {
    expect(looksLikeAgentGate("2 MCP servers need authentication · run /mcp")).toBe(false);
    expect(looksLikeAgentGate("The linear MCP server is not logged in. Run `codex mcp login linear`.")).toBe(false);
    expect(looksLikeAgentGate("The jira MCP server requires OAuth reauthentication. Run `codex mcp login jira`.")).toBe(false);
    expect(looksLikeAgentGate("MCP startup incomplete (failed: jira, linear)")).toBe(false);
  });

  it("lets an update notice through when it only names a command", () => {
    expect(looksLikeAgentGate("Run npm install -g @openai/codex to update.")).toBe(false);
  });

  it("still catches a prompt that is actually waiting", () => {
    // The guard must not swallow the real thing it exists for.
    expect(looksLikeAgentGate("Do you trust the files in this folder?")).toBe(true);
    expect(looksLikeAgentGate("Please sign in to continue")).toBe(true);
    expect(looksLikeAgentGate("1. Update now")).toBe(true);
    expect(looksLikeAgentGate("Yes, I accept")).toBe(true);
  });
});

describe("codexUpdatePromptShowing", () => {
  // Recorded from codex-cli 0.157.0 in a PTY on 2026-09-25, with a cached
  // version.json naming a newer release so the menu would open.
  const fixture = (name: string) =>
    readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

  it("recognises the menu in the full-screen and inline layouts", () => {
    expect(codexUpdatePromptShowing(fixture("codex-update-prompt.txt"))).toBe(true);
    expect(codexUpdatePromptShowing(fixture("codex-update-prompt-0.157.txt"))).toBe(true);
    // Painted over the main screen, with "Update available" arriving as
    // "Updat" + a cursor jump because the cell already held an "e".
    expect(codexUpdatePromptShowing(fixture("codex-update-prompt-inline.txt"))).toBe(true);
  });

  it("recognises the wording from the reported screenshot", () => {
    const screen = [
      "\x1b[1m✨ Update available! \x1b[2m0.154.0 -> 0.156.1\x1b[0m",
      "Release notes: https://github.com/openai/codex/releases/latest",
      "\x1b[36m› 1. Update now (runs `npm install -g @openai/codex`)\x1b[0m",
      "  2. Skip",
      "  3. Skip until next version",
      "\x1b[2mPress enter to continue\x1b[0m",
    ].join("\r\n");
    expect(codexUpdatePromptShowing(screen)).toBe(true);
    expect(looksLikeAgentGate(screen)).toBe(true);
  });

  it("lets go once Codex repaints its own screen after Skip", () => {
    // The whole capture: "2" was sent, the menu closed, and this signed-out
    // test home moved on to the sign-in screen.
    const skipped = fixture("codex-update-skipped.txt");
    expect(codexUpdatePromptShowing(skipped)).toBe(false);

    // Cut before the sign-in screen, which is what a signed-in pane shows: the
    // repainted composer, with the answered menu still in the tail above it.
    const ready = skipped.slice(0, skipped.indexOf("\x1b[1;1H  Welcome"));
    expect(codexUpdatePromptShowing(ready)).toBe(false);
    expect(looksLikeAgentGate(ready)).toBe(false);
  });

  it("ignores a member quoting the menu mid-reply", () => {
    const quoted = [
      "The Codex pane was stuck on its update menu:",
      "Update available! 0.154.0 -> 0.156.1",
      "1. Update now  2. Skip  3. Skip until next version",
      "so I have written up how Pitwall should answer it, including the tests",
      "that cover the full-screen and inline layouts and the digit it sends.",
    ].join("\n");
    expect(codexUpdatePromptShowing(quoted)).toBe(false);
  });

  it("does not answer a menu quoted in a reply, even with the footer", () => {
    // Codex's startup screen from a real capture, then a reply that quotes the
    // whole menu and adds one short line. "2" typed here would land in the
    // composer and prefix the next turn.
    const reply = fixture("codex-reply-quoting-update-menu.txt");
    expect(codexUpdatePromptShowing(reply)).toBe(false);
  });

  it("needs more than one phrase", () => {
    expect(codexUpdatePromptShowing("Update available")).toBe(false);
    expect(codexUpdatePromptShowing("")).toBe(false);
    expect(codexUpdatePromptShowing("Run npm install -g @openai/codex to update.")).toBe(false);
  });
});

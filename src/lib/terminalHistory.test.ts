import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_SESSION_CHARACTERS, MAX_TOTAL_CHARACTERS, TERMINAL_REPLAY_RESET, formatTerminalTranscript, trimChunkTail, trimTerminalHistory } from "./terminalHistory";

const ESC = "";

describe("trimTerminalHistory", () => {
  it("keeps the newest output for each session", () => {
    const old = "a".repeat(MAX_SESSION_CHARACTERS);
    const latest = "b".repeat(Math.floor(MAX_SESSION_CHARACTERS / 2));
    const result = trimTerminalHistory({ session: [old, latest] });

    expect(result.session.join("")).toHaveLength(MAX_SESSION_CHARACTERS);
    expect(result.session.join("").endsWith(latest)).toBe(true);
  });

  it("caps total persisted output", () => {
    const history = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [
        `session-${index}`,
        [String(index).repeat(MAX_SESSION_CHARACTERS * 2)],
      ]),
    );
    const total = Object.values(trimTerminalHistory(history)).flat().join("").length;
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_CHARACTERS);
  });
});

describe("trimChunkTail", () => {
  it("leaves a chunk that already fits alone", () => {
    expect(trimChunkTail("hello", 50)).toBe("hello");
  });

  it("never starts a chunk in the middle of an escape sequence", () => {
    // Cutting here would leave "31mred text": the "31m" printed as literal
    // characters, and the colour it was meant to set applied to nothing.
    const chunk = `plain ${ESC}[31mred text`;
    // The partial sequence is dropped rather than guessed at — resurrecting a
    // colour whose opening was cut away would be inventing state.
    expect(trimChunkTail(chunk, 10)).toBe("red text");
  });

  it("keeps plain text tails as they are", () => {
    expect(trimChunkTail("abcdefghij", 4)).toBe("ghij");
  });
});

describe("restored replay", () => {
  it("does not leave a severed escape sequence when it has to cut", () => {
    const long = `${"x".repeat(300_000)}${ESC}[41msolid`;
    const kept = trimTerminalHistory({ a: [long] }).a.join("");
    const firstEscape = kept.indexOf(ESC);
    if (firstEscape !== -1) expect(kept.slice(firstEscape, firstEscape + 2)).toBe(`${ESC}[`);
  });

  it("clears attributes so a stuck colour cannot survive a restart", () => {
    // The symptom this guards: a solid block of colour where the agent's input
    // box should be, because the escape that set the background was trimmed
    // away while the one that would have cleared it never arrived.
    expect(TERMINAL_REPLAY_RESET).toBe(`${ESC}[0m`);
  });
});

/**
 * Real bytes captured from Claude Code under a PTY — truecolor SGR, cursor
 * control, the lot. Synthetic escapes were what let this bug through: they were
 * simple enough that the naive character cut never landed anywhere harmful.
 */
const CLAUDE_TUI = readFileSync(new URL("./__fixtures__/claude-tui.txt", import.meta.url), "utf8");

describe("replaying a real agent TUI", () => {
  it("captures something worth testing against", () => {
    expect(CLAUDE_TUI.length).toBeGreaterThan(500);
    expect(CLAUDE_TUI).toContain(`${ESC}[`);
    expect(/\u001b\[38;2;/.test(CLAUDE_TUI)).toBe(true);
  });

  it("never resumes inside an escape sequence, at any cut point", () => {
    // Independent scanner, so the test does not simply agree with the code it
    // is checking. Every span the terminal would treat as one sequence.
    const spans: Array<[number, number]> = [];
    for (let i = 0; i < CLAUDE_TUI.length; i += 1) {
      if (CLAUDE_TUI[i] !== ESC) continue;
      const introducer = CLAUDE_TUI[i + 1];
      let end = i + 2;
      if (introducer === "[") {
        while (end < CLAUDE_TUI.length && !(CLAUDE_TUI[end] >= "@" && CLAUDE_TUI[end] <= "~")) end += 1;
        end += 1;
      } else if (introducer === "]") {
        const bell = CLAUDE_TUI.indexOf("\u0007", i);
        end = bell === -1 ? CLAUDE_TUI.length : bell + 1;
      }
      spans.push([i, end]);
      i = end - 1;
    }
    expect(spans.length).toBeGreaterThan(20);

    // Every truncation length, because the bug only showed when the cut
    // happened to land inside one of the many sequences a TUI emits.
    for (let limit = 1; limit < CLAUDE_TUI.length; limit += 1) {
      const trimmed = trimChunkTail(CLAUDE_TUI, limit);
      expect(CLAUDE_TUI.endsWith(trimmed)).toBe(true);
      const cut = CLAUDE_TUI.length - trimmed.length;
      const straddled = spans.find(([from, to]) => cut > from && cut < to);
      expect(straddled, `cut at ${cut} lands inside sequence ${JSON.stringify(straddled)}`).toBeUndefined();
    }
  });
});

describe("formatTerminalTranscript", () => {
  it("joins terminal chunks and removes ANSI control sequences", () => {
    expect(formatTerminalTranscript([
      "\u001b[32mUser:\u001b[0m fix the test\r\n",
      "\u001b]0;Claude\u0007Assistant: done\r\n",
    ])).toBe("User: fix the test\nAssistant: done");
  });

  it("preserves the line boundaries Pitwall adds for plain chunks", () => {
    expect(formatTerminalTranscript(["$ claude", "Session ready"])).toBe("$ claude\nSession ready");
  });
});

describe("trimChunkTail and multi-unit characters", () => {
  const hasLoneSurrogate = (text: string) =>
    [...text].some((ch) => {
      const c = ch.codePointAt(0)!;
      return c >= 0xd800 && c <= 0xdfff;
    });

  it("never cuts an astral character in half", () => {
    // String indices count UTF-16 units, so a trim boundary can land between
    // the two halves of an emoji and leave a lone surrogate in the replay.
    const chunk = "abc\u{1F643}def";
    const broken: number[] = [];
    for (let limit = 1; limit <= chunk.length; limit += 1) {
      if (hasLoneSurrogate(trimChunkTail(chunk, limit))) broken.push(limit);
    }
    expect(broken, `limits that split the emoji: ${broken.join(", ")}`).toEqual([]);
  });
});

describe("the storage budget", () => {
  it("stays a small share of what localStorage has to give", () => {
    // localStorage is one ~5MB budget shared with the projects, the tasks and
    // every setting, and it stores UTF-16 — two bytes per character. This was
    // once 2,000,000 characters, or 4MB: four fifths of everything, spent on
    // scrollback, which left no room to save a project and cost somebody their
    // project list on every launch. Scrollback is regenerable; projects are not.
    expect(MAX_TOTAL_CHARACTERS * 2).toBeLessThanOrEqual(1_000_000);
    expect(MAX_SESSION_CHARACTERS).toBeLessThanOrEqual(MAX_TOTAL_CHARACTERS);
  });
});

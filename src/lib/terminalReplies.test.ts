import { describe, expect, it } from "vitest";
import { isTerminalReply } from "./terminalReplies";

describe("terminal replies", () => {
  it("recognises what a terminal answers on its own", () => {
    for (const reply of [
      "\x1b[?62;22c",
      "\x1b[>0;276;0c",
      "\x1b[12;40R",
      "\x1b[0n",
      "\x1b[?0u",
      "\x1b[?2026;2$y",
      "\x1b[I",
      "\x1b]10;rgb:ffff/ffff/ffff\x1b\\",
      "\x1b]11;rgb:0000/0000/0000\x07",
      "\x1b]10;rgb:ffff/ffff/ffff\x1b\\\x1b]11;rgb:0000/0000/0000\x1b\\\x1b[?62c",
      "\x1bP>|xterm.js(5.5.0)\x1b\\",
    ]) expect(isTerminalReply(reply), JSON.stringify(reply)).toBe(true);
  });

  it("treats what a person types as typing", () => {
    for (const typed of ["a", "hello\r", "\r", "\x1b[A", "\x1b[B", "\x1b", "\x03", "\x1b[200~paste\x1b[201~"]) {
      expect(isTerminalReply(typed), JSON.stringify(typed)).toBe(false);
    }
  });
});

/**
 * Whether input from a terminal pane is the terminal answering its program
 * rather than a person typing.
 *
 * xterm answers a CLI's queries — what colours are you, where is the cursor,
 * which features do you have — through the same channel as keystrokes. A
 * pane hidden in the background answers too, so treating its input as a
 * person's pulled the window over to that session and marked it working.
 */
const REPLY = new RegExp(
  "^(?:" + [
    "\\x1b\\[[?>=]?[\\d;]*c",              // device attributes
    "\\x1b\\[\\d+;\\d+R",                   // cursor position
    "\\x1b\\[\\??\\d*n",                    // status report
    "\\x1b\\[\\?[\\d;]*u",                  // keyboard protocol flags
    "\\x1b\\[\\?[\\d;]*\\$y",               // mode report
    "\\x1b\\[[IO]",                         // focus in / out
    "\\x1b\\][\\d;]*(?:rgb:[0-9a-f/]+)?(?:\\x07|\\x1b\\\\)", // colour reports
    "\\x1bP[^\\x1b]*\\x1b\\\\",             // DCS replies (XTVERSION and friends)
  ].join("|") + ")+$",
  "i",
);

export function isTerminalReply(data: string): boolean {
  return data.length > 0 && REPLY.test(data);
}

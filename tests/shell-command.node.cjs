const assert = require("node:assert/strict");
const test = require("node:test");
const { runProgramCommand } = require("../electron/lib/shellCommand.cjs");

// A review body is prose: line breaks, quotes, and the characters cmd and zsh both act on.
const BODY = "Two things:\n\n1. `total` is wrong when 'items' is empty & \"count\" is 0\n2. 100% %PATH% !x! $HOME ^caret";

test("a program receives a multi-line argument exactly as written", async () => {
  const result = await runProgramCommand(process.execPath, ["-e", "process.stdout.write(process.argv[1])", BODY], { timeoutMs: 20000 });
  assert.equal(result.ok, true, result.stderr);
  assert.equal(result.stdout, BODY);
});

test("a missing program fails instead of throwing", async () => {
  const result = await runProgramCommand("pitwall-no-such-program", ["x"], { timeoutMs: 20000 });
  assert.equal(result.ok, false);
});

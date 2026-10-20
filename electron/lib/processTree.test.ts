import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { terminateProcessTree } = require("./processTree.cjs");

describe("terminateProcessTree", () => {
  it("rejects invalid process ids without signalling the caller's process group", async () => {
    for (const pid of [undefined, null, 0, -1, Number.NaN, "abc"]) {
      await expect(terminateProcessTree({ pid })).resolves.toEqual({ ok: false, error: "Process id is unavailable" });
    }
    await expect(terminateProcessTree()).resolves.toEqual({ ok: false, error: "Process id is unavailable" });
  });
});

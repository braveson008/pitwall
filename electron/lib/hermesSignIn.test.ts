import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import signIn from "./hermesSignIn.cjs";

const { readSignIn, startHermesSignIn } = signIn;

function fakeHermes() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: vi.fn(),
  });
  const spawnImpl = vi.fn(() => child);
  return { child, spawnImpl };
}

describe("reading Hermes's sign-in", () => {
  it("knows the code to approve, and when it is done", () => {
    const text = "To continue:\n  1. Open: https://portal.nousresearch.com/device?code=ABCD-1234\n  2. If prompted, enter code: ABCD-1234\n";
    expect(readSignIn(text)).toEqual({ state: "approve", code: "ABCD-1234", url: "https://portal.nousresearch.com/device?code=ABCD-1234" });
    expect(readSignIn(`${text}Saved nous OAuth device-code credentials: "me"`)).toEqual({ state: "done" });
    expect(readSignIn('Imported nous OAuth credentials: "me"')).toEqual({ state: "done" });
    expect(readSignIn("Starting Hermes login via Nous Portal...")).toEqual({ state: "starting" });
  });
});

describe("signing Hermes in", () => {
  it("runs Hermes's own login for the main home, accepts a shared login, and reports the code then done", async () => {
    const { child, spawnImpl } = fakeHermes();
    const states: unknown[] = [];
    let answered = "";
    child.stdin.on("data", (chunk: Buffer) => { answered += chunk.toString(); });
    startHermesSignIn({ env: {}, onState: (state: unknown) => states.push(state), spawnImpl });
    // On Windows a Hermes that is not a real program is started through cmd, with the same arguments on its line.
    const argv: string[] = spawnImpl.mock.calls[0][1];
    if (process.platform === "win32" && argv[0] === "/d") expect(argv[3]).toMatch(/auth\W+add\W+nous\W+--type\W+oauth\W+--timeout\W+30/);
    else expect(argv).toEqual(["auth", "add", "nous", "--type", "oauth", "--timeout", "30"]);
    expect(argv.join(" ")).not.toContain("-p");
    child.stdout.write("  2. If prompted, enter code: WXYZ-9876\n");
    await new Promise((resolve) => setImmediate(resolve));
    child.stdout.write('Saved nous OAuth device-code credentials: "me"\n');
    child.emit("exit", 0);
    expect(answered).toBe("y\n");
    expect(states).toEqual([{ state: "approve", code: "WXYZ-9876", url: "" }, { state: "done" }]);
  });

  it("says what went wrong when it fails", async () => {
    const { child, spawnImpl } = fakeHermes();
    const states: unknown[] = [];
    startHermesSignIn({ env: {}, onState: (state: unknown) => states.push(state), spawnImpl });
    child.stderr.write("Error: device code expired\n");
    await new Promise((resolve) => setImmediate(resolve));
    child.emit("exit", 1);
    expect(states).toEqual([{ state: "failed", message: "Error: device code expired" }]);
  });

  it("can be cancelled, and reports once", () => {
    const { child, spawnImpl } = fakeHermes();
    const states: unknown[] = [];
    const cancel = startHermesSignIn({ env: {}, onState: (state: unknown) => states.push(state), spawnImpl });
    cancel();
    child.emit("exit", 1);
    expect(child.kill).toHaveBeenCalled();
    expect(states).toEqual([{ state: "failed", message: "Sign-in cancelled." }]);
  });
});

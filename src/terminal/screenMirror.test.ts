import { describe, expect, it } from "vitest";
import { createScreenMirror } from "./screenMirror";
import { readTerminalMenu } from "../lib/terminalMenu";

/** The shape Claude Code uses when it will not continue without an answer. */
const RESUME_PROMPT = [
  "This session is 2d 3h old and 175.7k tokens.",
  "",
  "Resuming the full session will consume a substantial portion of your usage limit.",
  "",
  "❯ 1. Resume from summary (recommended)",
  "  2. Resume full session as-is",
  "  3. Don't ask me again",
  "",
  "Enter to confirm · Esc to cancel",
].join("\r\n");

describe("screenMirror", () => {
  it("reads back a screen for a session no pane was ever mounted for", async () => {
    const mirror = createScreenMirror();
    mirror.write("s1", [RESUME_PROMPT]);
    await mirror.flush("s1");
    const screen = mirror.read("s1");
    expect(screen).toContain("Resume from summary");
    mirror.dispose();
  });

  it("surfaces the prompt to the same reader the rail uses", async () => {
    // The point of the mirror: this is what makes a row say "Waiting on you"
    // for a session the operator has never clicked.
    const mirror = createScreenMirror();
    mirror.write("s1", [RESUME_PROMPT]);
    await mirror.flush("s1");
    expect(readTerminalMenu(mirror.read("s1") ?? "")).not.toBeNull();
    mirror.dispose();
  });

  it("returns null for a session it has never seen", async () => {
    const mirror = createScreenMirror();
    expect(mirror.read("nobody")).toBeNull();
    mirror.dispose();
  });

  it("keeps sessions apart", async () => {
    const mirror = createScreenMirror();
    mirror.write("s1", ["alpha"]);
    await mirror.flush("s1");
    mirror.write("s2", ["beta"]);
    await mirror.flush("s1");
    await mirror.flush("s2");
    expect(mirror.read("s1")).toContain("alpha");
    expect(mirror.read("s1")).not.toContain("beta");
    expect(mirror.read("s2")).toContain("beta");
    mirror.dispose();
  });

  it("applies chunks in order, so a redraw replaces what it overwrote", async () => {
    const mirror = createScreenMirror();
    // \r returns to column 0: the second write paints over the first.
    mirror.write("s1", ["waiting for you", "\rall done       "]);
    await mirror.flush("s1");
    const screen = mirror.read("s1") ?? "";
    expect(screen).toContain("all done");
    expect(screen).not.toContain("waiting for you");
    mirror.dispose();
  });

  it("frees sessions that no longer exist", async () => {
    const mirror = createScreenMirror();
    mirror.write("s1", ["a"]);
    await mirror.flush("s1");
    mirror.write("s2", ["b"]);
    await mirror.flush("s1");
    mirror.write("s3", ["c"]);
    await mirror.flush("s1");
    expect(mirror.size()).toBe(3);
    mirror.retain(["s1", "s3"]);
    expect(mirror.size()).toBe(2);
    expect(mirror.read("s2")).toBeNull();
    expect(mirror.read("s1")).toContain("a");
    mirror.dispose();
    expect(mirror.size()).toBe(0);
  });

  it("ignores an empty write rather than creating a terminal for it", async () => {
    const mirror = createScreenMirror();
    mirror.write("s1", []);
    await mirror.flush("s1");
    expect(mirror.size()).toBe(0);
    mirror.dispose();
  });
});

describe("setScope", () => {
  it("skips sessions nothing reads", async () => {
    // Every reader is scoped to the project on screen or the council being
    // watched, so a session in a background project is parsed by nobody.
    // Mirroring it anyway cost a four-second worst-case project switch.
    const mirror = createScreenMirror();
    mirror.setScope(["watched"]);
    mirror.write("watched", ["hello"]);
    mirror.write("ignored", ["hello"]);
    await mirror.flush("watched");
    expect(mirror.read("watched")).toContain("hello");
    expect(mirror.read("ignored")).toBeNull();
    expect(mirror.size()).toBe(1);
  });

  it("drops a screen when its session leaves the scope", async () => {
    // Kept, it would go stale: "waiting on you" stays true of a screen that
    // stopped updating an hour ago, which is worse than having none.
    const mirror = createScreenMirror();
    mirror.setScope(["a", "b"]);
    mirror.write("a", ["one"]);
    mirror.write("b", ["two"]);
    await mirror.flush("a");
    expect(mirror.size()).toBe(2);
    mirror.setScope(["a"]);
    expect(mirror.size()).toBe(1);
    expect(mirror.read("b")).toBeNull();
  });

  it("mirrors everything until a scope is set", () => {
    // No scope means the app has not said yet, and guessing would lose the
    // very screens the rail is about to read.
    const mirror = createScreenMirror();
    mirror.write("anything", ["x"]);
    expect(mirror.size()).toBe(1);
  });

  it("lets a session back in", async () => {
    const mirror = createScreenMirror();
    mirror.setScope(["a"]);
    mirror.write("b", ["ignored"]);
    mirror.setScope(["a", "b"]);
    mirror.write("b", ["now kept"]);
    await mirror.flush("b");
    expect(mirror.read("b")).toContain("now kept");
  });
});

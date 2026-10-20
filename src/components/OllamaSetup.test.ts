import { describe, expect, it } from "vitest";
import { cleanProgress } from "./OllamaSetup";

/**
 * `ollama pull` draws a progress bar by rewriting one line thousands of times.
 * Rendered raw, the escapes show as literal `[?25l [K` and every redraw is
 * another line, so the log grows without end and repeats itself.
 */
describe("cleanProgress", () => {
  it("strips the escape sequences a progress bar is drawn with", () => {
    const raw = "[?25lpulling manifest[K[?25h";
    expect(cleanProgress(raw)).toBe("pulling manifest");
    expect(cleanProgress(raw)).not.toMatch(/\[K|\[\?25/);
  });

  it("keeps only where a download got to, not how it got there", () => {
    // The same layer redrawn: the last state is the true one, and the
    // thousand before it say nothing.
    const raw = [
      "pulling 4824460d29f2:   2%    797 MB/ 42 GB",
      "pulling 4824460d29f2:   2%    800 MB/ 42 GB",
      "pulling 4824460d29f2:   3%    811 MB/ 42 GB",
    ].join("\r");
    expect(cleanProgress(raw)).toBe("pulling 4824460d29f2:   3%    811 MB/ 42 GB");
  });

  it("keeps separate layers apart", () => {
    const raw = [
      "pulling aaaa:  10%  1 GB",
      "pulling aaaa:  20%  2 GB",
      "pulling bbbb:   5%  1 GB",
    ].join("\n");
    expect(cleanProgress(raw).split("\n")).toEqual([
      "pulling aaaa:  20%  2 GB",
      "pulling bbbb:   5%  1 GB",
    ]);
  });

  it("drops the blank lines a redraw leaves behind", () => {
    expect(cleanProgress("a\r\n\r\n\r\nb")).toBe("a\nb");
  });

  it("keeps the log bounded, since a pull can run for an hour", () => {
    const raw = Array.from({ length: 200 }, (_, index) => `layer-${index}: done`).join("\n");
    expect(cleanProgress(raw).split("\n")).toHaveLength(40);
    // The tail, because that is where the pull currently is.
    expect(cleanProgress(raw)).toContain("layer-199: done");
  });

  it("is content with nothing", () => {
    expect(cleanProgress("")).toBe("");
  });
});

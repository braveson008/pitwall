import { describe, expect, it } from "vitest";
import { findLatestDevPreview, findLatestDevPreviewUrl } from "./devPreview";

describe("findLatestDevPreviewUrl", () => {
  it("prefers the structured preview handoff over incidental local URLs", () => {
    expect(findLatestDevPreviewUrl([
      "Tests used http://localhost:4173",
      "PITWALL_DEV_PREVIEW http://localhost:8090/task",
      "Coverage report: http://127.0.0.1:9000",
    ])).toBe("http://localhost:8090/task");
  });

  it("falls back to the latest local URL from an older agent", () => {
    expect(findLatestDevPreviewUrl([
      "Dev server",
      "Running from this worktree at http://localhost:8090.",
    ])).toBe("http://localhost:8090");
  });

  it("accepts private-network Expo previews", () => {
    expect(findLatestDevPreview([
      "PITWALL_MOBILE_PREVIEW exp://192.168.1.24:8081/--/task",
    ])).toEqual({ url: "exp://192.168.1.24:8081/--/task", target: "mobile" });
  });

  it("does not return public or unsafe URLs", () => {
    expect(findLatestDevPreviewUrl([
      "PITWALL_DEV_PREVIEW https://example.com/task",
      "file:///tmp/project",
      "javascript:alert(1)",
    ])).toBe("");
  });
});

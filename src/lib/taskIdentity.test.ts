import { describe, expect, it } from "vitest";
import { normalizeTaskIdentifier, taskBranchName, validateTaskIdentifier } from "./taskIdentity";

describe("task identity", () => {
  it("normalizes an entered task ID into its branch name", () => {
    expect(normalizeTaskIdentifier(" WEB-427 ")).toBe("web-427");
    expect(taskBranchName({ identifier: "WEB-427", worktree: "legacy/task" })).toBe("web-427");
  });

  it("requires a Git-safe task ID", () => {
    expect(validateTaskIdentifier("")).toBe("Task ID is required.");
    expect(validateTaskIdentifier("trt/427")).toMatch(/letters/);
    expect(validateTaskIdentifier("web-427")).toBeNull();
  });

  it("preserves the existing branch for legacy tasks", () => {
    expect(taskBranchName({ worktree: "codex/task-existing" })).toBe("codex/task-existing");
  });
});

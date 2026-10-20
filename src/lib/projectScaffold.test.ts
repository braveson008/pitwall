import { describe, expect, it } from "vitest";
import {
  IMPLEMENTER_ROLE,
  SCOPING_ROLE,
  buildProjectBrief,
  buildProjectTaskDraft,
  buildScopingPipeline,
  slugifyProjectName,
  validateProjectDescription,
  validateProjectName,
} from "./projectScaffold";

describe("slugifyProjectName", () => {
  it("collapses display names to a single safe folder segment", () => {
    expect(slugifyProjectName("My Todo App")).toBe("my-todo-app");
    expect(slugifyProjectName("  Spaced  Out  ")).toBe("spaced-out");
    expect(slugifyProjectName("Pitwall 2.0")).toBe("pitwall-2-0");
  });

  it("never emits path traversal or separators", () => {
    expect(slugifyProjectName("../../etc/passwd")).toBe("etc-passwd");
    expect(slugifyProjectName("..")).toBe("");
    expect(slugifyProjectName("/absolute/path")).toBe("absolute-path");
    expect(slugifyProjectName(".hidden")).toBe("hidden");
  });

  it("trims to 64 characters without leaving a trailing hyphen", () => {
    const slug = slugifyProjectName("a".repeat(60) + " " + "b".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("returns empty for input with nothing usable", () => {
    expect(slugifyProjectName("!!!")).toBe("");
    expect(slugifyProjectName("")).toBe("");
  });
});

describe("validateProjectName", () => {
  it("accepts ordinary names", () => {
    expect(validateProjectName("My Todo App")).toBeNull();
  });

  it("rejects empty and unusable names", () => {
    expect(validateProjectName("")).toBe("Project name is required.");
    expect(validateProjectName("   ")).toBe("Project name is required.");
    expect(validateProjectName("!!!")).toBe("Use at least one letter or number.");
    expect(validateProjectName("..")).toBe("Use at least one letter or number.");
  });
});

describe("validateProjectDescription", () => {
  it("requires a description", () => {
    expect(validateProjectDescription("")).toBe("Describe what you want to build.");
    expect(validateProjectDescription("  ")).toBe("Describe what you want to build.");
    expect(validateProjectDescription("A todo app")).toBeNull();
  });
});

describe("buildProjectBrief", () => {
  it("writes the description under a titled brief heading", () => {
    expect(buildProjectBrief({ name: "Todo", description: "Track tasks offline." })).toBe(
      "# Todo\n\n## Brief\n\nTrack tasks offline.\n",
    );
  });

  it("falls back when fields are blank", () => {
    expect(buildProjectBrief({ name: "", description: "" })).toBe(
      "# New project\n\n## Brief\n\nNo description provided.\n",
    );
  });
});

describe("buildProjectTaskDraft", () => {
  it("derives a branch-safe identifier from the name", () => {
    const draft = buildProjectTaskDraft({ name: "My Todo App", description: "Track tasks." });
    expect(draft.identifier).toBe("my-todo-app");
    expect(draft.title).toBe("Scope and build: My Todo App");
    expect(draft.description).toContain("Track tasks.");
    expect(draft.description).toContain("BRIEF.md");
  });

  it("falls back to a usable identifier when the name has no slug", () => {
    expect(buildProjectTaskDraft({ name: "!!!", description: "x" }).identifier).toBe("scope");
  });
});

describe("buildScopingPipeline", () => {
  it("orders the relay as scope then implement", () => {
    expect(buildScopingPipeline({ scopingProviderId: "claude", implementerProviderId: "codex" })).toEqual([
      { providerId: "claude", role: SCOPING_ROLE },
      { providerId: "codex", role: IMPLEMENTER_ROLE },
    ]);
  });

  it("allows the same agent to scope and implement", () => {
    const pipeline = buildScopingPipeline({ scopingProviderId: "claude", implementerProviderId: "claude" });
    expect(pipeline).toHaveLength(2);
    expect(pipeline[0].providerId).toBe("claude");
    expect(pipeline[1].providerId).toBe("claude");
  });
});

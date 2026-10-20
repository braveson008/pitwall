import { describe, expect, it } from "vitest";
import { roleLabel, roleStateLabel, rolesOnTask, type RoleRun } from "./taskRoles";

const run = (over: Partial<RoleRun>): RoleRun => ({
  role: "implementation", status: "running", progress: 0, sessionId: "s1", ...over,
});

describe("rolesOnTask", () => {
  // A council puts several roles on one task and there was nowhere that said
  // so — you had to open Work and read the grid.
  it("lists the roles in pipeline order, not the order the runs started", () => {
    const listed = rolesOnTask([
      run({ role: "review", sessionId: "s3" }),
      run({ role: "architecture", sessionId: "s1" }),
      run({ role: "implementation", sessionId: "s2" }),
    ]);
    expect(listed.map((entry) => entry.role)).toEqual(["architecture", "implementation", "review"]);
  });

  // Five greyed rows on a single-agent task is noise, not information.
  it("leaves out roles nobody has been given", () => {
    const listed = rolesOnTask([run({ role: "implementation" })]);
    expect(listed).toHaveLength(1);
    expect(listed[0].role).toBe("implementation");
  });

  it("shows the latest run for a role that has been attempted twice", () => {
    const listed = rolesOnTask([
      run({ role: "implementation", status: "failed", sessionId: "first" }),
      run({ role: "implementation", status: "running", sessionId: "second" }),
    ]);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ sessionId: "second", status: "running" });
  });

  it("ignores a run whose role is not one Pitwall knows", () => {
    // Stored sessions predate roles being fixed, and a bad one should drop out
    // rather than crash the inspector.
    expect(rolesOnTask([run({ role: "nonsense" as never })])).toEqual([]);
    expect(rolesOnTask([])).toEqual([]);
  });
});

describe("roleStateLabel", () => {
  it("says what a running role is doing, with progress once there is some", () => {
    expect(roleStateLabel(run({ status: "running", progress: 72 }))).toBe("working · 72%");
  });

  // A percentage nobody is producing reads as precision. Better to say nothing.
  it("omits a progress figure of zero rather than claiming 0%", () => {
    expect(roleStateLabel(run({ status: "running", progress: 0 }))).toBe("working");
  });

  it("names every other run state in words", () => {
    expect(roleStateLabel(run({ status: "completed" }))).toBe("complete");
    expect(roleStateLabel(run({ status: "failed" }))).toBe("failed");
    expect(roleStateLabel(run({ status: "waiting" }))).toBe("needs input");
    expect(roleStateLabel(run({ status: "starting" }))).toBe("starting");
  });

  it("calls a role with no run at all waiting", () => {
    expect(roleStateLabel(undefined)).toBe("waiting");
  });
});

describe("roleLabel", () => {
  it("uses the role's own name", () => {
    expect(roleLabel("architecture")).toBe("Architect");
    expect(roleLabel("implementation")).toBe("Implementer");
  });

  it("falls back to the key rather than rendering nothing", () => {
    expect(roleLabel("nonsense" as never)).toBe("nonsense");
  });
});

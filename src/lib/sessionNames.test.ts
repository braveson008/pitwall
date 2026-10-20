import { describe, expect, it } from "vitest";
import {
  councilMemberLabel,
  formatCouncilMemberName,
  formatCouncilRunName,
  formatInstructionSessionName,
  expandSessionName,
  formatTaskSessionName,
  formatUntaskedSessionName, uniqueSessionName } from "./sessionNames";

describe("task-derived session names", () => {
  it("names a session from its task and role", () => {
    expect(formatTaskSessionName("Checkout redesign", "Implementer")).toBe(
      "Checkout redesign · Implementer",
    );
  });

  it("can distinguish Council agents", () => {
    expect(formatTaskSessionName("Checkout redesign", "Architect", "Claude 2")).toBe(
      "Checkout redesign · Architect · Claude 2",
    );
  });

  it("names Council and Compare runs", () => {
    expect(formatCouncilRunName("Checkout redesign", "council")).toBe("Checkout redesign · Council");
    expect(formatCouncilRunName("Checkout redesign", "compare")).toBe("Checkout redesign · Compare");
  });

  it("names a session started without a task", () => {
    expect(formatUntaskedSessionName("Claude")).toBe("New session · Claude");
  });

  // The picker can hold a custom agent with a blank label; the chip still needs
  // to say something rather than trailing off after the separator.
  it("still produces a name when the agent label is missing", () => {
    expect(formatUntaskedSessionName("  ")).toBe("New session · agent");
  });

  it("keeps a long task name whole; the sidebar truncates it, the hover shows it", () => {
    const name = formatTaskSessionName("A very long task title that would otherwise overwhelm the session tab", "QA");
    expect(name).toBe("A very long task title that would otherwise overwhelm the session tab · QA");
  });
});
describe("formatCouncilMemberName", () => {
  it("names a member by role and agent, not by the shared task", () => {
    expect(formatCouncilMemberName("Architect", "Claude 1")).toBe("Architect · Claude 1");
  });

  it("copes with a missing agent label", () => {
    expect(formatCouncilMemberName("Reviewer / QA")).toBe("Reviewer / QA");
  });
});

describe("councilMemberLabel", () => {
  const task = "Only show one HCT value in the app results";

  it("drops the task prefix from a member named before the change", () => {
    const old = formatTaskSessionName(task, "Architect", "Claude 1");
    expect(councilMemberLabel(old, task)).toBe("Architect · Claude 1");
  });

  it("leaves an already-role-named member alone", () => {
    expect(councilMemberLabel("Implementer · Codex 1", task)).toBe("Implementer · Codex 1");
  });

  it("handles a task title long enough to have been truncated", () => {
    const long = "A task title that is comfortably longer than the forty-four character limit";
    const old = "A task title that is comfortably longer tha… · Reviewer / QA · Claude 2";
    expect(councilMemberLabel(old, long)).toBe("Reviewer / QA · Claude 2");
  });

  it("never returns an empty label", () => {
    const bare = formatTaskSessionName(task, "", undefined);
    expect(councilMemberLabel(bare, task)).toBe(bare);
  });

  it("leaves a name that does not carry this task's prefix alone", () => {
    expect(councilMemberLabel("Something else entirely", task)).toBe("Something else entirely");
  });
});

describe("uniqueSessionName", () => {
  it("leaves a name that nothing else has", () => {
    expect(uniqueSessionName("acme-2432 · Implementer", ["other"])).toBe("acme-2432 · Implementer");
  });

  it("numbers a name already in use", () => {
    // The reported bug: a session created with no name took the same derived
    // name as an existing one, and the rail showed "acme-2432" twice.
    expect(uniqueSessionName("acme-2432", ["acme-2432"])).toBe("acme-2432 2");
    expect(uniqueSessionName("acme-2432", ["acme-2432", "acme-2432 2"])).toBe("acme-2432 3");
  });

  it("does not care about case or stray spacing", () => {
    // The name is compared the way a person reads it, not byte for byte.
    expect(uniqueSessionName("Acme-2432", ["  acme-2432 "])).toBe("Acme-2432 2");
  });

  it("falls back to something rather than an empty name", () => {
    expect(uniqueSessionName("   ", [])).toBe("New session");
    expect(uniqueSessionName("", ["New session"])).toBe("New session 2");
  });

  it("ignores blanks in the taken list", () => {
    expect(uniqueSessionName("a", ["", "   "])).toBe("a");
  });
});

describe("formatInstructionSessionName", () => {
  it("names a session by the first line of what was typed, cut at a word", () => {
    expect(formatInstructionSessionName("  fix the login\nthen run tests")).toBe("fix the login");
    expect(formatInstructionSessionName("make the checkout total match the sum of its lines when there are more than ten"))
      .toBe("make the checkout total match the sum of its lines when there are more than ten");
    const long = `${"word ".repeat(30)}end`;
    expect(formatInstructionSessionName(long)).toBe(`${"word ".repeat(23).trimEnd()}…`);
    expect(formatInstructionSessionName("x".repeat(130))).toBe(`${"x".repeat(119)}…`);
  });
});

describe("expandSessionName", () => {
  const title = "JSON List picker saves wrong value when display and value fields differ";

  it("puts back a task title that was cut when the session was named", () => {
    expect(expandSessionName("JSON List picker saves wrong value when dis… · Implementer", title)).toBe(
      `${title} · Implementer`,
    );
  });

  it("leaves whole names, renamed sessions and other tasks' names alone", () => {
    expect(expandSessionName(`${title} · Implementer`, title)).toBe(`${title} · Implementer`);
    expect(expandSessionName("My own name…", title)).toBe("My own name…");
    expect(expandSessionName("Something else entir… · QA", title)).toBe("Something else entir… · QA");
    expect(expandSessionName("JSON List picker saves wrong value when dis… · QA", undefined)).toBe("JSON List picker saves wrong value when dis… · QA");
  });
});

import { describe, expect, it } from "vitest";
import { getRole, roleKeys, roleOrder, roleWritesCode, roles } from "./roles";

describe("roles", () => {
  it("defines every role with a real system prompt and default context", () => {
    expect(roleOrder.length).toBeGreaterThanOrEqual(6);
    for (const type of roleOrder) {
      expect(roles[type].label).toBeTruthy();
      expect(roles[type].systemPrompt.length).toBeGreaterThan(20);
      expect(roles[type].contextCategories.length).toBeGreaterThan(0);
    }
  });

  it("lists every defined role, so a new one reaches the pickers", () => {
    // The pickers are built from roleOrder, not from `roles`. A role added to
    // one and not the other exists and can never be chosen.
    expect([...roleOrder].sort()).toEqual(Object.keys(roles).sort());
  });

  it("gives every role a handle, and no two the same", () => {
    // Members are addressed by handle in a handoff. Two roles sharing one
    // would make "TO: reviewer" ambiguous and route the work to the wrong seat.
    const keys = roleOrder.map((type) => roleKeys[type]);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps session types to the right role", () => {
    expect(getRole("architecture").label).toBe("Architect");
    expect(getRole("implementation").label).toBe("Implementer");
    expect(getRole("review").label).toContain("Reviewer");
    expect(getRole("code-review").label).toBe("Code Reviewer");
  });

  it("orders a delivery relay from design through implementation and both reviews", () => {
    expect(roleOrder.slice(0, 4)).toEqual([
      "architecture",
      "implementation",
      "review",
      "code-review",
    ]);
  });

  it("keeps the two reviewing roles distinct in what they look for", () => {
    // QA asks whether it works; the code reviewer asks whether it belongs in
    // this repository. Collapsing them into one prompt was the point of adding
    // the second role, so the prompts must not converge.
    const qa = getRole("review").systemPrompt.toLowerCase();
    const reviewer = getRole("code-review").systemPrompt.toLowerCase();
    expect(qa).toContain("bugs");
    expect(reviewer).toContain("conventions");
    expect(reviewer).toMatch(/collision|duplicat/);
    expect(reviewer).not.toBe(qa);
    expect(roleKeys["review"]).not.toBe(roleKeys["code-review"]);
  });

  it("does not expect a reviewer to produce a diff", () => {
    // A council routes on self-reported handoffs and uses this to tell "I
    // reviewed it" from "I implemented it", so a reviewer that showed up as
    // code-writing would be chased for an empty diff it was never going to have.
    expect(roleWritesCode["code-review"]).toBe(false);
    expect(roleWritesCode["review"]).toBe(false);
    expect(roleWritesCode["implementation"]).toBe(true);
  });
});

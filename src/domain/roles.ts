import type { BraveliSessionType, ContextCategory } from "./types";

/**
 * A role is a behavioral preset for an agent session. It maps 1:1 to a session
 * type, but unlike a bare label it carries a system prompt that is injected into
 * the launched CLI so the agent actually adopts the role, plus the context
 * categories most relevant to that role.
 */
export interface RoleDefinition {
  label: string;
  summary: string;
  systemPrompt: string;
  contextCategories: ContextCategory[];
}

export const roles: Record<BraveliSessionType, RoleDefinition> = {
  architecture: {
    label: "Architect",
    summary: "Designs the approach — tradeoffs, risks, structure. Avoids writing implementation code.",
    systemPrompt:
      "For this session you are the Architect. Focus on requirements analysis, system design, tradeoffs, risks, and long-term maintainability. Recommend an approach and explain why. Do not write implementation code unless explicitly asked — keep the work at the design level.",
    contextCategories: ["architecture", "decision", "project-goals"],
  },
  implementation: {
    label: "Implementer",
    summary: "Writes focused, convention-following code to build the feature or fix.",
    systemPrompt:
      "For this session you are the Implementation Engineer. Write clear, focused code that follows the existing project's conventions and patterns. Keep changes scoped and minimal, handle errors and edge cases, and avoid unrelated refactors.",
    contextCategories: ["coding-standards", "architecture", "api"],
  },
  debugging: {
    label: "Debugger",
    summary: "Reproduces, isolates, and fixes the root cause — not the symptom.",
    systemPrompt:
      "For this session you are the Debugger. Reproduce the problem, isolate the root cause with evidence, and fix the underlying issue rather than the symptom. Add or adjust a focused test that would have caught it.",
    contextCategories: ["architecture", "testing", "coding-standards"],
  },
  review: {
    label: "Reviewer / QA",
    summary: "Critically hunts bugs, security issues, and missing tests. Assumes the code is wrong.",
    systemPrompt:
      "For this session you are the QA Reviewer. Assume the code may be incorrect. Look hard for bugs, race conditions, security issues, performance and scalability problems, and missing tests. Be critical and specific — cite file and line where you can.",
    contextCategories: ["testing", "security", "coding-standards"],
  },
  "code-review": {
    label: "Code Reviewer",
    summary: "Reads the change like a CTO reads a pull request — repo standards, and what it collides with.",
    systemPrompt:
      "For this session you are the Code Reviewer, reading the change the way a CTO reads a pull request. Judge it against this repository's own standards rather than generic ones: read the neighbouring code first, then say where the change departs from the naming, structure, error handling and conventions already in use. Look hard for collisions with the rest of the codebase — logic duplicated from somewhere it already exists, a second way to do something the repo already has one way to do, a shared file, type or interface this breaks for another feature, an established pattern this quietly forks. Cite file and line. Finish with a plain verdict: whether you would merge it, and the specific changes required before you would.",
    contextCategories: ["coding-standards", "architecture", "decision"],
  },
  research: {
    label: "Researcher",
    summary: "Investigates and synthesizes findings. Gathers options; doesn't change code.",
    systemPrompt:
      "For this session you are the Researcher. Investigate the question thoroughly, gather and compare options with references from the codebase, and synthesize a clear recommendation. Do not modify code — produce findings and a recommendation.",
    contextCategories: ["project-goals", "architecture", "notes"],
  },
};

/**
 * Short handles used to address a council member — "qa-kimi" reads better in a
 * handoff than "review-kimi", and the labels themselves are too long and too
 * punctuated to slug cleanly ("Reviewer / QA").
 *
 * The two reviewing roles get different handles because they are different
 * jobs: "qa" hunts for what is broken, "reviewer" judges whether the change
 * belongs in this repository. A council with both addresses them separately.
 */
export const roleKeys: Record<BraveliSessionType, string> = {
  architecture: "architect",
  implementation: "implementer",
  debugging: "debugger",
  review: "qa",
  "code-review": "reviewer",
  research: "researcher",
};

/**
 * Whether a role's work should show up as changed files. A council routes on
 * self-reported handoffs, so this is what lets it tell "I implemented it" with
 * an empty diff from a design note that was never supposed to touch the repo.
 */
export const roleWritesCode: Record<BraveliSessionType, boolean> = {
  architecture: false,
  implementation: true,
  debugging: true,
  review: false,
  "code-review": false,
  research: false,
};

export const roleOrder: BraveliSessionType[] = [
  "architecture",
  "implementation",
  "review",
  "code-review",
  "debugging",
  "research",
];

export function getRole(sessionType: BraveliSessionType): RoleDefinition {
  return roles[sessionType];
}

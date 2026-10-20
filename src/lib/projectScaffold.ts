import type { PitwallProviderId, PitwallSessionType } from "../domain/types";

/**
 * Greenfield project scaffolding. Turns a free-text name + description into a
 * safe folder segment, a starter brief, and the two-stage pipeline the council
 * relay runs: one agent scopes the idea, the next implements from its handoff.
 *
 * Pure on purpose — the folder is created in the main process, and the relay is
 * driven by App.tsx, but every decision they make is derived here so it can be
 * tested without Electron or a DOM.
 */

/** Same shape as `CouncilMember`, declared structurally to avoid a lib -> component cycle. */
export interface ScopingPipelineMember {
  providerId: PitwallProviderId;
  role: PitwallSessionType;
}

/** Stage 1 designs and scopes; stage 2 builds from the handoff file it writes. */
export const SCOPING_ROLE: PitwallSessionType = "architecture";
export const IMPLEMENTER_ROLE: PitwallSessionType = "implementation";

const FOLDER_SEGMENT = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Collapses a display name to a lowercase folder segment. Everything outside
 * [a-z0-9] becomes a hyphen, so `..`, path separators, and leading dots can
 * never survive — the result is always a single safe segment or empty.
 */
export function slugifyProjectName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 64)
    .replace(/^-+|-+$/g, "");
}

export function validateProjectName(name: string): string | null {
  if (!name.trim()) return "Project name is required.";
  const slug = slugifyProjectName(name);
  if (!slug) return "Use at least one letter or number.";
  if (!FOLDER_SEGMENT.test(slug)) return "Use 1–64 letters, numbers, or hyphens.";
  return null;
}

export function validateProjectDescription(description: string): string | null {
  if (!description.trim()) return "Describe what you want to build.";
  return null;
}

/**
 * The brief is committed into the new repo so the scoping agent can read the
 * intent from disk rather than only from the prompt it was typed.
 */
export function buildProjectBrief({ name, description }: { name: string; description: string }) {
  const title = name.trim() || "New project";
  const body = description.trim() || "No description provided.";
  return `# ${title}\n\n## Brief\n\n${body}\n`;
}

/**
 * Seeds the first task from the description. The identifier doubles as the
 * task's git branch, so it reuses the same slug as the project folder.
 */
export function buildProjectTaskDraft({ name, description }: { name: string; description: string }) {
  const title = name.trim() || "New project";
  const body = description.trim();
  return {
    identifier: slugifyProjectName(name) || "scope",
    title: `Scope and build: ${title}`,
    description: body
      ? `${body}\n\nThis is a new, empty project. Start from the brief in BRIEF.md.`
      : "No description provided.",
  };
}

export function buildScopingPipeline({
  scopingProviderId,
  implementerProviderId,
}: {
  scopingProviderId: PitwallProviderId;
  implementerProviderId: PitwallProviderId;
}): ScopingPipelineMember[] {
  return [
    { providerId: scopingProviderId, role: SCOPING_ROLE },
    { providerId: implementerProviderId, role: IMPLEMENTER_ROLE },
  ];
}

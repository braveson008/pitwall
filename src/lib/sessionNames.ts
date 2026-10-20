/** A first line of an instruction is a name, not the instruction. */
const MAX_INSTRUCTION_NAME_LENGTH = 120;

/**
 * The whole title. Names were cut at 44 characters when sessions sat in a tab
 * strip; the sidebar truncates with CSS now, and a name cut at birth can never
 * be shown whole again — not even where there is room for it.
 */
function taskNameSegment(taskTitle: string) {
  return taskTitle.trim().replace(/\s+/g, " ") || "Untitled task";
}

/**
 * A name saved shortened, with its task's title put back.
 *
 * Sessions named before names were kept whole carry "Title that was cu… · Role",
 * persisted. When the cut part is the start of the task's title, the title is
 * restored; any other name is returned as it is.
 */
export function expandSessionName(name: string, taskTitle: string | undefined) {
  const title = String(taskTitle || "").trim().replace(/\s+/g, " ");
  if (!title || !name.includes("…")) return name;
  const [first, ...rest] = name.split(" · ");
  if (!first.endsWith("…")) return name;
  const kept = first.slice(0, -1).trimEnd();
  return kept && title.startsWith(kept) && title.length > kept.length ? [title, ...rest].join(" · ") : name;
}

export function formatTaskSessionName(taskTitle: string, roleLabel: string, agentLabel?: string) {
  return [taskNameSegment(taskTitle), roleLabel.trim(), agentLabel?.trim()].filter(Boolean).join(" · ");
}

/**
 * Name for a session started without a task. The task is optional now, so the
 * fallback has to say something true rather than borrow a task the user never
 * picked — and it stays editable, both here and by double-clicking the chip.
 */
export function formatUntaskedSessionName(agentLabel: string) {
  return `New session · ${agentLabel.trim() || "agent"}`;
}

/** Name for a session started from a typed instruction: its first line, cut at a word. */
export function formatInstructionSessionName(instruction: string) {
  const line = instruction.trim().split("\n")[0].replace(/\s+/g, " ");
  if (line.length <= MAX_INSTRUCTION_NAME_LENGTH) return line;
  const cut = line.slice(0, MAX_INSTRUCTION_NAME_LENGTH - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > MAX_INSTRUCTION_NAME_LENGTH / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

/**
 * Name for one member of a Council or Compare run.
 *
 * Members share a task and the run's own row already carries it, so repeating
 * the title on each member spends the width on the one thing that cannot tell
 * them apart — in a rail every member truncates to the same string. The role
 * is what the reader is actually choosing between.
 */
export function formatCouncilMemberName(roleLabel: string, agentLabel?: string) {
  return [roleLabel.trim() || "Member", agentLabel?.trim()].filter(Boolean).join(" · ");
}

/**
 * What to show for a Council member in the rail.
 *
 * Members created before members were named by role carry the task title as a
 * prefix, and their names are already persisted, so the rail cannot rely on
 * having been given a good one. Dropping the prefix the run's own row already
 * displays turns an old name into the same thing a new one would be, and is a
 * no-op for names that never had it.
 */
export function councilMemberLabel(sessionName: string, taskTitle: string) {
  // Older members carry the title cut short; read it whole before matching.
  const name = expandSessionName(sessionName, taskTitle);
  const prefix = `${taskNameSegment(taskTitle)} · `;
  if (!name.startsWith(prefix)) return sessionName;
  const rest = name.slice(prefix.length).trim();
  return rest || sessionName;
}

/**
 * Just the role from a member's name.
 *
 * A member is named "Role · Agent N". The grid shows the agent separately, so
 * repeating it in the same line spends the space on the half that is already
 * on screen rather than the half that identifies the member.
 */
export function councilMemberRole(memberName: string) {
  const [role] = memberName.split(" · ");
  return role?.trim() || memberName;
}

export function formatCouncilRunName(taskTitle: string, mode: "council" | "compare") {
  return `${taskNameSegment(taskTitle)} · ${mode === "compare" ? "Compare" : "Council"}`;
}

/**
 * A name no other session in this project already has.
 *
 * Session names are derived rather than typed — leave the field blank and the
 * name comes from the task and the role — so two sessions on one task, in one
 * role, were given the same string. The rail then showed the same name twice
 * with nothing to tell them apart, and picking the right one meant opening
 * both.
 *
 * The suffix is a plain counter rather than an id: the point is to be able to
 * tell two rows apart at a glance, and `acme-2432 2` does that where
 * `acme-2432 (a3f9c1)` only adds width.
 */
export function uniqueSessionName(base: string, taken: Iterable<string>): string {
  const name = base.trim() || "New session";
  const used = new Set<string>();
  for (const item of taken) {
    const trimmed = String(item ?? "").trim();
    if (trimmed) used.add(trimmed.toLowerCase());
  }
  if (!used.has(name.toLowerCase())) return name;
  for (let suffix = 2; suffix < 500; suffix += 1) {
    const candidate = `${name} ${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return name;
}

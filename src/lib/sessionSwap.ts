/**
 * Handing a solo session to another agent: same session, same worktree, a new
 * CLI driving it. A Council seat has its own swap (councilSwap.ts), because a
 * seat has a handle the thread addresses and a turn to carry.
 */

/** Why this swap cannot happen, or null when it can. */
export function swapRefusal({
  fromAgent,
  fromModel,
  toAgent,
  toModel,
  inCouncil,
}: {
  fromAgent: string;
  fromModel: string;
  toAgent: string;
  toModel: string;
  inCouncil: boolean;
}): string | null {
  if (inCouncil) return "This session sits in a Council. Swap its seat from the Council view.";
  if (!toAgent) return "Pick an agent to hand the session to.";
  if (toAgent === fromAgent && (toModel || "") === (fromModel || "")) return `${fromAgent} is already on this session.`;
  return null;
}

/** The session's name with the agent in it changed, where the name carries one. */
export function swappedSessionName(name: string, fromAgent: string, toAgent: string): string {
  const parts = name.split(" · ");
  const index = parts.lastIndexOf(fromAgent);
  if (index < 0) return name;
  parts[index] = toAgent;
  return parts.join(" · ");
}

/** The first thing the incoming agent is told. */
export function handoffPrompt(fromAgent: string, file: string | null): string {
  return file
    ? `You are taking over this session from ${fromAgent}. Read ${file} for the task, the conversation so far and the state of the worktree, then wait for my next instruction.`
    : `You are taking over this session from ${fromAgent}. Its conversation could not be handed over; check the worktree with git status and git diff, then wait for my next instruction.`;
}

/** The line the terminal shows where one agent's scrollback ends and the next begins. */
export function handoffDivider(fromAgent: string, toAgent: string): string {
  return `── Handed from ${fromAgent} to ${toAgent} ──`;
}

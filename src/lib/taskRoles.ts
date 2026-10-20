import { roleOrder, roles } from "../domain/roles";
import type { PitwallSessionType } from "../domain/types";
import type { AgentSession } from "../data";

/** One role working a task, and how its run is going. */
export interface RoleRun {
  role: PitwallSessionType;
  status: AgentSession["status"];
  progress: number;
  /** The run this role is doing, so the inspector can select it. */
  sessionId: string;
}

/**
 * Which roles are working a task, in pipeline order.
 *
 * A council puts an Architect, an Implementer and a Reviewer on the same task,
 * and Pitwall had nowhere that said so — you had to open Work and read the
 * grid to find out who was doing what.
 *
 * Roles nobody has been given are left out rather than listed as empty. Five
 * greyed rows on a single-agent task is noise; the two that are actually
 * running is information.
 */
export function rolesOnTask(runs: RoleRun[]): RoleRun[] {
  const latest = new Map<PitwallSessionType, RoleRun>();
  for (const run of runs) {
    if (!run || !(run.role in roles)) continue;
    // Later runs win: the most recent attempt at a role is the one that
    // describes where that role has got to.
    latest.set(run.role, run);
  }
  return roleOrder.filter((role) => latest.has(role)).map((role) => latest.get(role)!);
}

/** What a role is doing, in one lowercase phrase. */
export function roleStateLabel(run?: RoleRun): string {
  if (!run) return "waiting";
  switch (run.status) {
    case "running":
      // A percentage nobody is producing is worse than no percentage: it reads
      // as precision. Only shown once there is something behind it.
      return run.progress > 0 ? `working · ${Math.round(run.progress)}%` : "working";
    case "completed":
      return "complete";
    case "failed":
      return "failed";
    case "waiting":
      return "needs input";
    case "starting":
      return "starting";
    default:
      return "idle";
  }
}

/** The human name of a role. */
export function roleLabel(role: PitwallSessionType): string {
  return roles[role]?.label ?? role;
}

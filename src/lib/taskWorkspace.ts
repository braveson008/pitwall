import type { AgentSession } from "../data";
import type { BraveliSession, BraveliTask } from "../domain/types";

type Worktree = { path: string; branch: string };

export function selectTaskWorkspace({
  task,
  sessions,
  runs,
  worktrees,
  projectPath,
}: {
  task: BraveliTask;
  sessions: AgentSession[];
  runs: BraveliSession[];
  worktrees: Worktree[];
  projectPath: string;
}) {
  const runIds = new Set(runs.filter((run) => run.taskId === task.id).map((run) => run.id));
  const sessionCheckout = sessions.find((session) => runIds.has(session.id) && session.worktreePath)?.worktreePath;
  if (sessionCheckout && worktrees.some((worktree) => worktree.path === sessionCheckout)) {
    return { path: sessionCheckout, fallback: false };
  }

  const expectedBranches = new Set([task.worktree, task.identifier].filter(Boolean));
  const worktree = worktrees.find((item) => expectedBranches.has(item.branch));
  return worktree?.path ? { path: worktree.path, fallback: false } : { path: projectPath, fallback: true };
}

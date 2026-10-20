import type { BraveliSessionStatus, BraveliTaskStatus } from "../domain/types";

/**
 * When a finished agent means the task is finished.
 *
 * An agent stopping used to change nothing about the task it was working on:
 * the completion path wrote a summary, opened the preview, and left the task in
 * Running. The only thing that ever moved work to Review was a person pressing
 * the button, so a task whose agent had been done for an hour looked identical
 * to one still being worked on.
 *
 * The catch is that "an agent finished" and "the work finished" are not the same
 * event. A Council puts three agents on one task and its architect finishes long
 * before its reviewer starts; moving the task the moment any one of them stops
 * would march it to Review in the middle of the debate.
 */

/** Statuses where a session may still do more work on its task. */
const STILL_WORKING = new Set<BraveliSessionStatus>(["starting", "running", "waiting"]);

export function shouldMoveToReview(
  task: { id: string; status: BraveliTaskStatus },
  sessions: readonly { id: string; taskId: string; status: BraveliSessionStatus }[],
  finishedSessionId: string,
): boolean {
  // Only work that was actually underway. A task already in Review, completed,
  // or never started is not somewhere a stopping session should drag it.
  if (task.status !== "running") return false;
  return !sessions.some(
    (session) =>
      session.taskId === task.id &&
      session.id !== finishedSessionId &&
      STILL_WORKING.has(session.status),
  );
}

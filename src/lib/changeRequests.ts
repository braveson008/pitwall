import type { BraveliTask } from "../domain/types";

/**
 * Sending work back, with a reason.
 *
 * Review had two outcomes: accept, or go and deal with it yourself. The missing
 * one is the ordinary one — the work is nearly right and needs a specific
 * change — and without it the reviewer's judgement never reaches the agent that
 * could act on it.
 *
 * A request is kept on the task rather than fired at a terminal and forgotten.
 * The session that did the work may have exited, and a request that only exists
 * as text typed into a dead pane is a request that was never made. Holding it
 * means it can be delivered now if something is listening, and included in the
 * prompt if a session has to be started for it.
 */
export type ChangeRequest = {
  id: string;
  body: string;
  createdAt: string;
  /** When an agent was actually given this. Null while it is still waiting. */
  deliveredAt: string | null;
  /**
   * The file the request is about, when it was made against one.
   *
   * Most review comments are about a specific file, and saying which removes
   * the agent's first job — working out where. A request made about the change
   * as a whole has none, which is also a real case and not a missing value.
   */
  filePath?: string;
  /** Written by the pair's reviewer rather than by a person. */
  from?: "reviewer";
};

export type TaskWithRequests = BraveliTask & { changeRequests?: ChangeRequest[] };

/** Empty or whitespace is not a request; it is an accidental button press. */
export function isUsableRequest(body: string): boolean {
  return body.trim().length > 0;
}

export function makeChangeRequest(
  body: string,
  now: string,
  id: string,
  filePath?: string,
): ChangeRequest {
  const request: ChangeRequest = { id, body: body.trim(), createdAt: now, deliveredAt: null };
  if (filePath) request.filePath = filePath;
  return request;
}

/** Requests an agent has not been shown yet, oldest first. */
export function pendingRequests(task: TaskWithRequests): ChangeRequest[] {
  return (task.changeRequests ?? []).filter((request) => !request.deliveredAt);
}

export function markDelivered(task: TaskWithRequests, ids: string[], now: string): ChangeRequest[] {
  const delivering = new Set(ids);
  return (task.changeRequests ?? []).map((request) =>
    delivering.has(request.id) && !request.deliveredAt ? { ...request, deliveredAt: now } : request,
  );
}

/**
 * What the agent is told.
 *
 * Written as an instruction rather than a quotation, because an agent handed
 * "the reviewer said X" tends to reply about X instead of doing it. The
 * worktree is named so it does not go looking for the work somewhere else, and
 * the closing line asks for the change only — a review that comes back with the
 * requested fix plus a refactor nobody asked for has to be reviewed all over
 * again.
 */
export function formatChangeRequestPrompt(
  task: TaskWithRequests,
  requests: ChangeRequest[],
): string {
  if (requests.length === 0) return "";

  const heading =
    requests.length === 1
      ? "A review of your work asked for one change:"
      : `A review of your work asked for ${requests.length} changes:`;

  // The file goes on its own line above the request rather than inline, so a
  // request spanning several sentences does not bury it.
  const describe = (request: ChangeRequest) =>
    request.filePath ? `In \`${request.filePath}\`:\n${request.body}` : request.body;

  const body = requests
    .map((request, index) =>
      requests.length === 1 ? describe(request) : `${index + 1}. ${describe(request)}`,
    )
    .join("\n\n");

  const where = task.worktree ? ` You are on the branch \`${task.worktree}\`.` : "";

  return [
    `${heading}`,
    "",
    body,
    "",
    `Make these changes to ${task.identifier || task.title}.${where}`,
    "Change only what was asked for. Anything else has to be reviewed again.",
  ].join("\n");
}

/**
 * Where a task goes when changes are requested.
 *
 * Back to `running` when something is listening and has been told, and to
 * `ready` when nothing is — so it lands in the queue with its request attached
 * rather than sitting in review looking finished.
 */
export function statusAfterRequest(delivered: boolean): BraveliTask["status"] {
  return delivered ? "running" : "ready";
}

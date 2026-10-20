/**
 * What happened, and where. Every notification carries the thing that caused
 * it, so its button — in the window, in the list, or on the macOS banner —
 * opens that thing rather than a section to search through.
 */
export type NotificationTarget = {
  /** The screen to land on when there is nothing more specific. */
  section: "work" | "review" | "watch" | "schedule";
  projectId: string;
  sessionId?: string;
  taskId?: string;
  findingId?: string;
};

export type AppNotification = {
  id: string;
  title: string;
  body: string;
  tone: "info" | "warn" | "error";
  at: number;
  target: NotificationTarget;
  seen: boolean;
};

export const NOTIFICATIONS_KEPT = 30;

export function jumpLabel(target: NotificationTarget): string {
  if (target.sessionId) return "Open session";
  if (target.section === "review") return "Open review";
  if (target.section === "watch") return "Open in Watches";
  if (target.section === "schedule") return "Open schedule";
  return "Open";
}

/** Newest first, one per thing: a second notice about the same session replaces the first. */
export function addNotification(list: AppNotification[], next: AppNotification): AppNotification[] {
  const same = (item: AppNotification) =>
    item.target.projectId === next.target.projectId
    && item.target.section === next.target.section
    && (item.target.sessionId ?? "") === (next.target.sessionId ?? "")
    && (item.target.taskId ?? "") === (next.target.taskId ?? "")
    && (item.target.findingId ?? "") === (next.target.findingId ?? "")
    && item.title === next.title;
  return [next, ...list.filter((item) => !same(item))].slice(0, NOTIFICATIONS_KEPT);
}

/**
 * Whether this news is already in front of the person. Telling someone what
 * they are watching happen is noise, and noise is what gets notifications
 * switched off.
 */
export function alreadyOnScreen(
  target: NotificationTarget,
  view: { focused: boolean; projectId: string; section: string; sessionId: string },
): boolean {
  if (!view.focused || view.projectId !== target.projectId) return false;
  if (target.sessionId) return view.section === "work" && view.sessionId === target.sessionId;
  return view.section === target.section;
}

/**
 * Where the status bar's Automations opens. Its count spans every project, so
 * a finding waiting elsewhere opens that project's Watches on it; otherwise
 * this project's Watches when something waits here, else its Schedules.
 */
export function automationsTarget(
  findings: ReadonlyArray<{ id: string; projectId: string; state: string; updatedAt: number }>,
  activeProjectId: string,
  projectIds: readonly string[],
): NotificationTarget {
  const ready = findings.filter((finding) => finding.state === "ready" && projectIds.includes(finding.projectId));
  if (ready.some((finding) => finding.projectId === activeProjectId)) return { section: "watch", projectId: activeProjectId };
  const latest = ready.reduce<(typeof ready)[number] | undefined>((best, finding) => (!best || finding.updatedAt > best.updatedAt ? finding : best), undefined);
  return latest
    ? { section: "watch", projectId: latest.projectId, findingId: latest.id }
    : { section: "schedule", projectId: activeProjectId };
}

export function readNotifications(raw: string | null): AppNotification[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === "string" && item.target?.projectId).slice(0, NOTIFICATIONS_KEPT)
      : [];
  } catch {
    return [];
  }
}

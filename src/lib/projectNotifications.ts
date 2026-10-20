export type ProjectNotification = {
  count: number;
  lastAt: string;
  sessionName: string;
  agent: string;
};

export type ProjectNotifications = Record<string, ProjectNotification>;

export function recordProjectNotification(
  current: ProjectNotifications,
  projectId: string,
  details: Omit<ProjectNotification, "count">,
): ProjectNotifications {
  if (!projectId) return current;
  return {
    ...current,
    [projectId]: {
      ...details,
      count: Math.min(99, (current[projectId]?.count ?? 0) + 1),
    },
  };
}

export function clearProjectNotification(
  current: ProjectNotifications,
  projectId: string,
): ProjectNotifications {
  if (!current[projectId]) return current;
  const next = { ...current };
  delete next[projectId];
  return next;
}

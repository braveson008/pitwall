"use strict";
/**
 * The renderer's state as synced records, one per thing a person would
 * recognise: a project, a task, a session, a note. Small records merge well
 * (two computers editing two tasks never touch each other) and change
 * cheaply. The reverse direction lives in `src/lib/cloudApply.ts`, which the
 * renderer runs on what arrives.
 */

const PROJECT_FIELDS = ["name", "path", "branch", "status", "accent", "health", "openSessions", "queuedTasks", "lastCommit", "ci", "queue", "timeline"];
const ACTIVITY_PER_PROJECT = 200;

const outcomeId = (outcome) => [outcome.projectId, outcome.provider, outcome.model, outcome.at].join("|");

function projectRecords(snapshot) {
  const records = new Map();
  for (const project of snapshot.projects || []) {
    const data = { id: project.id };
    for (const field of PROJECT_FIELDS) if (project[field] !== undefined) data[field] = project[field];
    records.set(project.id, data);
  }
  for (const record of snapshot.braveli?.projects || []) {
    records.set(record.id, { ...(records.get(record.id) || {}), ...record });
  }
  return [...records.values()].map((data) => ({ kind: "project", localId: data.id, data }));
}

// What a session is doing right now belongs to the computer it runs on; syncing
// it would have two computers overwrite each other's view of it forever.
const AGENT_RUNTIME = ["status", "progress", "tokens", "approvals", "files", "logs"];
const WORKSPACE_RUNTIME = ["status"];
const without = (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));

/** One record per session: the terminal's copy and the workspace's copy share an id and travel together. */
function sessionRecords(snapshot) {
  const records = new Map();
  for (const project of snapshot.projects || []) {
    for (const session of project.sessions || []) {
      records.set(session.id, { projectId: project.id, agent: without(session, AGENT_RUNTIME) });
    }
  }
  for (const session of snapshot.braveli?.sessions || []) {
    records.set(session.id, { projectId: session.projectId, ...(records.get(session.id) || {}), workspace: without(session, WORKSPACE_RUNTIME) });
  }
  return [...records.entries()].map(([id, data]) => {
    const nativeSessionId = data.agent?.nativeSessionId || data.workspace?.nativeSessionId;
    const nativeSessionStarted = Boolean(data.agent?.nativeSessionStarted || data.workspace?.nativeSessionStarted);
    const merged = { ...data };
    if (nativeSessionId) {
      if (merged.agent) merged.agent = { ...merged.agent, nativeSessionId, nativeSessionStarted };
      if (merged.workspace) merged.workspace = { ...merged.workspace, nativeSessionId, nativeSessionStarted };
    }
    return { kind: "session", localId: id, data: merged };
  });
}

function activityRecords(snapshot) {
  const byProject = new Map();
  for (const event of snapshot.braveli?.activity || []) {
    const list = byProject.get(event.projectId) || [];
    if (list.length < ACTIVITY_PER_PROJECT) list.push(event);
    byProject.set(event.projectId, list);
  }
  return [...byProject.entries()].map(([projectId, events]) => ({ kind: "activity", localId: projectId, data: { projectId, events } }));
}

const each = (kind, items, idOf = (item) => item.id) =>
  (items || []).filter((item) => item && idOf(item)).map((item) => ({ kind, localId: String(idOf(item)), data: item }));

function recordsFromSnapshot(snapshot) {
  if (!snapshot) return [];
  const braveli = snapshot.braveli || {};
  return [
    ...projectRecords(snapshot),
    ...sessionRecords(snapshot),
    ...each("task", braveli.tasks),
    ...each("context", braveli.contextEntries),
    ...each("snapshot", braveli.contextSnapshots),
    ...each("council", braveli.councilRuns),
    ...each("compare", braveli.compareRuns),
    ...activityRecords(snapshot),
    ...each("taskRun", snapshot.taskRuns),
    ...each("outcome", snapshot.outcomes, outcomeId),
    ...each("customAgent", snapshot.customAgents),
    { kind: "sessionOrder", localId: "all", data: { order: snapshot.sessionOrder || {} } },
    { kind: "prefs", localId: "all", data: { ...(snapshot.prefs || {}) } },
  ];
}

const RENDERER_KINDS = new Set([
  "project", "session", "task", "context", "snapshot", "council", "compare", "activity", "taskRun", "outcome", "customAgent", "sessionOrder", "prefs",
]);

module.exports = { RENDERER_KINDS, outcomeId, recordsFromSnapshot };

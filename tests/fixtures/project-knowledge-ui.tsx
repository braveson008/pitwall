import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectKnowledgePanel } from "../../src/components/ProjectKnowledgePanel";
import { CouncilGrid } from "../../src/components/CouncilGrid";
import { CouncilThread } from "../../src/components/CouncilThread";
import { ProjectHub } from "../../src/components/ProjectHub";
import { AgentTerminalView } from "../../src/components/AgentTerminalView";
import { CreateSessionModal } from "../../src/components/CreateSessionModal";
import { createTerminalLinesStore } from "../../src/terminal/terminalLinesStore";

const emptyLines = createTerminalLinesStore({});
import "../../src/styles.css";
import "../../src/styles/workspace.css";
import "../../src/styles/projectKnowledge.css";
import "../../src/styles/council.css";
import "../../src/styles/desktop.css";
import "../../src/styles/desktop/session.css";
import "../../src/styles/desktop/projects.css";
import "../../src/styles/desktop/council.css";

const timestamp = "2026-09-07T10:00:00.000Z";
const base = {
  version: 1,
  scope: { type: "project" },
  sources: [{ path: "package.json", hash: "source-hash-1" }],
  status: "observed",
  origin: "inventory",
  pinned: false,
  createdAt: timestamp,
  updatedAt: timestamp,
  freshness: "current",
  compatible: true,
};
const record = {
  ...base,
  id: "commands",
  kind: "command",
  title: "Build and test commands",
  content: "Use npm run build for the production build. Run npm test for the configured test suites.",
};
const snapshot = {
  ok: true,
  repositoryId: "fixture-project",
  records: [],
  receipts: [],
  coverage: { filesInspected: 0, inspectedPaths: [], totalEligibleFiles: 12, scanTruncated: false },
  warnings: [],
};
const receipt = {
  id: "receipt-1",
  provider: "Codex",
  role: "Implementation",
  taskId: "memory-task",
  records: [{ id: record.id, version: 1, title: record.title, sources: record.sources, freshness: "current" }],
  manualEntryIds: ["note-1"],
  manualEntries: [{ id: "note-1", title: "Acceptance criteria" }],
  payloadHash: "exact-payload-hash",
  approximateChars: 612,
  workspacePath: "/project/worktree",
  branch: "feature/memory",
  revision: "abc123",
  status: "delivered",
  createdAt: timestamp,
  deliveredAt: timestamp,
  warnings: [],
};
const fixture = {
  conflict: false,
  inspectFailure: false,
  learnFailure: false,
  inspected: [],
  updates: [],
  actions: [],
  resizes: [],
  append: () => {},
  switchProject: () => {},
  refresh: () => {},
};
window.__knowledgeUi = fixture;
window.pitwall = {
  inspectProjectKnowledge: async (location) => {
    fixture.inspected.push(location.projectPath);
    if (fixture.inspectFailure) return { ...snapshot, ok: false, error: "Fixture store unavailable" };
    return structuredClone(snapshot);
  },
  learnProjectKnowledge: async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (fixture.learnFailure) return { ...snapshot, ok: false, error: "Fixture learning failed" };
    snapshot.records = [
      structuredClone(record),
      {
        ...base,
        id: "area",
        kind: "area",
        title: "Billing and totals",
        content: "src/billing owns invoice totals and rounding.",
        sources: [{ path: "src/billing/totals.ts", hash: "totals-hash" }],
        freshness: "stale",
      },
      {
        ...base,
        id: "decision",
        kind: "decision",
        title: "Keep calculation separate",
        content: "Format totals only at the UI boundary.",
        origin: "agent",
        status: "tentative",
        compatible: false,
        scope: { type: "task", taskId: "memory-task", workspacePath: "/project/worktree" },
      },
    ];
    snapshot.coverage = {
      filesInspected: 3,
      inspectedPaths: ["package.json", "README.md", "src/billing/totals.ts"],
      totalEligibleFiles: 12,
      scanTruncated: false,
      lastLearnedAt: timestamp,
    };
    snapshot.receipts = [
      receipt,
      { ...receipt, id: "receipt-2", status: "failed", error: "Agent transport unavailable" },
      { ...receipt, id: "receipt-3", status: "prepared" },
    ];
    return structuredClone(snapshot);
  },
  updateProjectKnowledge: async (input) => {
    fixture.updates.push(input);
    const current = snapshot.records.find((item) => item.id === input.id);
    if (fixture.conflict) {
      fixture.conflict = false;
      current.version += 1;
      current.content = "A newer recorded command from another task.";
      return { ok: false, error: "Knowledge record changed. Reload before editing." };
    }
    if (current.version !== input.expectedVersion)
      return { ok: false, error: "Knowledge record changed. Reload before editing." };
    Object.assign(current, input.patch, { version: current.version + 1, updatedAt: new Date().toISOString() });
    return { ok: true, record: structuredClone(current) };
  },
};

const members = [
  {
    sessionId: "architect",
    memberId: "architect-claude",
    rolePrompt: "Architect",
    roleLabel: "Architect",
    agentLabel: "Claude",
    writesCode: false,
  },
  {
    sessionId: "implementer",
    memberId: "implementer-codex",
    rolePrompt: "Implementer",
    roleLabel: "Implementer",
    agentLabel: "Codex",
    writesCode: true,
  },
];
const messages = Array.from({ length: 35 }, (_, index) => ({
  turn: index + 1,
  fromMemberId: members[index % 2].memberId,
  toMemberId: members[(index + 1) % 2].memberId,
  content: `Turn ${index + 1}: inspected the invoice boundary and recorded source paths. The next member can verify rounding without rediscovering the repository.`,
}));
const routes = [
  {
    turn: 1,
    fromMemberId: members[0].memberId,
    toMemberId: members[1].memberId,
    source: "conductor",
    reason: "The design is ready for implementation.",
    directive: "Implement project knowledge.",
  },
];
const noop = () => {};

const sessionAgents = [
  { agent: "Codex", command: "codex", loginCommand: "", models: [{ label: "Auto", value: "auto" }, { label: "gpt-5", value: "gpt-5" }] },
  { agent: "Claude", command: "claude", loginCommand: "", models: [{ label: "Auto", value: "auto" }, { label: "Sonnet", value: "sonnet" }] },
  { agent: "Cursor", command: "cursor-agent", loginCommand: "", models: [{ label: "Auto", value: "auto" }] },
  { agent: "Aider", command: "aider", loginCommand: "", models: [{ label: "Default", value: "default" }], custom: true, id: "custom-aider" },
];

/**
 * The create-session dialog over the same draft state App keeps, so a smoke can
 * read back exactly what `createAgentSession` would be handed.
 */
function CreateSessionFixture() {
  const [agents, setAgents] = useState(sessionAgents);
  const [agent, setAgent] = useState("Codex");
  const [model, setModel] = useState("Auto");
  const [taskId, setTaskId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [sessionType, setSessionType] = useState("implementation");
  const [autoApprove, setAutoApprove] = useState(false);
  const [contextIds, setContextIds] = useState(["c1"]);
  const [open, setOpen] = useState(true);
  const provider = agents.find((item) => item.agent === agent) ?? agents[0];
  const modelValue = provider.models.find((item) => item.label === model)?.value ?? model;
  const record = ((window as never as { __createSession?: { created: unknown[]; events: string[] } }).__createSession ??= {
    created: [],
    events: [],
  });
  return (
    <div className="app-shell" style={{ display: "block", height: "100vh" }}>
      <CreateSessionModal
        {...({
          open,
          agentOptions: agents,
          agentChecks: {
            Codex: { status: "ready", message: "ready" },
            Claude: { status: "ready", message: "ready" },
          },
          checkingAgents: false,
          draftAgent: agent,
          draftModels: provider.models,
          draftModel: model,
          draftTaskId: taskId,
          draftInstruction: instruction,
          draftSessionType: sessionType,
          draftBootCommand: `${provider.command} --model ${modelValue}`,
          draftAutoApprove: autoApprove,
          modelSource: `${provider.command} model cache`,
          modelsLoading: false,
          createDisabled: false,
          projectTasks: [
            { id: "t1", title: "Fix the review screen" },
            { id: "t2", title: "A very long imported task title that must stay inside its own column" },
          ],
          contextEntries: [
            { id: "c1", title: "Conventions", category: "coding-standards" },
            { id: "c2", title: "Architecture", category: "architecture" },
          ],
          selectedContextIds: contextIds,
          // Same as App's selectDraftAgent: a new agent starts on its first model.
          onSelectAgent: (next: string) => {
            const chosen = agents.find((item) => item.agent === next) ?? agents[0];
            setAgent(chosen.agent);
            setModel(chosen.models[0].label);
          },
          onRemoveCustomAgent: (id: string) => {
            record.events.push(`remove:${id}`);
            setAgents((current) => current.filter((item) => (item as { id?: string }).id !== id));
          },
          onAddAgent: () => record.events.push("add-agent"),
          onTaskChange: setTaskId,
          onInstructionChange: setInstruction,
          onRoleChange: setSessionType,
          onAutoApproveChange: setAutoApprove,
          onModelChange: setModel,
          onRefreshModels: () => record.events.push("refresh-models"),
          onToggleContext: (id: string, checked: boolean) =>
            setContextIds((current) => (checked ? [...current, id] : current.filter((item) => item !== id))),
          onCreate: () =>
            record.created.push({ agent, model, sessionType, taskId, instruction, autoApprove, selectedContextIds: contextIds }),
          onClose: () => {
            record.events.push("close");
            setOpen(false);
          },
        } as never)}
      />
    </div>
  );
}


function Fixture() {
  const [thread, setThread] = useState(messages);
  const [project, setProject] = useState("/project");
  const [refreshKey, setRefreshKey] = useState(0);
  const [terminalFontSize, setTerminalFontSize] = useState(12);
  const [terminalFontFamily, setTerminalFontFamily] = useState("monospace");
  fixture.append = () =>
    setThread((current) => [
      ...current,
      {
        ...messages[0],
        turn: current.length + 1,
        content: `New handoff ${current.length + 1}: the implementation now persists context.`,
      },
    ]);
  fixture.switchProject = () => setProject("/other-project");
  fixture.refresh = () => setRefreshKey((value) => value + 1);
  const mode = new URLSearchParams(location.search).get("mode");
  if (mode === "thread")
    return (
      <div style={{ height: "100vh", display: "grid", gridTemplateRows: "minmax(0, 1fr)" }}>
        <CouncilThread
          members={members}
          messages={thread}
          routes={routes}
          currentTurn={36}
          currentMemberId="implementer-codex"
          onOpenMember={noop}
        />
      </div>
    );
  if (mode === "create-session") return <CreateSessionFixture />;

  if (mode === "xterm") {
    /* The real terminal view inside the real workbench markup, so the number of
       rows it asks the PTY for can be compared with the number a person can
       actually see. */
    const screen: string[] = [];
    for (let line = 1; line <= 200; line += 1) screen.push(`line ${String(line).padStart(3, "0")} ${"-".repeat(40)}\r\n`);
    return (
      <div className="app-shell" style={{ display: "block", height: "100vh" }}>
        <div className="workbench-panel" style={{ height: "100vh" }}>
          <div className="workbench-tabs" style={{ height: 40 }} />
          <div className="workbench-pane active">
            <div className="terminal-workbench active">
              <div className="terminal-header" />
              <div className="session-surfaces">
                <div className="session-surface">
                  <AgentTerminalView
                    sessionId="probe"
                    active
                    fontFamily="JetBrains Mono"
                    fontSize={14}
                    chunks={screen}
                    onInput={noop}
                    onResize={(cols, rows) => { (window as never as Record<string, unknown>).__fit = { cols, rows }; }}
                  />
                </div>
              </div>
              <div className="composer-slot is-hidden" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "schedule") {
    /* The booked day, so the time column can actually be looked at: a repeat
       with an end, a repeat without one, and a plain single run all have to
       share one set of columns without landing on each other. */
    const jobs = [
      { id: "a", hour: 8, minute: 0, prompt: 'Pick up Jira tickets assigned to me with status "QA Failed" in the active sprint, via the Jira MCP.', agent: "claude", days: [], everyHours: 1, untilMinutes: 1200, enabled: true, history: [] },
      { id: "b", hour: 8, minute: 0, prompt: 'Pick up Jira tickets assigned to me with status "To Do" in the active sprint, via the Jira MCP.', agent: "claude", days: [], everyHours: 1, untilMinutes: 1200, enabled: true, history: [] },
      { id: "c", hour: 11, minute: 0, prompt: "Check if staging is behind dev, and open a PR merging dev into staging.", agent: "codex", days: [], everyHours: 4, untilMinutes: 0, enabled: true, history: [] },
      { id: "d", hour: 13, minute: 30, prompt: "Summarise what landed today.", agent: "claude", days: [1, 2, 3, 4, 5], everyHours: 0, enabled: true, history: [] },
      { id: "e", hour: 9, minute: 30, prompt: "A run that ends on a quarter hour, to check the column takes an odd width.", agent: "claude", days: [], everyHours: 12, untilMinutes: 1005, enabled: true, history: [] },
    ];
    return (
      <div className="app-shell" style={{ display: "block", height: "100vh", overflow: "auto", padding: "0 24px" }}>
        <ProjectHub
          {...({
            section: "schedule",
            project: { path: project, name: "admin", sessions: [] },
            tasks: [],
            sessions: [],
            contextEntries: [],
            selectedContextIds: [],
            activity: [],
            runCountByTask: {},
            scheduleJobs: jobs,
            scheduleAgents: ["claude", "codex"],
            githubLogin: "braveson008",
            editorLabel: "VS Code",
            previewByTask: {},
            syncingTasks: false,
            providerLabel: (value) => String(value ?? ""),
          } as never)}
        />
      </div>
    );
  }
  if (mode === "council")
    return (
      <div style={{ height: "100vh" }}>
        <CouncilGrid
          active
          hasRun
          mode="council"
          name="Remember project context"
          ptySize={{}}
          sessions={members.map((member) => ({
            id: member.sessionId,
            name: member.roleLabel,
            agent: member.agentLabel,
            status: "running",
            model: "default",
            branch: "feature/memory",
            task: "Context memory",
            logs: [],
          }))}
          gateBySession={{ implementer: "This pane is waiting on you — a sign-in, a trust prompt, or the CLI offering to update itself." }}
          relayBySession={{
            architect: { state: "handed", turn: 1, canHandoff: false },
            implementer: { state: "active", turn: 2, canHandoff: true },
          }}
          relayMembers={members}
          thread={thread}
          routes={routes}
          currentMemberId="implementer-codex"
          relayRun={{
            turn: 2,
            auto: true,
            note: "Architect (Claude) was asked twice for a handoff and did not write one. Read the pane, then hand off or re-route.",
            config: { enabled: true, model: "opus", runTests: true, maxTurns: 24 },
          }}
          summary={{
            objective: "Make Pitwall remember project context",
            decisions: ["Store project knowledge locally and retain source hashes."],
            workingSet: {
              files: [{ path: "src/billing/totals.ts", note: "Rounding boundary", turn: 1, by: "Architect" }],
              commands: ["npm test"],
              conventions: [],
              openQuestions: ["Who owns the release check? · DevOps"],
            },
            evidence: {
              changedPaths: ["src/billing/totals.ts"],
              dirtyPaths: ["src/billing/totals.ts"],
              claimedWithoutChanges: false,
              tests: { command: "npm test", passed: false, output: "1 test failed: rounding at the boundary" },
            },
            verification: { attempt: 1, verdict: null },
            currentAssignment: {
              member: "Implementer",
              directive: "Persist repository knowledge and source evidence.",
            },
            contextReceipts: [receipt],
          }}
          onOpenMember={noop}
          onHandoff={noop}
          onToggleRelayAuto={noop}
          onExtendTurns={noop}
          onUpdateConfig={noop}
          onAdoptCouncil={noop}
          linesStore={emptyLines}
          terminalFontFamily={terminalFontFamily}
          terminalFontSize={terminalFontSize}
          onTerminalFontFamilyChange={setTerminalFontFamily}
          onTerminalFontSizeChange={setTerminalFontSize}
          memberWork={
            new URLSearchParams(location.search).has("needs-you")
              ? [{
                  memberId: "implementer-codex",
                  sessionId: "implementer",
                  roleLabel: "Implementer",
                  agentLabel: "Codex",
                  state: "waiting",
                  step: null,
                  steps: [],
                  forMs: 42_000,
                  isCurrent: true,
                }]
              : []
          }
          bootCommand={() => ""}
          canStart
          sharedMessage=""
          broadcasting={false}
          conductorMessage=""
          conductorLog={[
            { id: "c1", role: "system", text: "Keep proposals in their own section, separate from decisions." },
            { id: "c2", role: "conductor", text: "Routed turn 1 to the Architect to settle the approach before any code is written." },
            { id: "c3", role: "you", text: "Who is verifying https://example-co.atlassian.net/browse/ACME-2517?atlOrigin=eyJpIjoiZmZmZmZmZmZmZmZmIiwicCI6ImoifQ and apps/voy/src/features/questionnaire/components/StandaloneQuestionnaireAnalyticsProvider.tsx?" },
            { id: "c4", role: "conductor", text: "Reviewer / QA holds verification; the Implementer hands off with commands and outcomes." },
          ]}
          conductorDirectives={[]}
          conductorBusy
          conductorStatus="Asking the conductor who takes the turn — up to two minutes."
          onConductorMessageChange={noop}
          onAskConductor={noop}
          onInstructConductor={noop}
          onForceReroute={noop}
          onSendAll={() => fixture.actions.push("resend")}
          onSharedMessageChange={noop}
          onBroadcast={noop}
          onStopAll={() => fixture.actions.push("stop")}
          onPause={() => fixture.actions.push("pause")}
          onResume={noop}
          onStopSession={noop}
          onRestartSession={noop}
          attachedBySession={{}}
          swapOptions={[]}
          onSwapMember={noop}
          onDeleteSession={noop}
          onSendSession={noop}
          onSynthesize={() => fixture.actions.push("synthesize")}
          onInput={noop}
          onResize={(session, cols, rows) => fixture.resizes.push({ id: session.id, cols, rows })}
          onStart={noop}
        />
      </div>
    );
  // The real mount is a child of `.workspace`, which is a flex column with
  // `overflow: hidden` — a panel there has to scroll itself. The fixture used to
  // supply its own `overflowY: auto`, which scrolled the page and hid whether the
  // panel could.
  return (
    <div
      style={{
        maxWidth: 1080,
        margin: "0 auto",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <ProjectKnowledgePanel
        projectPath={project}
        refreshKey={refreshKey}
        manualContext={<button type="button">New context</button>}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);

import { useEffect, useRef, useState } from "react";
import { Boxes, Plus, X } from "lucide-react";
import { providerRegistry } from "../domain/providers";
import type { AgentOption } from "../domain/agents";
import { MAX_RELAY_TURNS, RELAY_TURN_CEILING, RELAY_TURN_LIMITS, normalizeTurnLimit } from "../lib/councilRelay";
import { roleOrder, roles } from "../domain/roles";
import { splitByAutoApprove } from "../domain/autoApprove";
import type { AgentProvider } from "../data";
import type { BraveliSessionType, BraveliTask } from "../domain/types";
import { Dropdown } from "./Dropdown";
import { useModalFocus } from "../hooks/useModalFocus";

export interface CouncilMember {
  /**
   * The agent, by the name every other part of Pitwall looks one up with.
   *
   * It was a provider id, which quietly limited a council to the five
   * first-class providers: a local model or an agent you added yourself could
   * not be a member, because the code that built the sessions dropped
   * anything it could not find in the provider registry.
   */
  agent: AgentProvider;
  role: BraveliSessionType;
  /** Which model that agent runs. "Auto" leaves it to the CLI. */
  model: string;
}

/** Who decides where each handoff goes, and on which model. */
export interface CouncilConductor {
  enabled: boolean;
  agent: string;
  model: string;
  runTests: boolean;
  /** Whether the council argues out its approach before anyone writes code. */
  openingDebate: boolean;
  /**
   * Launch every member in its own CLI's unattended mode.
   *
   * A council is meant to run while you do something else, and a member
   * sitting on an unanswered permission prompt holds the whole relay: the
   * conductor cannot route past it and the turn times out having done nothing.
   */
  autoApprove: boolean;
  /** Turns of automatic hand-off. null means run until the safety ceiling. */
  maxTurns: number | null;
}

interface MemberRow extends CouncilMember {
  uid: string;
}

/**
 * Conductor model choices. Routing quality is worth paying for — a bad hop
 * wastes a whole agent turn — but a long-running council is a lot of routing
 * calls, so a cheaper option is offered for runs where order matters less.
 */
const CONDUCTOR_MODELS = [
  { value: "opus", label: "Opus", hint: "best routing" },
  { value: "sonnet", label: "Sonnet", hint: "cheaper" },
  { value: "auto", label: "Auto", hint: "CLI default" },
];

const TURN_LIMIT_OPTIONS = [
  ...RELAY_TURN_LIMITS.map((limit) => ({
    value: String(limit),
    label: `${limit} turns`,
    hint: limit === MAX_RELAY_TURNS ? "default" : undefined,
  })),
  { value: "unlimited", label: "Unlimited", hint: `stops at ${RELAY_TURN_CEILING}` },
  { value: "custom", label: "Custom…" },
];

/**
 * Agent + role picker for Council / Compare. The council is a free-form list of
 * members — you can add the same agent more than once (e.g. two Claudes, one as
 * Architect and one as Reviewer) and give each its own role. Compare mode drops
 * the roles: every member answers the same task independently.
 */
export function CouncilSetupModal({
  open,
  mode,
  agentOptions,
  agentChecks,
  tasks,
  activeTaskId,
  onClose,
  onStart,
}: {
  open: boolean;
  mode: "council" | "compare";
  /** Every agent a session could start with, including local and custom ones. */
  agentOptions: AgentOption[];
  agentChecks: Partial<Record<string, { status: string }>>;
  /** The project's tasks, so the council can be pointed at one deliberately. */
  tasks: BraveliTask[];
  /** Whichever task is selected in the workspace, used as the default. */
  activeTaskId: string;
  onClose: () => void;
  onStart: (members: CouncilMember[], conductor: CouncilConductor, taskId: string) => void;
}) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [conductorEnabled, setConductorEnabled] = useState(true);
  const [conductorModel, setConductorModel] = useState("opus");
  const [runTests, setRunTests] = useState(true);
  const [openingDebate, setOpeningDebate] = useState(true);
  // Off by default: it removes the approval gate on agents that can run
  // arbitrary commands, so it is turned on deliberately rather than found on.
  const [autoApprove, setAutoApprove] = useState(false);
  const [taskId, setTaskId] = useState(activeTaskId);
  const [turnChoice, setTurnChoice] = useState(String(MAX_RELAY_TURNS));
  const [customTurns, setCustomTurns] = useState(String(MAX_RELAY_TURNS * 2));
  // Seeding must not overwrite a roster the user has already edited.
  const edited = useRef(false);
  const uid = useRef(0);
  const nextUid = () => `m${uid.current++}`;

  /**
   * A local model or a custom agent is never "missing": it is only offered
   * when Pitwall already worked out that it can be run.
   */
  const isMissing = (agent: AgentProvider) => {
    const option = agentOptions.find((item) => item.agent === agent);
    if (!option) return true;
    if (option.local || option.custom) return false;
    return agentChecks[agent]?.status === "missing";
  };
  /**
   * Every agent that can be picked, and the smaller set a fresh council is
   * seeded from.
   *
   * They are not the same list on purpose. A local model or an agent you
   * added yourself should be choosable — that was the gap — but seeding one
   * into every new council by default would change what a council costs and
   * how good it is without anybody asking for it. A default roster is a
   * recommendation, and this one recommends the providers you signed in to.
   */
  const selectable = agentOptions.filter((option) => !isMissing(option.agent));
  const installed = selectable.filter((option) => !option.local && !option.custom);
  const fallbackAgent = (installed[0] ?? selectable[0] ?? agentOptions[0])?.agent;
  const modelsFor = (agent: AgentProvider) =>
    agentOptions.find((option) => option.agent === agent)?.models ?? [{ label: "Auto", value: "auto" }];
  const defaultModelFor = (agent: AgentProvider) => modelsFor(agent)[0]?.label ?? "Auto";

  // Which agents are actually installed. The checks are asynchronous, so a modal
  // opened quickly can be seeded before they land — hence re-seeding below when
  // this changes rather than only on open.
  const installedKey = installed.map((option) => String(option.agent)).join(",");

  useEffect(() => {
    // Reopening returns to whatever the workspace has selected; a choice made
    // inside the modal only lasts as long as the modal is open.
    if (open) setTaskId(activeTaskId);
  }, [open, activeTaskId]);

  useEffect(() => {
    if (!open) {
      edited.current = false;
      return;
    }
    // Seed one member per installed agent, cycling roles so a fresh council is a
    // ready-to-run pipeline rather than an empty form.
    if (edited.current) return;
    const available = installed.length > 0 ? installed : (selectable.length ? selectable : agentOptions);
    if (available.length === 0) return;
    const memberCount = mode === "council" ? Math.max(3, available.length) : available.length;
    const seeded: MemberRow[] = Array.from({ length: memberCount }, (_, index) => {
      const agent = available[index % available.length].agent;
      return {
        uid: nextUid(),
        agent,
        model: defaultModelFor(agent),
        role: roleOrder[index % roleOrder.length],
      };
    });
    setMembers(seeded);
    // Re-seed when the install checks resolve, but never over the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, installedKey]);

  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose);
  if (!open) return null;

  const addMember = () => {
    edited.current = true;
    setMembers((current) => [
      ...current,
      {
        uid: nextUid(),
        agent: fallbackAgent,
        model: defaultModelFor(fallbackAgent),
        role: roleOrder[current.length % roleOrder.length],
      },
    ]);
  };

  const removeMember = (rowUid: string) => {
    edited.current = true;
    setMembers((current) => current.filter((row) => row.uid !== rowUid));
  };

  const patchMember = (rowUid: string, patch: Partial<CouncilMember>) => {
    edited.current = true;
    setMembers((current) => current.map((row) => (row.uid === rowUid ? { ...row, ...patch } : row)));
  };

  const runnable = members.filter((row) => !isMissing(row.agent));
  const canStart = runnable.length > 0;
  /**
   * Which of this roster will actually run unattended, by the binary each
   * member launches — not by its display name, since that is what the flag is
   * verified against.
   */
  const autoApproveCoverage = splitByAutoApprove(
    runnable.map((row) => agentOptions.find((option) => option.agent === row.agent)?.command ?? ""),
  );

  /**
   * The agents a council can actually be built from.
   *
   * A member whose CLI is not installed was offered as a disabled row saying
   * "not installed" — a choice presented in order to be refused. Installing
   * one belongs in Connections, where the catalogue is.
   *
   * Dropped only once an agent has actually been reported missing, so a check
   * still running removes nothing; and if that would leave nothing to build a
   * council from, the full list is shown instead, because an empty dropdown
   * explains less than rows saying what is wrong with each.
   */
  const councilAgentOptions = (() => {
    const rows = agentOptions.map((option) => ({
      value: String(option.agent),
      label: String(option.agent),
      // A local model says so, since "Ollama" alone does not tell you the
      // work stays on this machine.
      hint: option.local ? "local" : option.custom ? "custom" : undefined,
      installed: !isMissing(option.agent),
    }));
    const usable = rows.filter((row) => row.installed);
    return (usable.length ? usable : rows).map(({ value, label, hint, installed }) => ({
      value,
      label,
      hint: installed ? hint : "not installed",
      disabled: !installed,
    }));
  })();


  return (
    <div className="dk-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dk-dialog dk-council-setup"
        role="dialog"
        aria-modal="true"
        aria-label="Set up Council"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">{mode === "compare" ? "Compare agents" : "Build your council"}</h2>
            <p className="dk-dialog-desc">
              {mode === "compare"
                ? "Every member answers the same task independently, so you can compare their work side by side."
                : "Add each agent and the role it plays. Reuse an agent for more than one role — say two Claudes, one Architect and one Reviewer."}
            </p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          {/* Which task, chosen here rather than inherited from whatever happened
              to be selected in the workspace. Starting a council is a deliberate
              act and it should say what it is for. */}
          {tasks.length > 0 && (
            <div className="dk-field">
              <span className="dk-label">Working on</span>
              <Dropdown
                value={taskId}
                onChange={setTaskId}
                ariaLabel="Task"
                options={tasks.map((task) => ({
                  value: task.id,
                  label: task.title,
                  // Says which ones are already finished, so a council is not
                  // pointed at settled work by accident.
                  hint: task.status === "completed" || task.status === "cancelled" ? task.status : undefined,
                }))}
              />
            </div>
          )}

          <div className="dk-field">
            <span className="dk-label">Members</span>
            <div className="dk-list">
              {members.map((row, index) => {
                const missing = isMissing(row.agent);
                return (
                  <div className={`dk-list-row dk-council-member${missing ? " is-missing" : ""}`} key={row.uid}>
                    <span className="dk-council-member-index">{index + 1}</span>
                    <Dropdown
                      className="dk-council-member-agent"
                      value={String(row.agent)}
                      onChange={(value) => patchMember(row.uid, {
                        agent: value as AgentProvider,
                        // The models belong to the agent, so the old choice cannot
                        // survive a change of agent.
                        model: defaultModelFor(value as AgentProvider),
                      })}
                      ariaLabel="Agent"
                      options={councilAgentOptions}
                    />
                    {/* Which model this seat runs. A council of two Claudes is a
                        different council when one is on Opus and the other on
                        Sonnet, and until now that was decided for you by taking
                        whichever model happened to be listed first. Hidden when
                        the agent offers only one, since a dropdown with a single
                        entry is a label pretending to be a choice. */}
                    {modelsFor(row.agent).length > 1 && (
                      <Dropdown
                        className="dk-council-member-model"
                        value={row.model}
                        onChange={(value) => patchMember(row.uid, { model: value })}
                        ariaLabel="Model"
                        options={modelsFor(row.agent).map((model) => ({ value: model.label, label: model.label }))}
                      />
                    )}
                    {mode === "council" && (
                      <Dropdown
                        className="dk-council-member-role"
                        value={row.role}
                        onChange={(value) => patchMember(row.uid, { role: value as BraveliSessionType })}
                        ariaLabel="Role"
                        options={roleOrder.map((type) => ({ value: type, label: roles[type].label }))}
                      />
                    )}
                    <span className="dk-spacer" />
                    <button
                      type="button"
                      className="dk-icon-btn dk-icon-btn--sm"
                      title="Remove"
                      aria-label="Remove"
                      onClick={() => removeMember(row.uid)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}

              <button type="button" className="dk-list-row dk-council-member-add" onClick={addMember}>
                <Plus size={15} />
                Add agent
              </button>
            </div>
          </div>

          {mode === "council" && (
            <div className="dk-field">
              <span className="dk-label">How it runs</span>
              <div className="dk-list">
                {runnable.length > 1 && (
                  <div className="dk-list-row dk-council-option">
                    <label className="dk-check dk-council-option-label">
                      <input
                        type="checkbox"
                        checked={conductorEnabled}
                        onChange={(event) => setConductorEnabled(event.target.checked)}
                      />
                      <span className="dk-row-main">
                        <span className="dk-row-title">Conductor</span>
                        <span className="dk-council-option-desc">
                          {conductorEnabled
                            ? "Claude reads the whole discussion after every turn and decides who speaks next."
                            : "Members take fixed turns in the order listed above."}
                        </span>
                      </span>
                    </label>
                    {conductorEnabled && (
                      <Dropdown
                        className="dk-council-option-select"
                        value={conductorModel}
                        onChange={setConductorModel}
                        ariaLabel="Conductor model"
                        options={CONDUCTOR_MODELS}
                      />
                    )}
                  </div>
                )}

                <div className="dk-list-row dk-council-option">
                  <label className="dk-check dk-council-option-label">
                    <input
                      type="checkbox"
                      checked={autoApprove}
                      onChange={(event) => setAutoApprove(event.target.checked)}
                      disabled={autoApproveCoverage.covered.length === 0}
                    />
                    <span className="dk-row-main">
                      <span className="dk-row-title">Run without asking permission</span>
                      <span className="dk-council-option-desc">
                        {autoApproveCoverage.covered.length === 0
                          ? "None of these agents has a mode Pitwall has verified for this, so they will each ask before writing files or running commands."
                          : autoApprove
                            ? "Each member runs in its own CLI's unattended mode, deciding for itself instead of stopping to ask you. They will write files and run commands — including ones the task did not call for."
                            : "Members stop and ask before writing files or running commands, and the council waits on you."}
                      </span>
                      {/* Named, because a mode that silently covers three of four
                          members is worse than none: you leave it running and come
                          back to the one that stopped on turn two. */}
                      {autoApprove && autoApproveCoverage.uncovered.length > 0 && (
                        <span className="dk-council-option-desc is-warn">
                          {autoApproveCoverage.uncovered.join(", ")} will still ask — Pitwall has no verified
                          flag for {autoApproveCoverage.uncovered.length === 1 ? "it" : "them"}.
                        </span>
                      )}
                    </span>
                  </label>
                </div>

                {runnable.length > 1 && (
                  <div className="dk-list-row dk-council-option">
                    <label className="dk-check dk-council-option-label">
                      <input
                        type="checkbox"
                        checked={openingDebate}
                        onChange={(event) => setOpeningDebate(event.target.checked)}
                      />
                      <span className="dk-row-main">
                        <span className="dk-row-title">Agree the approach first</span>
                        <span className="dk-council-option-desc">
                          {openingDebate
                            ? "Every member states how it would approach the task and they argue it out before any code is written."
                            : "The first member sets the approach by going first."}
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {runnable.length > 1 && (
                  <div className="dk-list-row dk-council-option">
                    <label className="dk-check dk-council-option-label">
                      <input type="checkbox" checked={runTests} onChange={(event) => setRunTests(event.target.checked)} />
                      <span className="dk-row-main">
                        <span className="dk-row-title">Verify with the project's tests</span>
                        <span className="dk-council-option-desc">
                          {runTests
                            ? "Runs the project's test script after any turn that changes code, and tells the council when it fails."
                            : "The council judges its own work by reading it."}
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {runnable.length > 1 && (
                  <div className="dk-list-row dk-council-option">
                    <span className="dk-row-main dk-council-option-label dk-council-turn-label">
                      <span className="dk-row-title">Turn limit</span>
                      <span className="dk-council-option-desc">
                        {turnChoice === "unlimited"
                          ? `Runs until the council finishes or reaches the ${RELAY_TURN_CEILING}-turn safety ceiling. Every turn is a full agent run.`
                          : "How far the council may go on its own. You can raise it while it is running."}
                      </span>
                    </span>
                    <Dropdown
                      className="dk-council-option-select"
                      value={turnChoice}
                      onChange={setTurnChoice}
                      ariaLabel="Turn limit"
                      options={TURN_LIMIT_OPTIONS}
                    />
                    {turnChoice === "custom" && (
                      <input
                        className="dk-input dk-council-turn-custom"
                        type="number"
                        min={1}
                        max={RELAY_TURN_CEILING}
                        value={customTurns}
                        onChange={(event) => setCustomTurns(event.target.value)}
                        aria-label="Custom turn limit"
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="dk-dialog-footer">
          <button type="button" className="dk-btn dk-btn--ghost" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="dk-btn dk-btn--primary"
            disabled={!canStart}
            onClick={() =>
              onStart(runnable.map(({ agent, model, role }) => ({ agent, model, role })), {
                enabled: conductorEnabled,
                agent: "Claude",
                model: conductorModel,
                runTests,
                openingDebate,
                autoApprove,
                maxTurns:
                  turnChoice === "unlimited"
                    ? null
                    : normalizeTurnLimit(turnChoice === "custom" ? customTurns : turnChoice),
              }, taskId)
            }
          >
            <Boxes size={16} />
            {mode === "compare" ? "Compare" : "Start council"} ({runnable.length})
          </button>
        </div>
      </div>
    </div>
  );
}

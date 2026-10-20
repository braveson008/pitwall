import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useModalFocus } from "../hooks/useModalFocus";
import type { AgentProvider } from "../data";
import type { AgentOption, ModelOption } from "../domain/agents";
import { PAIR_REVIEWERS, pairReviewerLabel } from "../domain/pairReviewer";
import { autoApproveFor } from "../domain/autoApprove";
import { getRole, roleOrder, roles } from "../domain/roles";
import type { PitwallSessionType } from "../domain/types";

type ChoiceKey = "agent" | "model" | "role" | "task" | "pair" | "context" | "access";

/** A pair's reviewer, as "<cli>:<rounds>", or "" for none. */
const DEFAULT_PAIR_ROUNDS = 3;
const pairLabel = (value: string) => {
  const [cli] = value.split(":");
  return cli ? pairReviewerLabel(cli) : "No review";
};

interface ListOption {
  value: string;
  label: string;
  hint?: string;
  status?: string;
  tone?: string;
}

/**
 * Create-session dialog, typed rather than filled in: the instruction first,
 * and every other setting stated as a row of chips beneath it that each open
 * their choices in place. Presentational — all draft state lives in the parent
 * and flows through props/callbacks.
 */
export function CreateSessionModal({
  open,
  agentOptions,
  agentChecks,
  checkingAgents,
  draftAgent,
  draftModels,
  draftModel,
  draftTaskId,
  draftInstruction,
  draftSessionType,
  draftBootCommand,
  draftAutoApprove,
  modelSource,
  modelError,
  modelsLoading,
  createDisabled,
  creating = false,
  projectTasks,
  contextEntries,
  selectedContextIds,
  onSelectAgent,
  onRemoveCustomAgent,
  onAddAgent,
  onTaskChange,
  onInstructionChange,
  onRoleChange,
  onAutoApproveChange,
  draftPair = "",
  onPairChange,
  pairRounds = DEFAULT_PAIR_ROUNDS,
  onCouncil,
  onCompare,
  onModelChange,
  onRefreshModels,
  onToggleContext,
  onCreate,
  onClose,
}: {
  open: boolean;
  agentOptions: AgentOption[];
  agentChecks: Partial<Record<string, { status: string; message?: string }>>;
  checkingAgents: boolean;
  draftAgent: AgentProvider;
  draftModels: ModelOption[];
  draftModel: string;
  draftTaskId: string;
  /** What the agent is asked to do; blank starts it with only its role (and task, if one is picked). */
  draftInstruction: string;
  draftSessionType: PitwallSessionType;
  draftBootCommand: string;
  /** Launch this session in its CLI's own no-prompts mode. */
  draftAutoApprove: boolean;
  modelSource?: string;
  modelError?: string;
  modelsLoading: boolean;
  createDisabled: boolean;
  /**
   * A session takes a real amount of time to make — a worktree, a branch, a
   * PTY and a CLI booting into it, twenty seconds on a large repository. With
   * no sign of it the button looked broken and got pressed again.
   */
  creating?: boolean;
  projectTasks: Array<{ id: string; title: string }>;
  contextEntries: Array<{ id: string; title: string; category: string }>;
  selectedContextIds: string[];
  onSelectAgent: (agent: AgentProvider) => void;
  onRemoveCustomAgent: (id: string, name: string) => void;
  onAddAgent: () => void;
  onTaskChange: (id: string) => void;
  onInstructionChange: (instruction: string) => void;
  onRoleChange: (type: PitwallSessionType) => void;
  onAutoApproveChange: (on: boolean) => void;
  /** A reviewer agent paired with this session's implementer, as "<cli>:<rounds>". */
  draftPair?: string;
  onPairChange?: (value: string) => void;
  /** How many times a reviewer may send the work back. */
  pairRounds?: number;
  /** More than one agent on the work: offered beside the reviewers. */
  onCouncil?: () => void;
  onCompare?: () => void;
  onModelChange: (label: string) => void;
  onRefreshModels: () => void;
  onToggleContext: (id: string, checked: boolean) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose);
  // Hooks stay above the early return: a changing hook count between the
  // closed and open renders tears the tree down.
  const [openKey, setOpenKey] = useState<ChoiceKey | null>(null);
  const [detailKey, setDetailKey] = useState<ChoiceKey | null>(null);
  const idBase = useId();
  const choiceRefs = useRef<Partial<Record<ChoiceKey, HTMLButtonElement | null>>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setOpenKey(null);
      setDetailKey(null);
    }
  }, [open]);

  useEffect(() => {
    if (!openKey) return;
    const list = listRef.current;
    (list?.querySelector<HTMLElement>('[role="option"][tabindex="0"]') ?? list?.querySelector<HTMLElement>('[role="option"]'))?.focus();
  }, [openKey]);

  if (!open) return null;

  /* Resolved from the command the session will actually be launched with, not
     from the agent's display name: a custom agent that wraps `codex` gets the
     same mode as Codex, and one that wraps something unverified gets none. */
  const autoApproveMode = autoApproveFor(
    agentOptions.find((option) => option.agent === draftAgent)?.command,
  );

  /* Only agents a session could actually start with. A missing check is not a
     negative answer, and a list emptied by the filter falls back to the full
     one, because an empty picker says less than one that shows what is wrong. */
  const startable = (() => {
    const usable = agentOptions.filter(
      (option) => option.custom || option.local || agentChecks[option.agent]?.status !== "missing",
    );
    return usable.length ? usable : agentOptions;
  })();

  // Reviewers a pair can use: the CLIs with a read-only review mode.
  // Reviewers are not all implementers (Hermes only reviews), so they are
  // read from what is installed rather than from the agent list.
  const pairReviewers = PAIR_REVIEWERS.filter((cli) => agentChecks[pairReviewerLabel(cli)]?.status !== "missing");

  const agentState = (provider: AgentOption) => {
    const check = agentChecks[provider.agent];
    const status = provider.custom ? "custom" : check?.status ?? "unknown";
    const tone = provider.local
      ? "ready"
      : provider.custom
        ? "custom"
        : status === "ready"
          ? "ready"
          : status === "missing" || status === "needs-login"
            ? "warn"
            : "unknown";
    const text = provider.local
      ? "local"
      : provider.custom
        ? "custom agent"
        : checkingAgents
          ? "checking…"
          : check?.message ?? "check pending";
    return { tone, text };
  };

  const draftProvider = agentOptions.find((option) => option.agent === draftAgent);
  const draftState = draftProvider ? agentState(draftProvider) : null;
  const taskTitle = projectTasks?.find((task) => task.id === draftTaskId)?.title;
  const selectedContext = (contextEntries ?? []).filter((entry) => selectedContextIds?.includes(entry.id));
  const modelNote = modelError || (modelSource ? `Discovered from ${modelSource}` : "Discovering models from the installed CLI");

  const choices: Array<{ key: ChoiceKey; label: string; value: string; toggle?: boolean }> = [
    { key: "agent", label: "Agent", value: String(draftAgent) },
    { key: "model", label: "Model", value: draftModel || "Auto" },
    { key: "role", label: "Role", value: getRole(draftSessionType)?.label ?? "Agent" },
    ...(projectTasks?.length ? [{ key: "task" as const, label: "Task", value: taskTitle ?? "None" }] : []),
    // A pair reviews a task's change, so it is offered once there is a task.
    ...(draftTaskId && onPairChange && pairReviewers.length
      ? [{ key: "pair" as const, label: "Reviewer", value: pairLabel(draftPair) }]
      : []),
    ...(contextEntries?.length
      ? [{
        key: "context" as const,
        label: "Context",
        value: selectedContext.length ? `${selectedContext.length} of ${contextEntries.length}` : "None",
      }]
      : []),
    ...(autoApproveMode
      ? [{ key: "access" as const, label: "Access", value: draftAutoApprove ? "Full" : "Ask first", toggle: true }]
      : []),
  ];

  const lists: Partial<Record<ChoiceKey, { options: ListOption[]; selected: string[]; multi?: boolean; pick: (value: string) => void }>> = {
    agent: {
      options: startable.map((provider) => {
        const state = agentState(provider);
        return { value: String(provider.agent), label: String(provider.agent), hint: provider.command, status: state.text, tone: state.tone };
      }),
      selected: [String(draftAgent)],
      pick: (value) => onSelectAgent(value as AgentProvider),
    },
    model: {
      options: draftModels.map((model) => ({ value: model.label, label: model.label })),
      selected: [draftModel],
      pick: onModelChange,
    },
    role: {
      options: roleOrder.map((type) => ({ value: type, label: roles[type].label, hint: roles[type].summary })),
      selected: [draftSessionType],
      pick: (value) => onRoleChange(value as PitwallSessionType),
    },
    task: {
      options: [{ value: "", label: "No task" }, ...(projectTasks ?? []).map((task) => ({ value: task.id, label: task.title }))],
      selected: [draftTaskId],
      pick: onTaskChange,
    },
    pair: {
      options: [
        { value: "", label: "No review", hint: "The work comes straight to you" },
        ...pairReviewers.map((cli) => ({
          value: `${cli}:${pairRounds}`,
          label: pairReviewerLabel(cli),
          hint: `Reads the change and can send it back, up to ${pairRounds} times`,
        })),
      ],
      selected: [draftPair ? `${draftPair.split(":")[0]}:${pairRounds}` : ""],
      pick: (value) => onPairChange?.(value),
    },
    context: {
      options: (contextEntries ?? []).map((entry) => ({ value: entry.id, label: entry.title, hint: entry.category })),
      selected: selectedContextIds ?? [],
      multi: true,
      pick: (value) => onToggleContext(value, !(selectedContextIds ?? []).includes(value)),
    },
  };

  const detailFor = (key: ChoiceKey | null) => {
    if (key === "agent" && draftState) return draftState.text;
    if (key === "model") return modelNote;
    if (key === "role") return getRole(draftSessionType)?.summary;
    if (key === "pair") {
      const [cli, rounds] = draftPair.split(":");
      return cli
        ? `When the implementer finishes, ${pairReviewerLabel(cli)} reviews the change read-only and sends it back if something needs fixing — up to ${rounds} rounds — before it reaches your Review queue.`
        : "Pair a reviewer agent: it checks the work before you do.";
    }
    if (key === "context") return selectedContext.map((entry) => entry.title).join(", ") || "No notes go with this session";
    if (key === "access" && autoApproveMode) return autoApproveMode.label;
    return "";
  };
  const warning = modelError || (createDisabled && draftState ? `${String(draftAgent)}: ${draftState.text}` : "");
  const detail = detailFor(openKey ?? detailKey) || warning;
  const detailWarns = Boolean(detail) && detail === warning;

  const create = () => {
    if (createDisabled || creating) return;
    onCreate();
  };

  const focusChoice = (key: ChoiceKey | undefined) => {
    if (key) choiceRefs.current[key]?.focus();
  };

  const closeList = () => {
    const key = openKey;
    setOpenKey(null);
    if (key) focusChoice(key);
  };

  const onDialogKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      create();
    } else if (event.key === "Escape" && openKey) {
      // Handled before the dialog's own Escape, which would close the dialog.
      event.preventDefault();
      closeList();
    }
  };

  const onChoiceKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const choice = choices[index];
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = (index + (event.key === "ArrowRight" ? 1 : -1) + choices.length) % choices.length;
      focusChoice(choices[next].key);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      inputRef.current?.focus();
    } else if (event.key === "ArrowDown" && !choice.toggle) {
      event.preventDefault();
      setOpenKey(choice.key);
    }
  };

  const activeList = openKey ? lists[openKey] : undefined;
  const activeIndex = activeList
    ? Math.max(0, activeList.options.findIndex((option) => activeList.selected.includes(option.value)))
    : 0;

  const onOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const options = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]:not(:disabled)') ?? []);
    const at = options.indexOf(event.currentTarget);
    const go = (index: number) => {
      event.preventDefault();
      options[(index + options.length) % options.length]?.focus();
    };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(options.length - 1);
  };

  const choose = (value: string) => {
    if (!activeList) return;
    activeList.pick(value);
    if (!activeList.multi) closeList();
  };

  const command = draftAutoApprove && autoApproveMode ? autoApproveMode.args.join(" ") : "";

  return (
    <div className="dk-backdrop" onClick={creating ? undefined : onClose}>
      <div
        ref={dialogRef}
        className="dk-dialog dk-new-session"
        role="dialog"
        aria-modal="true"
        aria-label="New work"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onDialogKeyDown}
      >
        <h2 className="sr-only">New work</h2>
        <div className="dk-new-session-top">
          <textarea
            ref={inputRef}
            className="dk-new-session-input"
            data-dialog-autofocus
            rows={3}
            value={draftInstruction}
            placeholder={draftTaskId ? "Anything to add to the task?" : "What should the agent do?"}
            aria-label="Instruction"
            spellCheck={false}
            autoComplete="off"
            readOnly={creating}
            onChange={(event) => onInstructionChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                create();
              } else if (event.key === "ArrowDown" && event.currentTarget.selectionStart === event.currentTarget.value.length) {
                event.preventDefault();
                focusChoice(choices[0]?.key);
              }
            }}
          />

          <div className="dk-new-session-chips" role="group" aria-label="Session options">
            {choices.map((choice, index) => {
              const valueId = `${idBase}-${choice.key}`;
              const on = openKey === choice.key || (choice.key === "access" && draftAutoApprove);
              return (
                <button
                  type="button"
                  key={choice.key}
                  ref={(element) => {
                    choiceRefs.current[choice.key] = element;
                  }}
                  className={`dk-chip dk-new-session-chip${on ? " is-on" : ""}`}
                  aria-label={choice.label}
                  aria-describedby={valueId}
                  {...(choice.toggle
                    ? { "aria-pressed": draftAutoApprove }
                    : { "aria-haspopup": "listbox" as const, "aria-expanded": openKey === choice.key })}
                  disabled={creating}
                  onClick={() => {
                    if (choice.toggle) onAutoApproveChange(!draftAutoApprove);
                    else setOpenKey((current) => (current === choice.key ? null : choice.key));
                  }}
                  onKeyDown={(event) => onChoiceKeyDown(event, index)}
                  onFocus={() => setDetailKey(choice.key)}
                  onBlur={() => setDetailKey((current) => (current === choice.key ? null : current))}
                  onMouseEnter={() => setDetailKey(choice.key)}
                  onMouseLeave={() => setDetailKey((current) => (current === choice.key ? null : current))}
                >
                  <span className="dk-new-session-key">{choice.label}</span>
                  <span id={valueId} className="dk-new-session-value">
                    {choice.value}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="dk-new-session-command">
            Runs{" "}
            <code className="dk-mono">
              {draftBootCommand}
              {command ? <em> {command}</em> : null}
            </code>
          </p>
        </div>

        {openKey && activeList ? (
          <div className="dk-new-session-list" ref={listRef}>
            <div
              role="listbox"
              aria-label={choices.find((choice) => choice.key === openKey)?.label}
              aria-multiselectable={activeList.multi || undefined}
            >
              {activeList.options.map((option, index) => {
                const selected = activeList.selected.includes(option.value);
                return (
                  <button
                    type="button"
                    role="option"
                    key={option.value}
                    aria-selected={selected}
                    tabIndex={index === activeIndex ? 0 : -1}
                    className={`dk-new-session-option${selected ? " is-selected" : ""}`}
                    onClick={() => choose(option.value)}
                    onKeyDown={onOptionKeyDown}
                  >
                    {openKey === "agent" ? (
                      <span className="dk-new-session-tile" aria-hidden="true">{option.label.charAt(0).toUpperCase()}</span>
                    ) : (
                      <span className="dk-new-session-mark" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
                    )}
                    <span className="dk-new-session-label">{option.label}</span>
                    {option.hint ? <span className="dk-new-session-hint">{option.hint}</span> : null}
                    {option.status ? (
                      <span className="dk-new-session-status" data-tone={option.tone}>{option.status}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {openKey === "agent" ? (
              <div className="dk-new-session-actions">
                <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={onAddAgent}>
                  Add agent
                </button>
                {startable
                  .filter((provider) => provider.custom && !provider.local && provider.id)
                  .map((provider) => (
                    <button
                      type="button"
                      key={provider.id}
                      className="dk-btn dk-btn--ghost dk-btn--sm"
                      onClick={() => onRemoveCustomAgent(provider.id as string, String(provider.agent))}
                    >
                      Remove {String(provider.agent)}
                    </button>
                  ))}
              </div>
            ) : null}
            {openKey === "pair" && (onCouncil || onCompare) ? (
              <div className="dk-new-session-actions">
                {onCouncil ? <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={onCouncil}>Council…</button> : null}
                {onCompare ? <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={onCompare}>Compare…</button> : null}
              </div>
            ) : null}
            {openKey === "model" ? (
              <div className="dk-new-session-actions">
                <button
                  type="button"
                  className="dk-btn dk-btn--ghost dk-btn--sm"
                  disabled={modelsLoading}
                  onClick={onRefreshModels}
                  title="Refresh models from installed provider CLIs"
                >
                  {modelsLoading ? "Discovering" : "Refresh"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <footer className="dk-dialog-footer">
          <p className={`dk-hint dk-new-session-detail${detailWarns ? " is-warn" : ""}`}>
            {detail || "Enter to start · Shift+Enter for a new line · Tab for options"}
          </p>
          <button type="button" className="dk-btn dk-btn--ghost" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button type="button" className="dk-btn dk-btn--primary" disabled={createDisabled || creating} onClick={create}>
            {creating ? "Starting…" : "Start"}
          </button>
        </footer>
      </div>
    </div>
  );
}

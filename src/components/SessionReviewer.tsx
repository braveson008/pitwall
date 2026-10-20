import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { PairReviewer } from "../domain/pairReviewer";
import { Dropdown } from "./Dropdown";

type ModelOption = { value: string; label: string };

/** A picked option, as the pair stores it: which CLI reviews, and on which model. */
export function reviewerChoice(value: string): { reviewer: PairReviewer; model: string } {
  if (value === "hermes") return { reviewer: "hermes", model: "" };
  if (value.startsWith("codex:")) return { reviewer: "codex", model: value.slice("codex:".length) };
  return { reviewer: "claude", model: value };
}

/**
 * A reviewer for a session already under way. Closed it says whether there is
 * one; open it picks who reviews, how many rounds it may send the work back,
 * and whether it reads what is there now or waits for the agent's next turn.
 */
export function SessionReviewer({
  current,
  options,
  onAttach,
  onRemove,
}: {
  /** "Codex", "Hermes"… when the session already has a reviewer. */
  current: string | null;
  /** Claude's and Codex's models, as the automation pickers list them. */
  options: ModelOption[];
  onAttach: (choice: { reviewer: PairReviewer; model: string; rounds: number; now: boolean }) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const choices = [...options, { value: "hermes", label: "Hermes · the project's model" }];
  const [value, setValue] = useState(options.find((option) => option.value === "sonnet")?.value ?? choices[0]?.value ?? "hermes");
  const [rounds, setRounds] = useState("3");

  if (!open) {
    return (
      <button
        type="button"
        className="dk-btn dk-btn--ghost dk-btn--sm dk-session-swap-chip"
        onClick={() => setOpen(true)}
        title={current ? "Change or remove this session's reviewer" : "Have another agent review this session's work"}
      >
        <ShieldCheck size={13} aria-hidden="true" />
        {current ? `Reviewer · ${current}` : "Add reviewer"}
      </button>
    );
  }

  const attach = (now: boolean) => {
    onAttach({ ...reviewerChoice(value), rounds: Number(rounds) || 3, now });
    setOpen(false);
  };

  return (
    <div className="dk-session-swap" role="group" aria-label="Reviewer">
      <span className="dk-session-swap-lede">Review with</span>
      <Dropdown className="dk-dropdown--chip" value={value} ariaLabel="Reviewer agent and model" options={choices} onChange={setValue} />
      <Dropdown
        className="dk-dropdown--chip"
        value={rounds}
        ariaLabel="Rounds the reviewer may send the work back"
        options={["1", "2", "3"].map((count) => ({ value: count, label: count === "1" ? "1 round" : `${count} rounds` }))}
        onChange={setRounds}
      />
      <button type="button" className="dk-btn dk-btn--primary dk-btn--sm" onClick={() => attach(true)} title="Review what is in the worktree now">
        Review now
      </button>
      <button type="button" className="dk-btn dk-btn--sm" onClick={() => attach(false)} title="Review when the agent next finishes a turn">
        After next turn
      </button>
      {current ? (
        <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => { onRemove(); setOpen(false); }}>
          Remove
        </button>
      ) : null}
      <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

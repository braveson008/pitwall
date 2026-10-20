import { ArrowLeftRight } from "lucide-react";
import { useState } from "react";
import type { AgentProvider } from "../data";
import { Dropdown } from "./Dropdown";
import type { SwapOption } from "./CouncilGrid";

/**
 * The session's agent, and the way to hand the session to another one.
 *
 * Closed it is a chip saying who is driving; open it asks who next. A swap
 * while the agent is mid-turn interrupts it, so the button says so.
 */
export function SessionSwap({
  agent,
  model,
  options,
  busy,
  onSwap,
}: {
  agent: string;
  model: string;
  options: SwapOption[];
  /** True while the agent is working: swapping now interrupts it. */
  busy: boolean;
  onSwap: (agent: AgentProvider, model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const first = options.find((option) => option.agent !== agent) ?? options[0];
  const [nextAgent, setNextAgent] = useState<string>(first?.agent ?? "");
  const [nextModel, setNextModel] = useState<string>(first?.models[0] ?? "");
  const models = options.find((option) => option.agent === nextAgent)?.models ?? ["Auto"];
  const same = nextAgent === agent && nextModel === model;

  if (!open) {
    return (
      <button
        type="button"
        className="dk-btn dk-btn--ghost dk-btn--sm dk-session-swap-chip"
        onClick={() => {
          const pick = options.find((option) => option.agent !== agent) ?? options[0];
          setNextAgent(pick?.agent ?? "");
          setNextModel(pick?.models[0] ?? "");
          setOpen(true);
        }}
        title="Hand this session to another agent"
        aria-label={`${agent}${model ? `, ${model}` : ""}. Swap agent`}
      >
        <ArrowLeftRight size={13} aria-hidden="true" />
        {agent}{model ? ` · ${model}` : ""}
      </button>
    );
  }

  return (
    <div className="dk-session-swap" role="group" aria-label="Swap agent">
      <span className="dk-session-swap-lede">Hand to</span>
      <Dropdown
        className="dk-dropdown--chip"
        value={nextAgent}
        ariaLabel="Agent to hand the session to"
        options={options.map((option) => ({ value: option.agent, label: option.label }))}
        onChange={(value) => {
          setNextAgent(value);
          setNextModel(options.find((option) => option.agent === value)?.models[0] ?? "");
        }}
      />
      <Dropdown
        className="dk-dropdown--chip"
        value={nextModel}
        ariaLabel="Model for the agent taking over"
        options={models.map((item) => ({ value: item, label: item }))}
        onChange={setNextModel}
      />
      <button
        type="button"
        className="dk-btn dk-btn--primary dk-btn--sm"
        disabled={!nextAgent || same}
        title={busy ? `${agent} is working; it will be stopped mid-turn` : undefined}
        onClick={() => {
          onSwap(nextAgent as AgentProvider, nextModel);
          setOpen(false);
        }}
      >
        {busy ? "Interrupt and swap" : "Swap"}
      </button>
      <button type="button" className="dk-btn dk-btn--ghost dk-btn--sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

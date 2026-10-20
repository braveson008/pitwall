import { useModalFocus } from "../hooks/useModalFocus";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

export interface AddAgentInput {
  name: string;
  command: string;
  args: string;
  models: string;
  modelDiscoveryCommand: string;
  login: string;
}

/**
 * Form for registering a user-defined agent. Owns its own field state and hands
 * a plain input object back to the parent on save.
 */
export function AddAgentModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (input: AddAgentInput) => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [models, setModels] = useState("");
  const [modelDiscoveryCommand, setModelDiscoveryCommand] = useState("");
  const [login, setLogin] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setCommand("");
      setArgs("");
      setModels("");
      setModelDiscoveryCommand("");
      setLogin("");
    }
  }, [open]);

  const dialogRef = useModalFocus<HTMLDivElement>(open, onClose);
  if (!open) return null;

  return (
    <div className="dk-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="dk-dialog" role="dialog" aria-modal="true" aria-label="Add custom agent" onClick={(event) => event.stopPropagation()}>
        <div className="dk-dialog-header">
          <div>
            <h2 className="dk-dialog-title">Add an agent</h2>
            <p className="dk-dialog-desc">
              Pitwall launches your CLI directly — point it at any coding-agent command installed on your machine.
            </p>
          </div>
          <button type="button" className="dk-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dk-dialog-body">
          <div className="dk-field-row">
            <label className="dk-field">
              <span className="dk-label">Name</span>
              <input className="dk-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Aider" />
            </label>
            <label className="dk-field">
              <span className="dk-label">Command</span>
              <input className="dk-input dk-mono" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="aider" />
            </label>
          </div>

          <label className="dk-field">
            <span className="dk-label">Extra arguments · optional</span>
            <input className="dk-input dk-mono" value={args} onChange={(event) => setArgs(event.target.value)} placeholder="--no-auto-commits" />
          </label>

          <label className="dk-field">
            <span className="dk-label">Model discovery arguments · optional</span>
            <input
              className="dk-input dk-mono"
              value={modelDiscoveryCommand}
              onChange={(event) => setModelDiscoveryCommand(event.target.value)}
              placeholder="models --json"
            />
            <span className="dk-hint">
              Pitwall detects common model-list commands automatically. Set only the arguments when this CLI uses a custom command.
            </span>
          </label>

          <label className="dk-field">
            <span className="dk-label">Fallback models · one per line, optional</span>
            <textarea className="dk-textarea" value={models} onChange={(event) => setModels(event.target.value)} placeholder={"qwen2.5-coder\ndeepseek-r1"} />
          </label>

          <label className="dk-field">
            <span className="dk-label">Login command · optional</span>
            <input className="dk-input dk-mono" value={login} onChange={(event) => setLogin(event.target.value)} placeholder="aider --login" />
          </label>
        </div>

        <div className="dk-dialog-footer">
          <button type="button" className="dk-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="dk-btn dk-btn--primary"
            onClick={() => onSave({ name, command, args, models, modelDiscoveryCommand, login })}
            disabled={!name.trim() || !command.trim()}
          >
            <Plus size={15} />
            Add agent
          </button>
        </div>
      </div>
    </div>
  );
}

import type { PitwallActivityEvent, PitwallProjectOverseer, PitwallTask } from "../domain/types";
import { Dropdown } from "./Dropdown";
import type { ReviewerScorecard, ScoreLine } from "../lib/reviewerScorecard";

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

/** One model's record as a sentence: what a person would want to know first. */
function recordLine(line: ScoreLine) {
  const parts = [`agreed with you ${line.agreed} of ${line.decided} times (${pct(line.agreed, line.decided)})`];
  if (line.missed) parts.push(`missed ${line.missed}`);
  if (line.stricter) parts.push(`stricter than you ${line.stricter}`);
  return parts.join(" · ");
}

export type HermesState =
  | { kind: "not-set-up"; installed: boolean }
  | { kind: "signed-out" }
  | { kind: "reviewing"; tasks: PitwallTask[] }
  | { kind: "learning"; keys: string[] }
  | { kind: "off" }
  | { kind: "ready" };

/** One line for the foot of the sidebar. */
export function hermesStatusLine(state: HermesState): { label: string; tone: "working" | "attention" | "quiet" } {
  switch (state.kind) {
    case "not-set-up": return { label: "Hermes · not set up", tone: "quiet" };
    case "signed-out": return { label: "Hermes · signed out", tone: "attention" };
    case "reviewing": {
      const first = state.tasks[0];
      const more = state.tasks.length > 1 ? ` +${state.tasks.length - 1}` : "";
      return { label: `Hermes · reviewing ${(first.identifier || first.title).toUpperCase()}${more}`, tone: "working" };
    }
    case "learning": return { label: `Hermes · learning from ${state.keys[0]}${state.keys.length > 1 ? ` +${state.keys.length - 1}` : ""}`, tone: "working" };
    case "off": return { label: "Hermes · off for this project", tone: "quiet" };
    default: return { label: "Hermes · ready", tone: "quiet" };
  }
}

/** The sentence under the status: what Hermes is doing, or why it is not. */
export function hermesStatusDetail(state: HermesState, projectName: string): string {
  switch (state.kind) {
    case "not-set-up": return state.installed
      ? "Hermes is installed but not signed in, so finished work comes straight to you without a review."
      : "Hermes is not installed, so finished work comes straight to you without a review.";
    case "signed-out": return "Hermes lost its sign-in to Nous. Sign in once and every project reconnects.";
    case "reviewing": return "Reading finished work before it reaches you. Open the task's Reviewer tab to watch.";
    case "learning": return "Studying what just happened, in the background, to review this project better.";
    case "off": return `Switched off for ${projectName}: its finished work comes straight to you.`;
    default: return "Waiting for finished work to review, and learning from what you decide.";
  }
}

const ago = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

const key = (task: PitwallTask) => (task.identifier || task.title).toUpperCase();

/**
 * Everything Hermes is and has been doing, in one place: whether it can work,
 * what it is on now, the reviews it has given and what it has learned.
 */
export function HermesPanel({
  state,
  projectName,
  overseer,
  models,
  reviews,
  learned,
  scorecard,
  onToggle,
  onModel,
  onSignIn,
  onSetUp,
  onOpenReview,
  onOpenMemory,
}: {
  state: HermesState;
  projectName: string;
  overseer: PitwallProjectOverseer;
  models: Array<{ value: string; label: string }>;
  /** Tasks Hermes reviewed, newest first. */
  reviews: PitwallTask[];
  /** "Hermes learned …" activity, newest first. */
  learned: PitwallActivityEvent[];
  /** How its verdicts compared with your decisions in this project. */
  scorecard: ReviewerScorecard;
  onToggle: (enabled: boolean) => void;
  onModel: (model: string) => void;
  onSignIn: () => void;
  onSetUp: () => void;
  onOpenReview: (task: PitwallTask) => void;
  onOpenMemory: () => void;
}) {
  const line = hermesStatusLine(state);
  return (
    <div className="dk-hermes">
      <section className="dk-hermes-status" aria-label="Status">
        <span className={`dk-seal is-${line.tone}`} aria-hidden="true">R</span>
        <div>
          <strong>{line.label.replace(/^Hermes · /, "").replace(/^./, (c) => c.toUpperCase())}</strong>
          <p>{hermesStatusDetail(state, projectName)}</p>
        </div>
        {state.kind === "signed-out" ? <button type="button" className="dk-btn dk-btn--primary dk-btn--sm" onClick={onSignIn}>Sign in to Hermes</button> : null}
        {state.kind === "not-set-up" ? <button type="button" className="dk-btn dk-btn--sm" onClick={onSetUp}>Set up</button> : null}
      </section>

      {state.kind !== "not-set-up" ? (
        <section className="dk-hermes-project" aria-label={`Hermes in ${projectName}`}>
          <span className="dk-hermes-label">In {projectName}</span>
          <div className="dk-segmented" role="group" aria-label="Hermes in this project">
            <button type="button" className={overseer.enabled ? "is-current" : undefined} aria-pressed={overseer.enabled} onClick={() => onToggle(true)}>On</button>
            <button type="button" className={overseer.enabled ? undefined : "is-current"} aria-pressed={!overseer.enabled} onClick={() => onToggle(false)}>Off</button>
          </div>
          {overseer.enabled ? (
            <Dropdown
              className="dk-dropdown--chip"
              ariaLabel="Hermes's model"
              value={overseer.model}
              options={models.length ? models : [{ value: "auto", label: "Hermes's default" }]}
              onChange={onModel}
            />
          ) : null}
          <span className="dk-hermes-hint">Up to {overseer.rounds} rounds of review</span>
        </section>
      ) : null}

      <section className="dk-hermes-record" aria-labelledby="hermes-record">
        <h3 id="hermes-record">Track record in {projectName}</h3>
        {scorecard.decided === 0 ? (
          <p className="dk-hint">
            {scorecard.reviewed
              ? `${scorecard.reviewed} reviewed so far. Once you approve or send back work Hermes reviewed, this shows how often it agreed with you.`
              : "Nothing reviewed yet. Once you decide on work Hermes reviewed, this shows how often it agreed with you."}
          </p>
        ) : (
          <>
            <dl className="dk-hermes-figures">
              <div><dt>Agreed with you</dt><dd>{pct(scorecard.agreed, scorecard.decided)}</dd></div>
              <div><dt>Missed</dt><dd className={scorecard.missed ? "is-attention" : undefined}>{scorecard.missed}</dd></div>
              <div><dt>Stricter than you</dt><dd>{scorecard.stricter}</dd></div>
              <div><dt>Caught before you</dt><dd>{scorecard.caught}</dd></div>
            </dl>
            <p className="dk-hint">
              Missed: Hermes approved and you sent the work back. Stricter: it held work back that you approved as it was.
              Caught: times it sent work back to the agent before it reached you.
            </p>
            {scorecard.byModel.length > 1 || (scorecard.byModel[0] && scorecard.byModel[0].model !== "default") ? (
              <ul className="dk-hermes-models">
                {scorecard.byModel.map((line) => (
                  <li key={line.model}><span className="dk-mono">{line.model}</span> {recordLine(line)}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <section className="dk-hermes-list" aria-labelledby="hermes-reviews">
        <h3 id="hermes-reviews">Reviews</h3>
        {reviews.length === 0 ? (
          <p className="dk-hint">No reviews yet. When an agent finishes a task, Hermes reads it first.</p>
        ) : reviews.map((task) => (
          <button type="button" key={task.id} className="dk-hermes-row" onClick={() => onOpenReview(task)}>
            <span className="dk-hermes-row-main">
              <span className="dk-hermes-row-title">{task.title}</span>
              <span className={`dk-hermes-row-meta${task.pair?.state === "open-points" ? " is-attention" : task.pair?.state === "approved" ? " is-approved" : ""}`}>
                {key(task)} · {task.pair?.state === "reviewing" ? `reviewing now, round ${task.pair.round} of ${task.pair.maxRounds}` : task.pair?.outcome || "Reviewed"}
              </span>
            </span>
            <span className="dk-hermes-when">{ago(task.updatedAt)}</span>
          </button>
        ))}
      </section>

      <section className="dk-hermes-list" aria-labelledby="hermes-learned">
        <div className="dk-hermes-list-head">
          <h3 id="hermes-learned">Learned</h3>
          <button type="button" className="dk-link" onClick={onOpenMemory}>Open Memory</button>
        </div>
        {learned.length === 0 ? (
          <p className="dk-hint">Nothing yet. Hermes learns after a task finishes and after you decide on it; what it learns waits in Memory for you to keep or reject.</p>
        ) : learned.map((event) => (
          <div key={event.id} className="dk-hermes-row is-static">
            <span className="dk-hermes-row-main">
              <span className="dk-hermes-row-title">{event.message.replace(/^Hermes learned /, "Learned ")}</span>
            </span>
            <span className="dk-hermes-when">{ago(event.createdAt)}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

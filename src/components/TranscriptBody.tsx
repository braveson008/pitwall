import { memo, useMemo, useState } from "react";
import { Brain, CheckCheck, ChevronRight, CircleAlert, Clock, ExternalLink, Info, MessageCircleQuestion, Terminal, TriangleAlert } from "lucide-react";
import type { TranscriptEntry } from "../lib/agentStream";
import { extractAgentMarkers } from "../lib/agentMarkers";
import { parseBlocks, type Block, type Inline } from "../lib/markdown";
import { describeToolGroup, groupIntoTurns, summariseTool, type TranscriptGroup } from "../lib/toolSummary";

/** Bold, code and links, rendered rather than left as their markup. */
function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.kind === "bold") return <strong key={index}>{inline.text}</strong>;
        if (inline.kind === "code") return <code key={index}>{inline.text}</code>;
        if (inline.kind === "link") {
          return (
            <a
              key={index}
              href={inline.href}
              onClick={(event) => {
                // Terminal output is untrusted text — an agent can print any
                // URL — so this goes through the same bridge as everything else,
                // which refuses anything that is not HTTP(S).
                event.preventDefault();
                void window.pitwall?.openExternalUrl?.(inline.href);
              }}
            >
              {inline.text}
            </a>
          );
        }
        if (inline.kind === "image") {
          // Same bridge as a link, and named rather than shown: an image in a
          // transcript is a reference, and its URL is rarely readable.
          return (
            <a
              key={index}
              href={inline.href}
              onClick={(event) => {
                event.preventDefault();
                void window.pitwall?.openExternalUrl?.(inline.href);
              }}
            >
              {inline.alt || "image"}
            </a>
          );
        }
        return <span key={index}>{inline.text}</span>;
      })}
    </>
  );
}

/**
 * Memoised on its text, because the same text parses to the same blocks.
 *
 * A transcript renders every message it holds, and this used to re-parse all of
 * them on every render — of which there are many: any state change anywhere in
 * the app re-rendered the whole conversation.
 */
const Blocks = memo(function Blocks({ source }: { source: string }) {
  const blocks: Block[] = useMemo(() => parseBlocks(source), [source]);
  return (
    <div className="dk-md">
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return (
            <pre className="dk-md-code" key={index}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index}>
              {block.items.map((item, position) => (
                <li key={position}>
                  <Inlines inlines={item} />
                </li>
              ))}
            </List>
          );
        }
        if (block.kind === "rule") return <hr className="dk-md-rule" key={index} />;
        if (block.kind === "quote") {
          return (
            <blockquote className="dk-md-quote" key={index}>
              <Inlines inlines={block.inlines} />
            </blockquote>
          );
        }
        return (
          <p key={index}>
            <Inlines inlines={block.inlines} />
          </p>
        );
      })}
    </div>
  );
});

/**
 * A run of tool calls, folded.
 *
 * Open by default only when something in it failed or is still running: those
 * are the cases a reader needs without asking. Everything else is work they can
 * take on trust until they want it, which is what keeps prose next to prose.
 */
function ToolGroup({ group, cwd }: { group: Extract<TranscriptGroup, { kind: "tools" }>; cwd?: string }) {
  const [open, setOpen] = useState(group.failed > 0);
  return (
    <div className="dk-tool-card">
      <div className={`dk-tool-row${open ? " is-open" : ""}`}>
        <button type="button" className="dk-tool-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
          <ChevronRight size={14} className={open ? "is-open" : ""} aria-hidden="true" />
          <span className="dk-tool-label">{describeToolGroup(group)}</span>
          <span className="dk-spacer" />
          {group.running ? <span className="dk-badge dk-badge--green">Running</span> : null}
          {group.failed ? (
            <span className="dk-badge dk-badge--red">
              <TriangleAlert size={11} aria-hidden="true" />
              {group.failed} failed
            </span>
          ) : null}
        </button>
        {open ? (
          <ol className="dk-tool-list">
            {group.tools.map((tool) => {
              const summary = summariseTool(tool.name, tool.input, cwd);
              return (
                <li className={tool.state === "error" ? "is-failed" : undefined} key={tool.id}>
                  {/* The group header already names a lone call; repeating it
                      inside reads as "Bash Bash". */}
                  {group.tools.length > 1 ? <span className="dk-tool-name">{tool.name}</span> : null}
                  {summary.detail ? <code className="dk-mono">{summary.detail}</code> : null}
                  {tool.result ? <pre className="dk-tool-result">{tool.result}</pre> : null}
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

function QuestionEntry({
  entry,
  onAnswerInTerminal,
}: {
  entry: Extract<TranscriptEntry, { kind: "question" }>;
  onAnswerInTerminal?: () => void;
}) {
  const answered = entry.state !== "running";
  return (
    <div className={`dk-card dk-card--pad dk-question${answered ? " is-answered" : ""}`}>
      <div className="dk-question-head">
        <MessageCircleQuestion size={14} aria-hidden="true" />
        <strong>{answered ? "Answered" : "Waiting on you"}</strong>
        {!answered && onAnswerInTerminal && (
          <button type="button" className="dk-btn dk-btn--sm" onClick={onAnswerInTerminal}>
            <Terminal size={12} aria-hidden="true" />
            Terminal
          </button>
        )}
      </div>
      {entry.questions.map((question, index) => (
        <div className="dk-question-body" key={`${entry.id}:${index}`}>
          {question.header ? <span className="dk-badge">{question.header}</span> : null}
          <p>{question.question}</p>
          <ol>
            {question.options.map((option) => (
              <li key={option.label}>
                <strong>{option.label}</strong>
                {option.description ? <span>{option.description}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Entry({
  entry,
  cwd,
  onAnswerInTerminal,
}: {
  entry: TranscriptEntry;
  cwd?: string;
  onAnswerInTerminal?: () => void;
}) {
  if (entry.kind === "user" || entry.kind === "text") {
    // The agent addresses two audiences in one message: the reader, and Pitwall.
    // Its protocol lines are lifted out and shown as what they are.
    const { prose, markers } = extractAgentMarkers(entry.text);
    return (
      <>
        {prose ? (
          <div className="dk-transcript-message">
            <Blocks source={prose} />
          </div>
        ) : null}
        {markers.map((marker, index) =>
          marker.kind === "summary" ? (
            <section className="dk-card dk-msg-summary" key={index}>
              <header>
                <CheckCheck size={13} aria-hidden="true" />
                Completion summary
              </header>
              <dl>
                <dt>What changed</dt>
                <dd>{marker.what}</dd>
                <dt>How</dt>
                <dd>{marker.how}</dd>
              </dl>
              {marker.components.length > 0 ? (
                <ul className="dk-msg-components">
                  {marker.components.map((component) => (
                    <li key={component}><code className="dk-mono">{component}</code></li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : (
            <a
              className="dk-chip dk-msg-preview"
              key={index}
              href={marker.url}
              onClick={(event) => {
                event.preventDefault();
                void window.pitwall?.openExternalUrl?.(marker.url);
              }}
            >
              <ExternalLink size={12} aria-hidden="true" />
              <strong>{marker.label}</strong>
              <span className="dk-mono">{marker.url.replace(/^https?:\/\//, "")}</span>
            </a>
          ),
        )}
      </>
    );
  }
  if (entry.kind === "thinking") {
    return (
      <details className="dk-thinking">
        <summary>
          <Brain size={12} aria-hidden="true" />
          Thinking
        </summary>
        <Blocks source={entry.text} />
      </details>
    );
  }
  if (entry.kind === "queued") {
    return (
      <div className="dk-transcript-queued">
        <Clock size={12} aria-hidden="true" />
        <span>{entry.text}</span>
        <span className="dk-badge">Queued</span>
      </div>
    );
  }
  if (entry.kind === "question") return <QuestionEntry entry={entry} onAnswerInTerminal={onAnswerInTerminal} />;
  if (entry.kind === "notice") {
    return (
      <div className={`dk-transcript-notice${entry.tone === "error" ? " dk-error" : ""}`}>
        {entry.tone === "error" ? <CircleAlert size={12} aria-hidden="true" /> : <Info size={12} aria-hidden="true" />}
        {entry.text}
      </div>
    );
  }
  return null;
}

function turnTime(at?: string) {
  if (!at) return "";
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The conversation itself, shared by the live chat and the saved transcript.
 *
 * One renderer for both: a transcript worth reading and a transcript worth
 * reviewing are the same thing, and the saved one used to be raw terminal bytes
 * — spinner frames concatenated into "Skedaddling…Skedaddling…" with the spaces
 * gone. Reading it from the conversation instead of from a screen recording is
 * what makes it legible at all.
 */
/**
 * One turn, memoised.
 *
 * A conversation only ever changes at its end, but the whole transcript was
 * re-rendered whenever anything did — including every frame that carried
 * terminal output, since nothing between here and the app root was memoised. A
 * long session meant thousands of nodes reconciled and every message's markdown
 * re-parsed, sixty times a second. Turns are immutable once complete, so all but
 * the last one can be skipped.
 */
const Turn = memo(function Turn({
  turn,
  cwd,
  onAnswerInTerminal,
}: {
  turn: ReturnType<typeof groupIntoTurns>[number];
  cwd?: string;
  onAnswerInTerminal?: () => void;
}) {
  return (
    <section className={`dk-turn dk-turn--${turn.role}`}>
      <header className="dk-msg-head">
        {turn.role === "you" ? (
          <strong className="sr-only">You</strong>
        ) : (
          <>
            <span className="dk-msg-tile" aria-hidden="true">C</span>
            <strong className="dk-msg-who">Claude</strong>
          </>
        )}
        {turnTime(turn.at) ? <time className="dk-msg-eyebrow">{turnTime(turn.at)}</time> : null}
      </header>
      <div className="dk-turn-body">
        {turn.groups.map((group) =>
          group.kind === "tools" ? (
            <ToolGroup key={group.id} group={group} cwd={cwd} />
          ) : (
            <Entry key={group.id} entry={group.entry} cwd={cwd} onAnswerInTerminal={onAnswerInTerminal} />
          ),
        )}
      </div>
    </section>
  );
});

export function TranscriptBody({
  entries,
  cwd,
  onAnswerInTerminal,
}: {
  entries: TranscriptEntry[];
  cwd?: string;
  onAnswerInTerminal?: () => void;
}) {
  // Grouping walks every entry, so it is done when the entries change rather
  // than on every render.
  const turns = useMemo(() => groupIntoTurns(entries), [entries]);
  return (
    <>
      {turns.map((turn) => (
        <Turn key={turn.id} turn={turn} cwd={cwd} onAnswerInTerminal={onAnswerInTerminal} />
      ))}
    </>
  );
}

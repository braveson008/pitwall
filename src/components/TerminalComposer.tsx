import { useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Loader2 } from "lucide-react";
import {
  EMPTY_COMPOSER_HISTORY,
  composerKeyAction,
  recallSubmission,
  rememberSubmission,
  withImagePaths,
} from "../lib/terminalComposer";

const MAX_HEIGHT = 168;

/**
 * A writing surface for one session, sitting under its terminal.
 *
 * Its state is deliberately local. Panes are mounted per session and stay
 * mounted while another one is on screen, so a draft and its history belong to
 * the instance without App having to hold a map of them keyed by session.
 */
export function TerminalComposer({
  sessionId,
  sessionName,
  agentLabel,
  onSubmit,
  onFocusTerminal,
}: {
  /** Whose staging directory the images go into. */
  sessionId: string;
  sessionName: string;
  /** Kept for callers; the composer is written in the interface face now, like the thread above it. */
  fontFamily?: string;
  /** Who will hear it — "Claude · Opus" — shown beside the send button. */
  agentLabel?: string;
  onSubmit: (text: string) => void;
  onFocusTerminal: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState("");
  const [history, setHistory] = useState(EMPTY_COMPOSER_HISTORY);
  const [attaching, setAttaching] = useState(false);
  const [attachError, setAttachError] = useState("");

  /**
   * Images become paths, because that is how the CLIs take them.
   *
   * The same staging the terminal pane uses: written into this session's own
   * directory, then referenced by path in the message. Nothing is uploaded and
   * nothing is re-encoded — the agent opens the file itself.
   */
  const attachImages = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;

    const api = window.pitwall;
    if (!api?.stageTerminalImages || !api.stageTerminalImageData || !api.getPathForFile) {
      setAttachError("Image attachments are unavailable.");
      return;
    }

    setAttaching(true);
    setAttachError("");
    try {
      // A dropped file has a path on disk; one pasted from the clipboard exists
      // only in memory, so it has to be handed over as bytes.
      const paths: string[] = [];
      const pasted: File[] = [];
      for (const file of images) {
        const filePath = api.getPathForFile(file);
        if (filePath) paths.push(filePath);
        else pasted.push(file);
      }

      const results = [];
      if (paths.length > 0) results.push(await api.stageTerminalImages({ sessionId, paths }));
      if (pasted.length > 0) {
        results.push(
          await api.stageTerminalImageData({
            sessionId,
            images: await Promise.all(
              pasted.map(async (file, index) => ({
                name: file.name || `clipboard-image-${index + 1}`,
                type: file.type,
                data: new Uint8Array(await file.arrayBuffer()),
              })),
            ),
          }),
        );
      }

      const staged = results.flatMap((result) => result.paths || []);
      const failed = results.map((result) => result.error).filter(Boolean);
      if (staged.length > 0) {
        setDraft((current) => withImagePaths(current, staged));
        inputRef.current?.focus();
      }
      if (failed.length > 0) setAttachError(String(failed[0]));
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : "The image could not be attached.");
    } finally {
      setAttaching(false);
    }
  };

  // Grow with the text instead of scrolling a two-line box: the whole point of
  // composing here is being able to see the message you are writing.
  //
  // The borders have to be added back. scrollHeight measures content and
  // padding, while the height being set is a border-box height, so handing it
  // scrollHeight leaves the box short by exactly its two borders — enough to
  // overflow by 2px and park a scrollbar next to every single-line message.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const style = window.getComputedStyle(input);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight + borders, MAX_HEIGHT)}px`;
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSubmit(text);
    setHistory((current) => rememberSubmission(current, text));
    setDraft("");
  };

  return (
    <form
      className="dk-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) return;
        event.preventDefault();
        void attachImages(files);
      }}
    >
      <textarea
        ref={inputRef}
        rows={1}
        className="dk-composer-input"
        value={draft}
        spellCheck={false}
        placeholder={`Write to ${sessionName}…`}
        aria-label={`Message to ${sessionName}`}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length === 0) return;
          event.preventDefault();
          void attachImages(files);
        }}
        onKeyDown={(event) => {
          const target = event.currentTarget;
          const action = composerKeyAction(event, {
            value: target.value,
            selectionStart: target.selectionStart ?? 0,
            selectionEnd: target.selectionEnd ?? 0,
          });

          if (action === "newline" || action === "none") return;
          event.preventDefault();

          if (action === "submit") {
            submit();
            return;
          }
          if (action === "blur-to-terminal") {
            onFocusTerminal();
            return;
          }

          const stepped = recallSubmission(history, action === "recall-older" ? -1 : 1, target.value);
          // Null means there was nowhere to step to. The key was already
          // swallowed above, which is the right call either way: a caret that
          // silently jumps out of the message on a dead-end arrow is worse than
          // one that stays put.
          if (!stepped) return;
          setHistory(stepped.history);
          setDraft(stepped.value);
        }}
      />
      <div className="dk-composer-bar">
        {agentLabel ? <span className="dk-chip dk-composer-agent">{agentLabel}</span> : null}
        <button
          type="button"
          className="dk-icon-btn dk-icon-btn--sm"
          disabled={attaching}
          onClick={() => void (async () => {
            const api = window.pitwall;
            if (!api?.chooseTerminalImages) {
              setAttachError("Image attachments are unavailable.");
              return;
            }
            setAttaching(true);
            setAttachError("");
            try {
              const result = await api.chooseTerminalImages({ sessionId });
              const staged = result.paths || [];
              if (staged.length > 0) {
                setDraft((current) => withImagePaths(current, staged));
                inputRef.current?.focus();
              }
              if (result.error) setAttachError(result.error);
            } finally {
              setAttaching(false);
            }
          })()}
          title="Attach an image — or just paste or drop one here"
          aria-label="Attach an image"
        >
          {attaching ? <Loader2 size={14} className="is-spinning" /> : <ImagePlus size={14} />}
        </button>
        {attachError ? (
          <span className="dk-error dk-composer-hint">{attachError}</span>
        ) : (
          <span className="dk-hint dk-composer-hint">Enter sends · paste or drop an image · Esc to the terminal</span>
        )}
        <button type="submit" className="dk-composer-send" disabled={!draft.trim()} title="Send to this session" aria-label="Send">
          <ArrowUp size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

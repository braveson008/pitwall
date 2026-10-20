import { useRef, useState } from "react";
import { ImagePlus, LoaderCircle, X } from "lucide-react";

/**
 * Images attached to a task's description.
 *
 * A bug report is very often a screenshot, and until now the only way to give
 * one to an agent was to start the session and paste it into the terminal —
 * which meant the task itself, the thing another agent picks up later, never
 * had it.
 *
 * They are staged the same way the composer stages them: copied into Pitwall's
 * own attachment directory and referenced by absolute path, because that is how
 * the CLIs take an image. Nothing is uploaded and nothing is re-encoded. The
 * paths travel with the task, so they still resolve when the session starts an
 * hour later.
 *
 * Keyed by the draft id rather than a session id — there is no session yet when
 * a task is being written, and the staging directory only ever needed a stable
 * string.
 */
export function TaskImageAttachments({
  draftId,
  images,
  onChange,
}: {
  draftId: string;
  images: string[];
  onChange: (images: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  // Nested drags fire dragleave on every child boundary; counting them is what
  // keeps the highlight from flickering as the pointer crosses a chip.
  const dragDepth = useRef(0);

  const stage = async (files: File[]) => {
    const picked = files.filter((file) => file.type.startsWith("image/"));
    if (picked.length === 0) return;

    const api = window.braveli;
    if (!api?.stageTerminalImages || !api.stageTerminalImageData || !api.getPathForFile) {
      setError("Image attachments are unavailable.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      // A dropped file has a path on disk; one pasted from the clipboard exists
      // only in memory, so it has to be handed over as bytes.
      const paths: string[] = [];
      const pasted: File[] = [];
      for (const file of picked) {
        const filePath = api.getPathForFile(file);
        if (filePath) paths.push(filePath);
        else pasted.push(file);
      }

      const results = [];
      if (paths.length > 0) results.push(await api.stageTerminalImages({ sessionId: draftId, paths }));
      if (pasted.length > 0) {
        results.push(
          await api.stageTerminalImageData({
            sessionId: draftId,
            images: await Promise.all(
              pasted.map(async (file, index) => ({
                name: file.name || `pasted-image-${index + 1}`,
                type: file.type,
                data: new Uint8Array(await file.arrayBuffer()),
              })),
            ),
          }),
        );
      }

      const staged = results.flatMap((result) => result.paths || []);
      const failed = results.map((result) => result.error).filter(Boolean);
      if (staged.length > 0) onChange([...images, ...staged]);
      if (failed.length > 0) setError(String(failed[0]));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be attached.");
    } finally {
      setBusy(false);
    }
  };

  const choose = async () => {
    const api = window.braveli;
    if (!api?.chooseTerminalImages) {
      setError("Image attachments are unavailable.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.chooseTerminalImages({ sessionId: draftId });
      const staged = result.paths || [];
      if (staged.length > 0) onChange([...images, ...staged]);
      if (result.error) setError(String(result.error));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The image could not be attached.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`dk-attachments${dragging ? " is-dragging" : ""}`}
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        void stage([...event.dataTransfer.files]);
      }}
      onPaste={(event) => {
        const files = [...event.clipboardData.files];
        if (files.length === 0) return;
        event.preventDefault();
        void stage(files);
      }}
    >
      {images.length > 0 && (
        <ul className="dk-attachment-list">
          {images.map((image) => (
            <li key={image}>
              {/* The staged copy, read straight off disk. It is Pitwall's own
                  file in Pitwall's own directory, so there is nothing to fetch
                  and nothing to trust. */}
              <img src={`file://${image}`} alt="" />
              <button
                type="button"
                className="dk-attachment-remove"
                aria-label={`Remove ${fileNameOf(image)}`}
                onClick={() => onChange(images.filter((entry) => entry !== image))}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="dk-attachment-bar">
        <button type="button" className="dk-btn dk-btn--sm" disabled={busy} onClick={() => void choose()}>
          {busy ? <LoaderCircle className="dk-attachment-spin" size={14} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
          {images.length === 0 ? "Attach images" : "Add another"}
        </button>
        <span className="dk-hint">or drop or paste them here</span>
      </div>

      {error && <p className="dk-error">{error}</p>}
    </div>
  );
}

function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || "image";
}

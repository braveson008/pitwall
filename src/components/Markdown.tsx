import { memo, useMemo } from "react";
import { parseBlocks, type Block, type Inline } from "../lib/markdown";

/**
 * Agent prose, rendered.
 *
 * Agents write markdown — headings, bold, fenced code, quoted ticket text — and
 * a council handoff is a structured document rather than a paragraph. Shown as
 * plain text it arrives as a wall with `##` and `**` still in it, which is
 * exactly as hard to read as it sounds.
 *
 * Headings are the part that matters most here and the part the transcript
 * renderer drops: without them a five-section handoff has no shape at all.
 */

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.kind === "bold") return <strong key={index}>{inline.text}</strong>;
        if (inline.kind === "code") return <code key={index}>{inline.text}</code>;
        if (inline.kind === "link" || inline.kind === "image") {
          const label = inline.kind === "link" ? inline.text : inline.alt || "image";
          return (
            <a
              key={index}
              href={inline.href}
              onClick={(event) => {
                // Agent output is untrusted text, so this goes through the same
                // bridge as every other link, which refuses anything but HTTP(S).
                event.preventDefault();
                void window.pitwall?.openExternalUrl?.(inline.href);
              }}
            >
              {label}
            </a>
          );
        }
        return <span key={index}>{inline.text}</span>;
      })}
    </>
  );
}

export const Markdown = memo(function Markdown({ source }: { source: string }) {
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
        if (block.kind === "heading") {
          // Flattened to three levels: an agent's `####` is not a different
          // kind of thing from its `###`, and six sizes in one card is noise.
          const level = Math.min(Math.max(block.level, 1), 3);
          const Tag = (["h4", "h5", "h6"] as const)[level - 1];
          return (
            <Tag className={`dk-md-h dk-md-h${level}`} key={index}>
              <Inlines inlines={block.inlines} />
            </Tag>
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

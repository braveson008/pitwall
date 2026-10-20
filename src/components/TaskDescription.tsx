import { ImageIcon } from "lucide-react";
import { parseBlocks, reflowFlattenedMarkdown, trackerHtmlToMarkdown, type Block, type Inline } from "../lib/markdown";

/**
 * Tracker descriptions, rendered rather than printed.
 *
 * What arrives from Linear or Jira is Markdown, and Pitwall used to show it as
 * one long bolded run: "#" and "*" left as literal characters, and an inline
 * image spilling a few hundred characters of signed URL into the middle of a
 * sentence. The parser it shares with the transcript already knows these
 * forms — this only has to lay them out.
 */

function Inlines({ inlines }: { inlines: Inline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        if (inline.kind === "bold") return <strong key={index}>{inline.text}</strong>;
        if (inline.kind === "code") return <code key={index}>{inline.text}</code>;
        if (inline.kind === "link") {
          return <a key={index} href={inline.href} target="_blank" rel="noreferrer">{inline.text}</a>;
        }
        if (inline.kind === "image") {
          // Named, not shown. The URL is signed and unreadable, and a tracker
          // attachment is worth a click rather than the width of a paragraph.
          return (
            <a className="dk-desc-attachment" key={index} href={inline.href} target="_blank" rel="noreferrer">
              <ImageIcon size={12} aria-hidden="true" />
              {inline.alt || "Attachment"}
            </a>
          );
        }
        return <span key={index}>{inline.text}</span>;
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          // Levels are flattened to two ranks: a tracker's h1 is not a page
          // title here, it is a section inside a card.
          const Tag = block.level <= 2 ? "h4" : "h5";
          return <Tag key={index}><Inlines inlines={block.inlines} /></Tag>;
        }
        if (block.kind === "code") {
          return <pre key={index}><code>{block.text}</code></pre>;
        }
        if (block.kind === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}><Inlines inlines={item} /></li>
              ))}
            </List>
          );
        }
        if (block.kind === "rule") return <hr key={index} />;
        if (block.kind === "quote") {
          return <blockquote key={index}><Inlines inlines={block.inlines} /></blockquote>;
        }
        return <p key={index}><Inlines inlines={block.inlines} /></p>;
      })}
    </>
  );
}

/** One line of plain text: card previews, inspector summaries, tooltips. */
export function taskDescriptionText(value: string, limit = 300) {
  const clean = trackerHtmlToMarkdown(String(value || ""))
    // Images first, whole: otherwise the link stripper leaves the URL behind.
    .replace(/!\[[^\]]*\]\([^)\s]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "")
    // A flattened list reads as a row of asterisks; drop the markers, keep words.
    .replace(/(?:^|\s)[*\-+](?=\s)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const labelledDescription = clean.match(/(?:^|\s)Description:\s*(.+?)(?=\s(?:Summary|Info|Reported\s*by|Acceptance criteria):|$)/i)?.[1]?.trim();
  const display = labelledDescription || clean;
  return display.length > limit ? `${display.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : display;
}

/** Safe, dependency-free formatting for tracker descriptions and local notes. */
export function TaskDescription({ value, compact = false }: { value: string; compact?: boolean }) {
  if (compact) return <p className="dk-desc">{taskDescriptionText(value) || "No description yet."}</p>;

  // Tasks imported before HTML was converted at the door still hold it.
  const source = trackerHtmlToMarkdown(String(value || "")).trim();
  if (!source) return <p className="dk-desc dk-muted">No description yet.</p>;
  // Descriptions imported before the reader stopped collapsing newlines are
  // stored as one line; reflow puts the structure back before parsing.
  return (
    <div className="dk-desc">
      <Blocks blocks={parseBlocks(reflowFlattenedMarkdown(source))} />
    </div>
  );
}

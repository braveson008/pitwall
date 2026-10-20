/**
 * Knowledge records are excerpts of real project files, so their content
 * arrives as whatever the source used — YAML front matter, Markdown headings,
 * bullet lists, fenced commands, or bare `key: value` lines. Rendered as one
 * pre-wrapped string it all reads as a wall of punctuation: `---` fences,
 * `#` characters and link brackets that mean nothing to a reader.
 *
 * This turns that text into a small block model the panel can render with real
 * elements. It is deliberately not a Markdown implementation: it recognises the
 * few shapes that actually appear in these excerpts and leaves everything else
 * as plain text, so no dependency and no HTML injection is involved.
 */

export interface KnowledgeSpan {
  text: string;
  code?: boolean;
  href?: string;
}

export interface KnowledgeField {
  name: string;
  value: string;
}

export type KnowledgeBlock =
  | { type: "paragraph"; spans: KnowledgeSpan[] }
  | { type: "heading"; level: number; spans: KnowledgeSpan[] }
  | { type: "list"; ordered: boolean; items: KnowledgeSpan[][] }
  | { type: "fields"; fields: KnowledgeField[] }
  | { type: "code"; text: string }
  | { type: "rule" };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/**
 * A field line is `name: value` where the name is short and free of the
 * punctuation that marks running prose. Without that guard a sentence like
 * "Observed documentation at AGENTS.md: this is an excerpt" would be shown as
 * a labelled field, which reads worse than the sentence it came from.
 */
const FIELD = /^([^:\n]{1,60}):[ \t]+(.+)$/;

function isFieldLine(line: string): boolean {
  const match = line.match(FIELD);
  if (!match) return false;
  const name = match[1].trim();
  if (!name || /[.,;!?]$/.test(name)) return false;
  return name.split(/\s+/).length <= 6;
}

function toField(line: string): KnowledgeField {
  const match = line.match(FIELD)!;
  return { name: match[1].trim(), value: match[2].trim().replace(/^["']|["']$/g, "") };
}

/** Inline code and links carry their meaning in the text, not in the brackets. */
export function parseSpans(text: string): KnowledgeSpan[] {
  const spans: KnowledgeSpan[] = [];
  const pattern = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  const push = (span: KnowledgeSpan) => {
    if (span.text) spans.push(span);
  };
  while ((match = pattern.exec(text))) {
    push({ text: text.slice(last, match.index) });
    if (match[3] !== undefined) {
      push({ text: match[3], code: true });
    } else {
      const label = match[1];
      const inner = label.match(/^`([^`]+)`$/);
      push(inner ? { text: inner[1], code: true, href: match[2] } : { text: label, href: match[2] });
    }
    last = match.index + match[0].length;
  }
  push({ text: text.slice(last) });
  return spans.length ? spans : [{ text: "" }];
}

const FENCE_RULE = /^-{3,}\s*$/;

/**
 * A `---` fence wrapping nothing but `key: value` lines is front matter, and
 * an excerpt often starts with a sentence before it rather than at the top of
 * the file. Anything else keeps its plain meaning: a fence that never closes,
 * or one wrapping prose, stays a horizontal rule so no content is hidden.
 */
function takeFieldFence(lines: string[], start: number): { fields: KnowledgeField[]; next: number } | null {
  if (!FENCE_RULE.test(lines[start]?.trim() ?? "")) return null;
  let close = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (FENCE_RULE.test(lines[index].trim())) {
      close = index;
      break;
    }
  }
  if (close === -1) return null;
  const body = lines.slice(start + 1, close);
  if (!body.length || !body.every((line) => !line.trim() || isFieldLine(line))) return null;
  return { fields: body.filter((line) => line.trim()).map(toField), next: close + 1 };
}

export function formatKnowledge(content: string): KnowledgeBlock[] {
  const source = (content ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return [];

  const blocks: KnowledgeBlock[] = [];
  const lines = source.split("\n");

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", text: body.join("\n").replace(/\n+$/, "") });
      continue;
    }

    if (RULE.test(line)) {
      const fenced = takeFieldFence(lines, index);
      if (fenced) {
        blocks.push({ type: "fields", fields: fenced.fields });
        index = fenced.next;
        continue;
      }
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, spans: parseSpans(heading[2].trim()) });
      index += 1;
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = !BULLET.test(line) && ORDERED.test(line);
      const items: KnowledgeSpan[][] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = ordered ? current.match(ORDERED) : current.match(BULLET);
        if (!match) break;
        items.push(parseSpans(match[1].trim()));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // A run of `key: value` lines is a table of facts, not a paragraph. One
    // such line on its own stays prose; two or more is a deliberate shape.
    if (isFieldLine(line)) {
      const fields: KnowledgeField[] = [];
      let cursor = index;
      while (cursor < lines.length && lines[cursor].trim() && isFieldLine(lines[cursor])) {
        fields.push(toField(lines[cursor]));
        cursor += 1;
      }
      if (fields.length > 1) {
        blocks.push({ type: "fields", fields });
        index = cursor;
        continue;
      }
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (
        !current.trim() ||
        FENCE.test(current) ||
        RULE.test(current) ||
        HEADING.test(current) ||
        BULLET.test(current) ||
        ORDERED.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", spans: parseSpans(paragraph.join(" ")) });
  }

  return blocks;
}

function blockLength(block: KnowledgeBlock): number {
  if (block.type === "rule") return 0;
  if (block.type === "code") return block.text.length;
  if (block.type === "fields") return block.fields.reduce((total, field) => total + field.name.length + field.value.length, 0);
  if (block.type === "list") return block.items.reduce((total, item) => total + item.reduce((sum, span) => sum + span.text.length, 0), 0);
  return block.spans.reduce((total, span) => total + span.text.length, 0);
}

/**
 * A long record is shown as an excerpt with the full text behind a disclosure.
 * Cutting the raw string mid-word split headings from their bodies and could
 * end inside a fence; taking whole blocks keeps every excerpt well-formed.
 */
export function excerptBlocks(blocks: KnowledgeBlock[], limit = 500): { blocks: KnowledgeBlock[]; truncated: boolean } {
  const kept: KnowledgeBlock[] = [];
  let used = 0;
  for (const block of blocks) {
    if (kept.length && used + blockLength(block) > limit) {
      // Never end an excerpt on a heading: a title with its body cut away
      // reads as a mistake rather than as a summary.
      if (kept.at(-1)?.type === "heading") kept.push(block);
      return { blocks: kept, truncated: true };
    }
    kept.push(block);
    used += blockLength(block);
  }
  return { blocks: kept, truncated: false };
}

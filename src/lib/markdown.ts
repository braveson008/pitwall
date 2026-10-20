/**
 * The small amount of Markdown an agent actually writes.
 *
 * The transcript rendered raw text, so a session reported `**Pushed:**
 * \`96eb85cec..b2909afb6\`` with the asterisks and backticks visible and a fenced
 * block as three literal backticks on their own line. The terminal renders all
 * of it, which made the pane Pitwall drew the harder one to read.
 *
 * Deliberately not a Markdown library. What arrives is bold, inline code, fenced
 * blocks, links and the occasional list — a handful of forms, from a known
 * writer, rendered into a fixed set of nodes. A parser for the whole grammar
 * would be more code and more surface for an agent's prose to break.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string }
  /* Trackers paste images inline, and their URLs are signed and enormous.
     Kept as a node so it can be rendered as a link rather than spilling a
     few hundred characters of query string into the prose. */
  | { kind: "image"; alt: string; href: string };

export type Block =
  | { kind: "heading"; level: number; inlines: Inline[] }
  /* Agents quote the ticket they were given and rule off between sections.
     Left unparsed, both arrive as literal "> " and "---" in the prose. */
  | { kind: "quote"; inlines: Inline[] }
  | { kind: "rule" }
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "code"; text: string; language: string }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

/** Bold, code spans and links inside one run of text. */
export function parseInline(text: string): Inline[] {
  const inlines: Inline[] = [];
  // Code first: backticks are literal inside them, so nothing else may match
  // within a span. Bold before links so a bolded link keeps its emphasis.
  // Images before links: the syntax differs by one leading character, so a
  // link pattern matches the tail of an image and leaves the "!" behind.
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) inlines.push({ kind: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) inlines.push({ kind: "code", text: match[1] });
    else if (match[2] !== undefined) inlines.push({ kind: "bold", text: match[2] });
    else if (match[4] !== undefined) inlines.push({ kind: "image", alt: match[3], href: match[4] });
    else inlines.push({ kind: "link", text: match[5], href: match[6] });
    last = match.index + match[0].length;
  }
  if (last < text.length) inlines.push({ kind: "text", text: text.slice(last) });
  return inlines.length ? inlines : [{ kind: "text", text }];
}

const FENCE = /^\s*```(\S*)\s*$/;
const HEADING = /^\s*(#{1,6})\s+(.*\S)\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/** Blocks in a message: paragraphs, fenced code, and simple lists. */
export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let paragraph: string[] = [];
  let items: string[] = [];
  let ordered = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n").trim();
    if (text) blocks.push({ kind: "paragraph", inlines: parseInline(text) });
    paragraph = [];
  };
  const flushList = () => {
    if (!items.length) return;
    blocks.push({ kind: "list", ordered, items: items.map(parseInline) });
    items = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const body: string[] = [];
      index += 1;
      // An unterminated fence runs to the end rather than swallowing the rest as
      // a paragraph: a truncated message should still show its code.
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", text: body.join("\n"), language: fence[1] || "" });
      continue;
    }

    // A rule closes whatever was open; three or more of - _ or * alone.
    if (/^\s*([-_*])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "rule" });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      flushList();
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      index -= 1;
      const text = quoted.join("\n").trim();
      if (text) blocks.push({ kind: "quote", inlines: parseInline(text) });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", level: heading[1].length, inlines: parseInline(heading[2]) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBER.exec(line);
    if (bullet || numbered) {
      const text = (bullet?.[1] ?? numbered?.[1] ?? "").trim();
      // Trackers emit runs like "* * * *" where a list was pasted flat. An
      // item with nothing but markers in it is noise, not content.
      if (bullet && !text.replace(/[*\-\s]/g, "")) continue;
      flushParagraph();
      const nextOrdered = Boolean(numbered);
      if (items.length && nextOrdered !== ordered) flushList();
      ordered = nextOrdered;
      items.push(text);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

/**
 * Puts the line breaks back into Markdown that arrived as one line.
 *
 * Descriptions imported before the tracker reader stopped collapsing newlines
 * are stored flat, and no line-based parser can see structure that is not
 * there: headings, list markers and table rows all sit mid-sentence. Re-imports
 * fix new tasks; this rescues the ones already saved.
 *
 * Only breaks where a Markdown marker is unambiguous — preceded by whitespace,
 * followed by content — so ordinary prose containing a hash or an asterisk is
 * left alone.
 */
export function reflowFlattenedMarkdown(source: string): string {
  const text = String(source || "");
  if (text.includes("\n")) return text;      // already structured; nothing to guess

  const broken = text
    // A run of bare markers is a list that lost its items — "* * * *" — and
    // carries nothing. Removed before anything else tries to read it.
    .replace(/(?:\s+[*-])+(?=\s+(?:#|$))/g, "")
    // Headings: "text # Heading" -> break before the hashes.
    .replace(/\s+(#{1,6})\s+(?=\S)/g, "\n$1 ")
    // Table rows: a run of cells ends where the next row's leading pipe begins.
    .replace(/\s*\|\s*\|\s*/g, "\n| ")
    // List markers between words. Deliberately excludes a following digit:
    // "5 * 3" is arithmetic, and breaking it invents a bullet. A real bullet
    // that opens with a number is rarer than prose that multiplies, so this
    // under-breaks rather than mangling the sentence.
    .replace(/\s+([*-])\s+(?=[A-Za-z`[])/g, "\n$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // A heading that was flattened has no end: everything that followed it ran
  // on. Tracker headings are short titles, so the line is cut where the prose
  // plainly restarts — a table cell, a finished sentence, or simply too many
  // words to be a title — and the remainder becomes the body it always was.
  return broken
    .split("\n")
    .flatMap((line) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (!heading) return [line];
      const title = heading[2];
      const cut = (() => {
        const pipe = title.indexOf("|");
        if (pipe > 0) return pipe;
        const sentence = title.search(/\.\s+\S/);
        if (sentence > 0) return sentence + 1;
        const words = title.split(/\s+/);
        if (words.length > 6) return title.indexOf(words[6]);
        return -1;
      })();
      if (cut <= 0) return [line];
      const rest = title.slice(cut).trim();
      return rest ? [`${heading[1]} ${title.slice(0, cut).trim()}`, rest] : [line];
    })
    .join("\n");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string) {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1] ?? tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, "i"))?.[1] ?? "";
}

const HTML_MARKUP = /<\/?(?:p|br|div|span|figure|ul|ol|li|h[1-6]|a|strong|b|em|i|code|pre|table|tr|td|th|blockquote|img)\b[^>]*>/i;

/**
 * A tracker description that arrived as HTML, as Markdown.
 *
 * Jira, through its MCP server, hands descriptions over rendered — paragraphs,
 * line breaks and media figures as tags — and they were shown as raw markup.
 * Converted here into the Markdown the description renderer already reads, so
 * the same text reads properly on screen and in an agent's prompt. Text that is
 * not HTML is returned untouched.
 */
export function trackerHtmlToMarkdown(source: string): string {
  const text = String(source || "");
  if (!HTML_MARKUP.test(text)) return text;

  const markdown = text
    // A media node is an attachment the agent cannot see; name it rather than drop it.
    .replace(/<div\b[^>]*data-type="media"[^>]*>/gi, (tag) => {
      const name = decodeEntities(attribute(tag, "data-alt") || attribute(tag, "data-name"));
      return `\n[Attachment${name ? `: ${name}` : ""}]\n`;
    })
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const name = decodeEntities(attribute(tag, "alt"));
      return `[Image${name ? `: ${name}` : ""}]`;
    })
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, body: string) => `\n\`\`\`\n${body.replace(/<[^>]+>/g, "")}\n\`\`\`\n`)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (match, label: string) => {
      const href = decodeEntities(attribute(match, "href"));
      const words = label.replace(/<[^>]+>/g, "").trim();
      // Only web links become links; anything else is kept as its words.
      return /^https?:\/\//i.test(href) ? `[${words || href}](${href})` : words;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-6])\b[^>]*>/gi, (_match, level: string) => `\n\n${"#".repeat(Math.min(Number(level), 3))} `)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/?(?:strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/?code\b[^>]*>/gi, "`")
    .replace(/<\/(?:p|div|h[1-6]|ul|ol|table|blockquote|figure)>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(markdown)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+$/g, ""))
    .join("\n")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

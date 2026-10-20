/**
 * Enough syntax colouring to read a diff by.
 *
 * Written rather than imported. A diff is a pile of disconnected fragments, so
 * a highlighter has to work a line at a time — and a line at a time is exactly
 * where the off-the-shelf ones fall down: a block comment or a template literal
 * spanning three lines gets its opening token on line one and nothing after it,
 * so lines two and three come back as ordinary code and colour completely
 * wrong. Diffs are full of both.
 *
 * So each line is tokenised with the state left behind by the line above it,
 * and hands its own state to the line below. That is the whole reason this
 * exists; the rest is a lexer for the handful of languages Pitwall actually
 * shows.
 *
 * It is deliberately approximate. Colour that is wrong in the corners is a
 * cosmetic problem; colour that stops at the first multi-line string is not.
 */

export type TokenKind =
  | "keyword"
  | "string"
  | "comment"
  | "number"
  | "type"
  | "function"
  | "property"
  | "tag"
  | "attribute"
  | "punctuation"
  | "plain";

export type Token = { kind: TokenKind; text: string };

/** What a line inherits from the one above it. */
export type HighlightState = { comment: boolean; template: boolean };

export const INITIAL_STATE: HighlightState = { comment: false, template: false };

export type Language = "ts" | "css" | "json" | "markup" | "shell" | "markdown" | "plain";

const BY_EXTENSION: Record<string, Language> = {
  ts: "ts", tsx: "ts", js: "ts", jsx: "ts", mjs: "ts", cjs: "ts", mts: "ts", cts: "ts",
  css: "css", scss: "css", less: "css",
  json: "json",
  html: "markup", htm: "markup", xml: "markup", svg: "markup", vue: "markup",
  sh: "shell", bash: "shell", zsh: "shell",
  md: "markdown", markdown: "markdown",
};

export function languageFromPath(path: string): Language {
  const name = path.split("/").pop() ?? "";
  if (/^(Dockerfile|Makefile)$/i.test(name)) return "shell";
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return BY_EXTENSION[extension] ?? "plain";
}

const KEYWORDS = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "finally", "for", "from",
  "function", "get", "if", "implements", "import", "in", "instanceof", "interface", "is", "keyof",
  "let", "new", "of", "readonly", "return", "satisfies", "set", "static", "super", "switch",
  "this", "throw", "try", "type", "typeof", "var", "void", "while", "yield",
]);

const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity"]);

const PRIMITIVES = new Set([
  "any", "bigint", "boolean", "never", "number", "object", "string", "symbol", "unknown",
]);

const SHELL_KEYWORDS = new Set([
  "case", "do", "done", "elif", "else", "esac", "fi", "for", "function", "if", "in", "return",
  "then", "until", "while", "export", "local", "set", "unset", "source", "echo", "cd", "exit",
]);

function push(tokens: Token[], kind: TokenKind, text: string) {
  if (!text) return;
  const last = tokens[tokens.length - 1];
  // Merging runs keeps the DOM small; a long line of plain code is one span.
  if (last && last.kind === kind) last.text += text;
  else tokens.push({ kind, text });
}

/** One line, given what the line above left open. */
export function highlightLine(
  line: string,
  language: Language,
  state: HighlightState = INITIAL_STATE,
): { tokens: Token[]; state: HighlightState } {
  if (language === "plain" || language === "markdown") {
    return { tokens: [{ kind: "plain", text: line }], state: INITIAL_STATE };
  }
  if (language === "markup") return { tokens: markup(line), state: INITIAL_STATE };
  if (language === "shell") return { tokens: shell(line), state: INITIAL_STATE };
  return code(line, language, state);
}

/** TypeScript, JavaScript, CSS and JSON, which differ less than they look. */
function code(line: string, language: Language, state: HighlightState) {
  const tokens: Token[] = [];
  let comment = state.comment;
  let template = state.template;
  let index = 0;
  let plain = "";
  /** The last identifier seen, so `new Widget()` reads as a class not a call. */
  let previousWord = "";

  const flush = () => {
    push(tokens, "plain", plain);
    plain = "";
  };

  while (index < line.length) {
    const rest = line.slice(index);

    if (comment) {
      const end = rest.indexOf("*/");
      if (end === -1) {
        push(tokens, "comment", rest);
        return { tokens, state: { comment: true, template } };
      }
      push(tokens, "comment", rest.slice(0, end + 2));
      index += end + 2;
      comment = false;
      continue;
    }

    if (template) {
      const end = findUnescaped(rest, "`");
      if (end === -1) {
        push(tokens, "string", rest);
        return { tokens, state: { comment, template: true } };
      }
      push(tokens, "string", rest.slice(0, end + 1));
      index += end + 1;
      template = false;
      continue;
    }

    if (rest.startsWith("//")) {
      flush();
      push(tokens, "comment", rest);
      break;
    }

    if (rest.startsWith("/*")) {
      flush();
      const end = rest.indexOf("*/", 2);
      if (end === -1) {
        push(tokens, "comment", rest);
        return { tokens, state: { comment: true, template } };
      }
      push(tokens, "comment", rest.slice(0, end + 2));
      index += end + 2;
      continue;
    }

    const quote = rest[0];
    if (quote === '"' || quote === "'" || quote === "`") {
      flush();
      const end = findUnescaped(rest.slice(1), quote);
      if (end === -1) {
        push(tokens, "string", rest);
        return { tokens, state: { comment, template: quote === "`" } };
      }
      push(tokens, "string", rest.slice(0, end + 2));
      index += end + 2;
      continue;
    }

    const word = rest.match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      flush();
      const text = word[0];
      const after = rest.slice(text.length).match(/^\s*/)?.[0].length ?? 0;
      const next = rest[text.length + after];
      if (language === "json") {
        push(tokens, LITERALS.has(text) ? "keyword" : "plain", text);
      } else if (language === "css") {
        push(tokens, next === ":" ? "property" : "plain", text);
      } else if (KEYWORDS.has(text)) {
        push(tokens, "keyword", text);
      } else if (LITERALS.has(text) || PRIMITIVES.has(text)) {
        push(tokens, "keyword", text);
      } else if (previousWord === "new" || previousWord === "extends" || previousWord === "implements") {
        // Constructed and inherited names are types, whatever punctuation
        // follows them — `new Widget()` is a class, not a function call.
        push(tokens, "type", text);
      } else if (next === "(") {
        push(tokens, "function", text);
      } else if (/^[A-Z]/.test(text)) {
        push(tokens, "type", text);
      } else {
        push(tokens, "plain", text);
      }
      previousWord = text;
      index += text.length;
      continue;
    }

    const number = rest.match(/^(0[xX][\da-fA-F_]+|\d[\d_]*(\.[\d_]+)?([eE][+-]?\d+)?)/);
    if (number) {
      flush();
      push(tokens, "number", number[0]);
      index += number[0].length;
      continue;
    }

    if (language === "css" && rest[0] === "-" && /^--[\w-]+/.test(rest)) {
      flush();
      const variable = rest.match(/^--[\w-]+/)![0];
      push(tokens, "property", variable);
      index += variable.length;
      continue;
    }

    if (/[{}()[\];:,.<>=+\-*/%!?&|^~]/.test(rest[0])) {
      flush();
      push(tokens, "punctuation", rest[0]);
      index += 1;
      continue;
    }

    plain += rest[0];
    index += 1;
  }

  flush();
  return { tokens, state: { comment, template } };
}

/** The index of the next unescaped occurrence of `char`, or -1. */
function findUnescaped(text: string, char: string): number {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\\") {
      i += 1;
      continue;
    }
    if (text[i] === char) return i;
  }
  return -1;
}

function markup(line: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /(<!--.*?-->)|(<\/?[\w:-]+)|([\w:-]+)(?==)|("[^"]*"|'[^']*')|(\/?>)/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    push(tokens, "plain", line.slice(last, match.index));
    if (match[1]) push(tokens, "comment", match[1]);
    else if (match[2]) push(tokens, "tag", match[2]);
    else if (match[3]) push(tokens, "attribute", match[3]);
    else if (match[4]) push(tokens, "string", match[4]);
    else if (match[5]) push(tokens, "tag", match[5]);
    last = match.index + match[0].length;
  }
  push(tokens, "plain", line.slice(last));
  return tokens;
}

function shell(line: string): Token[] {
  const tokens: Token[] = [];
  const hash = line.indexOf("#");
  const body = hash === -1 ? line : line.slice(0, hash);
  const pattern = /("[^"]*"|'[^']*')|(\$\{?[\w-]+\}?)|([A-Za-z_][\w-]*)/g;
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    push(tokens, "plain", body.slice(last, match.index));
    if (match[1]) push(tokens, "string", match[1]);
    else if (match[2]) push(tokens, "property", match[2]);
    else push(tokens, SHELL_KEYWORDS.has(match[3]) ? "keyword" : "plain", match[3]);
    last = match.index + match[0].length;
  }
  push(tokens, "plain", body.slice(last));
  if (hash !== -1) push(tokens, "comment", line.slice(hash));
  return tokens;
}

/**
 * Colours a diff's lines, tracking each side of the change separately.
 *
 * A patch interleaves two versions of a file. Running one state through them in
 * order lets a block comment that was deleted keep colouring the lines that
 * replaced it, which is both wrong and the most visible way to be wrong. So the
 * old side (context and removals) and the new side (context and additions)
 * carry their own state, and each line is coloured with the one it belongs to.
 */
export function highlightHunks(
  hunks: { header: string; lines: { kind: string; text: string }[] }[],
  language: Language,
): Token[][][] {
  let before = INITIAL_STATE;
  let after = INITIAL_STATE;

  return hunks.map((hunk) => {
    // A hunk starts somewhere new in the file, so nothing carries into it.
    before = INITIAL_STATE;
    after = INITIAL_STATE;

    return hunk.lines.map((line) => {
      if (line.kind === "removed") {
        const result = highlightLine(line.text, language, before);
        before = result.state;
        return result.tokens;
      }
      if (line.kind === "added") {
        const result = highlightLine(line.text, language, after);
        after = result.state;
        return result.tokens;
      }
      const result = highlightLine(line.text, language, after);
      after = result.state;
      before = result.state;
      return result.tokens;
    });
  });
}

/**
 * What a session cost, read from what the CLI actually said.
 *
 * Pitwall drives agents through their own command-line tools, so it never
 * sees a billing API. What it does see is the transcript, and some CLIs print
 * their usage into it — Codex ends a run with `tokens used` and a number.
 *
 * ## Why this refuses to estimate
 *
 * The obvious alternative is to guess: multiply the prompt's characters by a
 * ratio and call it tokens. That number would appear beside a real one from a
 * CLI that does report, in the same column, in the same font, and nobody
 * reading it could tell which was which. A cost view that cannot be trusted is
 * worse than none, because somebody makes a decision on it.
 *
 * So a session whose CLI said nothing is reported as unknown, and the totals
 * say how many sessions they could not count.
 */

export interface SessionUsage {
  /** Tokens the CLI reported, absent when it reported none. */
  tokens?: number;
  /** Dollars the CLI reported, absent when it reported none. */
  costUsd?: number;
  /** Which shape matched, so a wrong reading can be traced to its pattern. */
  source?: string;
}

/**
 * Shapes seen in real CLI output, each anchored tightly.
 *
 * Deliberately narrow. A loose pattern like /(\d+) tokens/ matches an agent
 * writing prose about tokens, and a cost view that reads a sentence as a
 * measurement is exactly the failure this file exists to avoid.
 */
const TOKEN_PATTERNS: Array<{ source: string; re: RegExp }> = [
  // Codex: a `tokens used` header with the figure on the following line.
  { source: "codex", re: /tokens\s+used\s*\n\s*([\d,]+)/i },
  // The same, on one line.
  { source: "tokens-used", re: /tokens\s+used[:\s]+([\d,]+)/i },
  // `Total tokens: 12,345`
  { source: "total-tokens", re: /total\s+tokens[:\s]+([\d,]+)/i },
  // `input: 1,000  output: 2,000` — summed by the caller below.
];

const COST_PATTERNS: Array<{ source: string; re: RegExp }> = [
  { source: "total-cost", re: /total\s+cost[^\d$]*\$\s*([\d.]+)/i },
  { source: "cost-usd", re: /cost[^\d$]*\$\s*([\d.]+)\s*(?:usd)?/i },
];

const IN_OUT = /input[:\s]+([\d,]+)[\s\S]{0,40}?output[:\s]+([\d,]+)/i;

const toNumber = (raw: string) => {
  const value = Number.parseInt(raw.replace(/,/g, ""), 10);
  return Number.isFinite(value) ? value : undefined;
};

/**
 * Reads usage out of a transcript.
 *
 * The tail only: a long session's early output may mention numbers, and the
 * figure that matters is the one the CLI printed when it finished.
 */
export function readUsage(transcript: string, tailChars = 4000): SessionUsage {
  const tail = String(transcript || "").slice(-tailChars);
  if (!tail.trim()) return {};

  const usage: SessionUsage = {};

  for (const { source, re } of TOKEN_PATTERNS) {
    const match = tail.match(re);
    const value = match && toNumber(match[1]);
    if (value) {
      usage.tokens = value;
      usage.source = source;
      break;
    }
  }

  if (usage.tokens === undefined) {
    const split = tail.match(IN_OUT);
    // Both numbers, or neither. `split && toNumber(...)` is null when there
    // was no match, and a guard that only rejected `undefined` let null
    // through — so `null + null` reported every session as a measured zero,
    // which is the invented figure this whole file exists to refuse.
    const input = split ? toNumber(split[1]) : undefined;
    const output = split ? toNumber(split[2]) : undefined;
    if (typeof input === "number" && typeof output === "number" && input + output > 0) {
      usage.tokens = input + output;
      usage.source = "input-output";
    }
  }

  for (const { source, re } of COST_PATTERNS) {
    const match = tail.match(re);
    const value = match ? Number.parseFloat(match[1]) : undefined;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      usage.costUsd = value;
      usage.source = usage.source ? `${usage.source}+${source}` : source;
      break;
    }
  }

  return usage;
}

export interface UsageTotal {
  /** Summed from the sessions that reported. Null when none did. */
  tokens: number | null;
  costUsd: number | null;
  /** How many sessions reported nothing, so the total can be read honestly. */
  unreported: number;
  reported: number;
}

/**
 * Adds up what is known, and says what is not.
 *
 * Never presents a partial sum as a total without the count beside it: "1.2M
 * tokens" from half the sessions is the most quotable and least true number
 * on a screen.
 */
export function totalUsage(usages: SessionUsage[]): UsageTotal {
  const withTokens = usages.filter((usage) => typeof usage.tokens === "number");
  const withCost = usages.filter((usage) => typeof usage.costUsd === "number");
  return {
    tokens: withTokens.length ? withTokens.reduce((sum, usage) => sum + (usage.tokens ?? 0), 0) : null,
    costUsd: withCost.length
      ? Number(withCost.reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0).toFixed(4))
      : null,
    unreported: usages.length - withTokens.length,
    reported: withTokens.length,
  };
}

/** A token count as a person would say it. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1000)}k`;
  return String(tokens);
}

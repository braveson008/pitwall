/** The CLIs a pair can use as its reviewer: the ones with an enforced read-only mode. */
export const PAIR_REVIEWERS = ["hermes", "claude", "codex"] as const;

export type PairReviewer = (typeof PAIR_REVIEWERS)[number];

const LABELS: Record<PairReviewer, string> = { claude: "Claude", codex: "Codex", hermes: "Hermes" };

/** A stored reviewer, read leniently: anything unknown is the original default. */
export function toPairReviewer(value: string | undefined): PairReviewer {
  return (PAIR_REVIEWERS as readonly string[]).includes(String(value)) ? (value as PairReviewer) : "claude";
}

export function pairReviewerLabel(value: string | undefined): string {
  return LABELS[toPairReviewer(value)];
}

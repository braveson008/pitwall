import type { CouncilEvidence, CouncilRelayMember } from "./councilRelay";

/**
 * The check nobody in the council is allowed to skip.
 *
 * A council currently ends one of two ways: a member writes `RELAY-COMPLETE`,
 * or the conductor decides the work is done. Both are participants. The
 * conductor has been routing this task for twenty turns and has every reason to
 * believe it went well; the member declaring completion is the one who just did
 * the work. Neither is an independent opinion, so a council that converges
 * confidently on the wrong thing has no way to find out.
 *
 * The gate re-reads the *original* brief against the *final* diff and answers
 * one question: does this do what was asked? It is deliberately narrow — it
 * does not review style, suggest improvements, or propose follow-up work, all
 * of which the council has already had many turns to do. It looks for the gap
 * between what was requested and what exists.
 *
 * ## Why the verdict is parsed, not inferred
 *
 * Same reasoning as the debate stances and the voice loop's yes/no: a fixed
 * marker that fails toward "not verified" beats asking a model to interpret
 * prose. A gate that can be talked past by an enthusiastic summary is not a
 * gate.
 */

export const VERIFIED_MARKER = "VERIFIED";
export const NOT_VERIFIED_MARKER = "NOT-VERIFIED";

/** How many times a run may fail verification before it stops asking. */
export const MAX_VERIFICATION_ROUNDS = 2;

export type VerificationVerdict = {
  verified: boolean;
  /** What is missing, when it is not verified. Empty on a pass. */
  gaps: string[];
  /** The verifier's one-line summary, for the thread and the council bar. */
  summary: string;
};

const firstMeaningfulLine = (content: string) =>
  content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";

/**
 * Read the verifier's answer.
 *
 * Anything that is not an explicit `VERIFIED` is treated as not verified,
 * including an empty file or a friendly paragraph with no marker. The
 * asymmetry is the point: a missing verdict must never read as a pass.
 */
export function parseVerificationVerdict(content: string): VerificationVerdict {
  const line = firstMeaningfulLine(content);
  const body = content.split("\n").slice(1);

  // Gaps are the bulleted lines under the verdict; prose is kept as summary.
  const gaps = body
    .map((entry) => entry.trim())
    .filter((entry) => /^[-*•]\s+/.test(entry))
    .map((entry) => entry.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);

  if (new RegExp(`^#*\\s*${VERIFIED_MARKER}\\b`, "i").test(line) &&
      !new RegExp(`^#*\\s*${NOT_VERIFIED_MARKER}\\b`, "i").test(line)) {
    return { verified: true, gaps: [], summary: line.replace(/^#*\s*/, "") };
  }

  return {
    verified: false,
    gaps,
    summary: line ? line.replace(/^#*\s*/, "") : "The verifier returned nothing.",
  };
}

/**
 * Who should verify.
 *
 * The member that did the most recent work cannot check it — that is the
 * self-assessment the gate exists to replace. Anything else on the roster will
 * do; a reviewing role is preferred where one exists, because its role prompt
 * already points it at the right question.
 */
export function chooseVerifier(
  members: CouncilRelayMember[],
  excludeMemberId: string | undefined,
): CouncilRelayMember | null {
  const eligible = members.filter((member) => member.memberId !== excludeMemberId);
  if (!eligible.length) return null;
  const reviewer = eligible.find((member) => /review|qa|test|critic/i.test(member.roleLabel));
  return reviewer ?? eligible[0];
}

/**
 * The verifier's brief.
 *
 * It gets the original task rather than the thread's summary of it, because the
 * whole point is to check the work against what was actually asked — and twenty
 * turns of a council restating a goal is exactly how the goal drifts.
 */
export function buildVerificationPrompt({
  task,
  member,
  evidence,
  threadFile,
  verdictFile,
  attempt,
}: {
  task: { title: string; description?: string };
  member: CouncilRelayMember;
  evidence: CouncilEvidence | null;
  threadFile: string;
  verdictFile: string;
  attempt: number;
}): string {
  const changed = evidence?.dirtyPaths?.length
    ? ` The working tree currently differs from HEAD in: ${evidence.dirtyPaths.slice(0, 40).join(", ")}.`
    : " The working tree has no changes against HEAD, which is itself worth explaining.";
  const tests = evidence?.tests
    ? ` The project's tests were last run with \`${evidence.tests.command}\` and ${evidence.tests.passed ? "passed" : "FAILED"}.`
    : "";
  const again = attempt > 1
    ? ` This is verification attempt ${attempt}: the council has already been sent back once, so check specifically whether the gaps raised then were closed.`
    : "";

  return (
    `${member.rolePrompt} The council believes this task is finished and you are the last check before it stops. ` +
    `Verify against the original request, not against the council's account of it.\n\n` +
    `## The task as it was given\n${task.title}${task.description ? `\n\n${task.description}` : ""}\n\n` +
    `## What to do\n` +
    `Read the diff and the code as it now stands.${changed}${tests}${again} ` +
    `The council thread is at ${threadFile} if you need the history, but the code is the evidence — a handoff claiming something was done is not proof that it was.\n\n` +
    `Answer one question only: does the work as it exists satisfy what was asked? ` +
    `Do not review style, suggest improvements, or propose follow-up work — the council has had many turns for that. Look for the gap between what was requested and what exists.\n\n` +
    `## Your answer\n` +
    `Write to ${verdictFile}. Make the first line \`${VERIFIED_MARKER}\` if the work genuinely does what was asked, ` +
    `or \`${NOT_VERIFIED_MARKER}\` if anything requested is missing, incomplete, or broken. ` +
    `If it is not verified, list each gap as a bullet on its own line — those go straight back to the council as its next instruction, so write them as things to do, not as observations.`
  );
}

/** The directive handed back to the council when verification fails. */
export function buildRemediationDirective(verdict: VerificationVerdict): string {
  if (!verdict.gaps.length) {
    return `Verification failed: ${verdict.summary}. Close that gap before declaring the work complete again.`;
  }
  return (
    `Verification failed. These were requested and are still missing or broken — close them before declaring the work complete again: ` +
    verdict.gaps.map((gap, index) => `(${index + 1}) ${gap}`).join("; ")
  );
}

/** A line for the council bar, so the gate's outcome is visible without opening the thread. */
export function summariseVerification(verdict: VerificationVerdict | null, attempt: number): string {
  if (!verdict) return `Verifying (attempt ${attempt})…`;
  if (verdict.verified) return "Verified against the original task";
  return verdict.gaps.length
    ? `Not verified · ${verdict.gaps.length} gap${verdict.gaps.length === 1 ? "" : "s"}`
    : "Not verified";
}

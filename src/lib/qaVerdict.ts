import type { FixContract, ImplementationContract, QaReport } from "../domain/contracts";

/**
 * Reading a reviewer's answer, without asking it to be interpreted.
 *
 * The same reasoning as the council's verification gate and the voice loop's
 * yes/no: a fixed marker that fails toward the safe answer beats asking a
 * model to judge the tone of another model's prose. A reviewer that writes
 * three paragraphs of praise and one buried objection must not be read as a
 * pass, and no amount of enthusiasm should be able to produce one.
 *
 * So the verdict is parsed from a marker, and anything unparseable is a
 * failure. A gate that opens when it cannot understand the answer is not a
 * gate.
 */

const LINE = /^([A-Z-]+)\s*:\s*(.*)$/;

/** Everything the reviewer said, before it becomes a report. */
export interface ParsedVerdict {
  verdict: "pass" | "fail";
  criticalIssues: string[];
  warnings: string[];
  criteria: Array<{ criterion: string; met: boolean; note: string }>;
  contractWrong: boolean;
  fixes: string[];
  /** True when nothing could be read out of the answer at all. */
  unreadable: boolean;
}

const isNone = (value: string) => !value.trim() || /^(none|n\/a|nothing)\b/i.test(value.trim());

/**
 * Reads the reviewer's answer.
 *
 * Tolerant about shape — a model will bullet a list one time and number it
 * the next — and strict about the verdict, which is the one thing that must
 * not be inferred.
 */
export function parseVerdict(answer: string): ParsedVerdict {
  const empty: ParsedVerdict = {
    verdict: "fail",
    criticalIssues: [],
    warnings: [],
    criteria: [],
    contractWrong: false,
    fixes: [],
    unreadable: true,
  };
  if (!answer?.trim()) return empty;

  const sections = new Map<string, string[]>();
  let current = "";
  for (const raw of answer.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(LINE);
    if (header && ["VERDICT", "CRITICAL", "WARNINGS", "CRITERIA", "CONTRACT-WRONG", "FIX"].includes(header[1])) {
      current = header[1];
      sections.set(current, header[2].trim() ? [header[2].trim()] : []);
      continue;
    }
    if (!current || !line) continue;
    sections.get(current)?.push(line.replace(/^[-*\d.)\s]+/, "").trim());
  }

  const verdictText = (sections.get("VERDICT") ?? []).join(" ");
  if (!verdictText.trim()) return empty;

  // Only an explicit PASS passes. "Mostly passes", "PASS with caveats" and
  // anything else fails, because a caveat is a finding.
  const verdict: "pass" | "fail" = /^\s*pass\s*$/i.test(verdictText.trim()) ? "pass" : "fail";

  const list = (key: string) => (sections.get(key) ?? []).filter((line) => line && !isNone(line));

  const criteria = (sections.get("CRITERIA") ?? [])
    .filter(Boolean)
    .map((line) => {
      const met = /\bmet\b/i.test(line) && !/\bnot met\b/i.test(line);
      const [criterion, ...rest] = line.split(/\s*[—:-]\s*/);
      return { criterion: criterion.trim(), met, note: rest.join(" ").trim() };
    })
    .filter((entry) => entry.criterion);

  const contractWrongText = (sections.get("CONTRACT-WRONG") ?? []).join(" ");

  return {
    verdict,
    criticalIssues: list("CRITICAL"),
    warnings: list("WARNINGS"),
    criteria,
    contractWrong: /\byes\b/i.test(contractWrongText),
    fixes: list("FIX"),
    unreadable: false,
  };
}

/**
 * A verdict that claims to pass while listing things that must be fixed is
 * not a pass.
 *
 * The failure this exists for: a reviewer writes PASS out of politeness and
 * then describes two bugs. Believing the marker over its own findings is how
 * a loop converges confidently on the wrong thing — the exact failure the
 * independent review was added to catch.
 */
export function reconcile(parsed: ParsedVerdict): ParsedVerdict {
  const contradicted = parsed.verdict === "pass" && (parsed.criticalIssues.length > 0 || parsed.criteria.some((entry) => !entry.met));
  return contradicted ? { ...parsed, verdict: "fail" } : parsed;
}

export function toReport({
  parsed,
  contractId,
  qaModel,
  qaProvider,
  id,
  createdAt,
}: {
  parsed: ParsedVerdict;
  contractId: string;
  qaModel: string;
  qaProvider: QaReport["qaProvider"];
  id: string;
  createdAt: string;
}): QaReport {
  const settled = reconcile(parsed);
  return {
    id,
    contractId,
    verdict: settled.verdict,
    criticalIssues: settled.criticalIssues,
    warnings: settled.warnings,
    acceptanceCriteriaResults: settled.criteria,
    requiresArchitectEscalation: settled.contractWrong,
    qaModel,
    qaProvider,
    createdAt,
  };
}

/**
 * Turns a rejection into the smallest brief that could answer it.
 *
 * Carries the constraints and the criteria from the parent, because a fix
 * that breaks a constraint is not a fix — and nothing else, because resending
 * the contract would cost as much as the first implementation to communicate
 * a subset of it.
 */
export function toFixContract({
  report,
  contract,
  id,
  createdAt,
}: {
  report: QaReport;
  contract: ImplementationContract;
  id: string;
  createdAt: string;
}): FixContract {
  return {
    id,
    parentContractId: contract.id,
    reportId: report.id,
    issuesToFix: report.criticalIssues,
    filesLikelyAffected: contract.affectedFiles,
    requiredChanges: report.criticalIssues,
    constraints: contract.constraints,
    // Only the criteria that failed: the ones already met are not what this
    // round is about.
    acceptanceCriteria: report.acceptanceCriteriaResults.filter((entry) => !entry.met).map((entry) => entry.criterion),
    createdAt,
  };
}

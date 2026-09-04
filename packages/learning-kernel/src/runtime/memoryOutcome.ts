/** The scheduler-facing interpretation of one protocol-valid evaluation. */
export const memoryOutcomeGrades = Object.freeze([
  "again",
  "hard",
  "good",
  "easy",
] as const);

export type MemoryOutcomeGrade = typeof memoryOutcomeGrades[number];

export type MemoryOutcomeBasis =
  | "independent_retrieval"
  | "transfer_confirmed"
  | "retrieval_failed"
  | "learner_rated";

export type MemoryOutcomeEvidenceLevel =
  | "non_evidentiary"
  | "self_report"
  | "behavioral"
  | "externally_attested";

export type GradedMemoryOutcome = Readonly<{
  basis: MemoryOutcomeBasis;
  grade: MemoryOutcomeGrade;
  evidenceLevel: MemoryOutcomeEvidenceLevel;
  evidenceIds: readonly string[];
}>;

/** Relearning is a protocol choice triggered by forgetting, not by success difficulty. */
export function memoryOutcomeExposesForgetting(
  outcome: Pick<GradedMemoryOutcome, "grade">,
): boolean {
  return outcome.grade === "again";
}

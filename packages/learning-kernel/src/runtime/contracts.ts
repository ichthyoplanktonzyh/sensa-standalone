import type { MemoryOutcomeKind, ReviewRating } from "./browserSafe.js";
import type {
  SensaMemoryOutcomeDecision,
  SensaMemoryOutcomeDecisionCode,
  SensaStopPolicyCompletionDecisionCode,
} from "./completionPolicy.js";
import type {
  CanonicalObjectPayload,
  LearningAction,
  SensaAcquisitionPrimitive,
  SensaMasteryDimension,
  SensaPlanningTimeZoneSource,
  SensaScaffoldLevel,
  SensaSemanticStateSnapshot,
} from "./browserSafe.js";

export type {
  CanonicalObjectPayload,
  LearningAction,
  LearningAssetReference,
  SensaAcquisitionPrimitive,
  SensaEncounterStatus,
  SensaMasteryDimension,
  SensaPlanningTimeZoneSource,
  SensaRendererKind,
  SensaScaffoldLevel,
} from "./browserSafe.js";

export type PlanNextEncounterInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  studyPlanId: string;
  learningSessionId: string;
  timeZone?: string;
  now: Date;
}>;

export type PlannedEncounter = Readonly<{
  kind: "planned_encounter";
  encounterId: string;
  learningSessionId: string;
  studyPlanId: string;
  senseId: string;
  senseVersionId: string;
  contentReleaseId: string;
  bookVersionId: string;
  reason: "new" | "due";
  status: "planned" | "active";
  plannedAt: Date;
  plannedLocalDate: string;
  planningTimeZone: string;
  planningTimeZoneSource: SensaPlanningTimeZoneSource;
  capabilityResolverVersion: "sensa-executable-learning-capability-resolver-v1";
  semanticPolicyVersion: "sensa-semantic-policy-v2";
  stopPolicyVersion: "sensa-stop-policy-v2";
  evidenceRuleVersion: "sensa-evidence-rule-v2";
  stateUpdaterVersion: "sensa-state-updater-v2";
  outcomeMappingVersion: "sensa-memory-outcome-v3";
}>;

export type NoCandidate = Readonly<{
  kind: "no_candidate";
  reason:
    | "no_eligible_sense"
    | "plan_unavailable"
    | "daily_new_target_reached";
}>;

export interface SessionPlanningModule {
  planNext(
    input: PlanNextEncounterInput,
  ): Promise<PlannedEncounter | NoCandidate>;
}

export type OpenEncounterInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  encounterId: string;
}>;

export type SubmitAttemptInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  encounterId: string;
  learningActionId: string;
  attemptId: string;
  ordinal: number;
  sourceReplicaId: string;
  responseSchemaVersion: string;
  responsePayload: CanonicalObjectPayload;
  durationMs: number | null;
  occurredAt: Date;
}>;

export type InterruptEncounterInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  encounterId: string;
  status: "interrupted" | "cancelled";
}>;

export type SenseMemoryState = Readonly<{
  senseMemoryStateId: string;
  workspaceId: string;
  learnerUserId: string;
  senseId: string;
  dueAt: Date | null;
  reps: number;
  lapses: number;
  fsrsCardState: "new" | "learning" | "review" | "relearning";
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: Date | null;
  fsrsScheduledDays: number | null;
  revision: number;
  lastMemoryOutcomeId: string;
  updatedAt: Date;
}>;

export type MemoryOutcomeSnapshot = Readonly<{
  memoryOutcomeId: string;
  workspaceId: string;
  learnerUserId: string;
  senseId: string;
  senseEncounterId: string;
  outcomeKind: MemoryOutcomeKind;
  decisionCode: SensaMemoryOutcomeDecisionCode;
  outcomeMappingVersion: "sensa-memory-outcome-v3";
  scheduleDisposition: "acquisition_pending" | "fsrs_applied";
  fsrsRating: ReviewRating | null;
  observedCompletedAt: Date;
  effectiveReviewedAt: Date | null;
  reviewTimeClamped: boolean;
  reviewTimeClampReason: "previous_accepted_review_time" | null;
  priorMemoryRevision: number;
  resultingMemoryRevision: number;
  fsrsAdapterVersion: "sensa-fsrs-adapter-v2" | null;
  schedulerSettingsDigest: string | null;
  createdAt: Date;
}>;

export type ApplyMemoryOutcomeInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  senseEncounterId: string;
  decision: SensaMemoryOutcomeDecision;
  observedCompletedAt: Date;
}>;

export type ApplyMemoryOutcomeResult = Readonly<{
  status: "applied" | "replayed";
  rebased: boolean;
  memoryOutcome: MemoryOutcomeSnapshot;
  memoryState: SenseMemoryState;
}>;

export interface MemoryOutcomeModule {
  applyMemoryOutcome(
    input: ApplyMemoryOutcomeInput,
  ): Promise<ApplyMemoryOutcomeResult>;
}

export type NextLearningAction = Readonly<{
  kind: "next_action";
  encounterId: string;
  action: LearningAction;
}>;

export type CompletedEncounter = Readonly<{
  kind: "completed";
  encounterId: string;
  stopDecisionCode: SensaStopPolicyCompletionDecisionCode;
  memoryOutcome: MemoryOutcomeSnapshot;
  memoryState: SenseMemoryState;
  semanticState: SensaSemanticStateSnapshot;
}>;

export type EncounterStep = NextLearningAction | CompletedEncounter;

export type InterruptedEncounter = Readonly<{
  kind: "interrupted";
  encounterId: string;
  status: "interrupted" | "cancelled";
}>;

export interface EncounterModule {
  open(input: OpenEncounterInput): Promise<EncounterStep>;
  submitAttempt(input: SubmitAttemptInput): Promise<EncounterStep>;
  interrupt(input: InterruptEncounterInput): Promise<InterruptedEncounter>;
}

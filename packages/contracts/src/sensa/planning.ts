import type { SensaPlanningTimeZoneSource } from "@sensa/learning-kernel";

export const sensaPlanningContractVersion = "sensa-planning-v2" as const;

export type SensaPlanningMode = "mixed" | "due_only";

export type SensaStudyPlanStatus =
  | "active"
  | "paused"
  | "completed"
  | "archived";

export type SensaLearningSessionStatus =
  | "active"
  | "completed"
  | "abandoned";

export type SensaStudyPlanSnapshot = Readonly<{
  studyPlanId: string;
  workspaceId: string;
  learnerUserId: string;
  bookVersionId: string;
  status: SensaStudyPlanStatus;
  dailyNewSenseTarget: number;
  revision: number;
  createdByReplicaId: string;
  createdAt: string;
  updatedAt: string;
  activatedAt: string;
  pausedAt: string | null;
  completedAt: string | null;
  archivedAt: string | null;
}>;

export type SensaLearningSessionSnapshot = Readonly<{
  learningSessionId: string;
  workspaceId: string;
  learnerUserId: string;
  studyPlanId: string;
  createdByReplicaId: string;
  status: SensaLearningSessionStatus;
  revision: number;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type SensaPlannedEncounterSnapshot = Readonly<{
  encounterId: string;
  learningSessionId: string;
  studyPlanId: string;
  senseId: string;
  senseVersionId: string;
  contentReleaseId: string;
  bookVersionId: string;
  sessionOrdinal: number;
  kind: "introduction" | "review";
  status: "planned" | "active";
  reason: "new" | "due";
  revision: number;
  capabilityResolverVersion: "sensa-executable-learning-capability-resolver-v1";
  semanticPolicyVersion: "sensa-semantic-policy-v2";
  stopPolicyVersion: "sensa-stop-policy-v2";
  evidenceRuleVersion: "sensa-evidence-rule-v2";
  stateUpdaterVersion: "sensa-state-updater-v2";
  outcomeMappingVersion: "sensa-memory-outcome-v3";
  plannedAt: string;
  plannedLocalDate: string;
  planningTimeZone: string;
  planningTimeZoneSource: SensaPlanningTimeZoneSource;
  openedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type SensaPlanNextResult = Readonly<
  | {
      kind: "planned_encounter";
      encounter: SensaPlannedEncounterSnapshot;
    }
  | {
      kind: "no_candidate";
      reason:
        | "no_eligible_sense"
        | "plan_unavailable"
        | "daily_new_target_reached";
    }
>;

export type CreateStudyPlanInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  studyPlanId: string;
  bookVersionId: string;
  dailyNewSenseTarget: number;
  replicaId: string;
  now: Date;
}>;

export type StartOrResumeLearningSessionInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  learningSessionId: string;
  studyPlanId: string;
  replicaId: string;
  now: Date;
}>;

export type PlanNextInput = Readonly<{
  workspaceId: string;
  learnerUserId: string;
  learningSessionId: string;
  studyPlanId: string;
  selectionMode: SensaPlanningMode;
  timeZone?: string;
  now: Date;
}>;

export type CreateStudyPlanResult = Readonly<{
  status: "created" | "replayed";
  studyPlan: SensaStudyPlanSnapshot;
}>;

export type StartOrResumeLearningSessionResult = Readonly<{
  status: "started" | "resumed";
  learningSession: SensaLearningSessionSnapshot;
}>;

export interface SensaPlanningModule {
  createStudyPlan(input: CreateStudyPlanInput): Promise<CreateStudyPlanResult>;
  startOrResumeLearningSession(
    input: StartOrResumeLearningSessionInput,
  ): Promise<StartOrResumeLearningSessionResult>;
  planNext(input: PlanNextInput): Promise<SensaPlanNextResult>;
}

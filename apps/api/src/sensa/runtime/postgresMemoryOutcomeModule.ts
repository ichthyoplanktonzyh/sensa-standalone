import { createHash, randomUUID } from "node:crypto";
import type { DatabaseExecutor } from "../../database/index.js";
import {
  computeReviewSchedule,
  createEmptyReviewableCardScheduleState,
  type FsrsCardState,
  type ReviewableCardScheduleState,
  type ReviewSchedule,
} from "@sensa/learning-kernel";
import {
  getWorkspaceSchedulerConfig,
  type WorkspaceSchedulerConfig,
} from "../../scheduling/workspaceSettings.js";
import {
  mapMemoryOutcomeToFsrsRating,
  isSensaMemoryOutcomeDecisionCode,
  memoryOutcomeDecisionMatchesKind,
  type MemoryOutcomeKind,
  type ReviewRating,
  sensaMemoryOutcomeMappingVersion,
} from "@sensa/learning-kernel";
import type {
  ApplyMemoryOutcomeInput,
  ApplyMemoryOutcomeResult,
  MemoryOutcomeModule,
  MemoryOutcomeSnapshot,
  SenseMemoryState,
} from "@sensa/learning-kernel";

export const sensaFsrsAdapterVersion = "sensa-fsrs-adapter-v2" as const;
export const sensaSchedulerSettingsDigestVersion =
  "sensa-scheduler-settings-digest-v1" as const;
export const sensaReviewTimeClampReason =
  "previous_accepted_review_time" as const;

type TimestampValue = Date | string;
type RevisionValue = number | string;

type EncounterRow = Readonly<{
  sense_encounter_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_id: string;
  status: string;
  outcome_mapping_version: string;
  memory_state_revision_at_open: RevisionValue;
}>;

type MemoryStateRow = Readonly<{
  sense_memory_state_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_id: string;
  due_at: TimestampValue | null;
  reps: number;
  lapses: number;
  fsrs_card_state: string;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: TimestampValue | null;
  fsrs_scheduled_days: number | null;
  revision: RevisionValue;
  last_memory_outcome_id: string | null;
  updated_at: TimestampValue;
}>;

type MemoryOutcomeRow = Readonly<{
  memory_outcome_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_id: string;
  sense_encounter_id: string;
  outcome_kind: string;
  decision_code: string;
  outcome_mapping_version: string;
  schedule_disposition: string;
  fsrs_rating: number | null;
  observed_completed_at: TimestampValue;
  effective_reviewed_at: TimestampValue | null;
  review_time_clamped: boolean;
  review_time_clamp_reason: string | null;
  prior_memory_revision: RevisionValue;
  resulting_memory_revision: RevisionValue;
  fsrs_adapter_version: string | null;
  scheduler_settings_digest: string | null;
  created_at: TimestampValue;
}>;

export type SensaMemoryOutcomeModuleErrorCode =
  | "invalid_input"
  | "encounter_not_found"
  | "encounter_scope_mismatch"
  | "encounter_not_active"
  | "outcome_replay_conflict"
  | "runtime_data_corrupt"
  | "schedule_conflict";

export class SensaMemoryOutcomeModuleError extends Error {
  readonly code: SensaMemoryOutcomeModuleErrorCode;

  constructor(code: SensaMemoryOutcomeModuleErrorCode, message: string) {
    super(message);
    this.name = "SensaMemoryOutcomeModuleError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function createAdapterError(
  code: SensaMemoryOutcomeModuleErrorCode,
  message: string,
): SensaMemoryOutcomeModuleError {
  return new SensaMemoryOutcomeModuleError(code, message);
}

function requireNonEmpty(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw createAdapterError(
      "invalid_input",
      `${fieldName} must be a non-empty string`,
    );
  }
}

function requireDate(value: Date, fieldName: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw createAdapterError(
      "invalid_input",
      `${fieldName} must be a valid Date`,
    );
  }

  return new Date(value.getTime());
}

function toDate(value: TimestampValue, fieldName: string): Date {
  const date = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw createAdapterError(
      "runtime_data_corrupt",
      `${fieldName} is not a valid timestamp`,
    );
  }

  return date;
}

function toNullableDate(
  value: TimestampValue | null,
  fieldName: string,
): Date | null {
  return value === null ? null : toDate(value, fieldName);
}

function toSafeInteger(
  value: RevisionValue | number,
  fieldName: string,
): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numberValue)) {
    throw createAdapterError(
      "runtime_data_corrupt",
      `${fieldName} must be a safe integer`,
    );
  }

  return numberValue;
}

function parseFsrsCardState(value: string, fieldName: string): FsrsCardState {
  switch (value) {
    case "new":
    case "learning":
    case "review":
    case "relearning":
      return value;
    default:
      throw createAdapterError(
        "runtime_data_corrupt",
        `${fieldName} has an unsupported FSRS state`,
      );
  }
}

function parseMemoryOutcomeKind(
  value: string,
  fieldName: string,
): MemoryOutcomeKind {
  switch (value) {
    case "introduced":
    case "retrieval_failed":
    case "supported_retrieval":
    case "independent_retrieval":
    case "transfer_confirmed":
      return value;
    default:
      throw createAdapterError(
        "runtime_data_corrupt",
        `${fieldName} has an unsupported Memory Outcome kind`,
      );
  }
}

function validateDigest(value: string, fieldName: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw createAdapterError(
      "runtime_data_corrupt",
      `${fieldName} is not a lowercase SHA-256 digest`,
    );
  }

  return value;
}

function validateFsrsShape(state: SenseMemoryState): void {
  if (state.fsrsCardState === "new") {
    if (
      state.dueAt !== null ||
      state.fsrsStepIndex !== null ||
      state.fsrsStability !== null ||
      state.fsrsDifficulty !== null ||
      state.fsrsLastReviewedAt !== null ||
      state.fsrsScheduledDays !== null
    ) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "New Sense Memory State contains non-new FSRS values",
      );
    }
    return;
  }

  if (
    state.fsrsStability === null ||
    state.fsrsDifficulty === null ||
    state.fsrsLastReviewedAt === null ||
    state.fsrsScheduledDays === null
  ) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Non-new Sense Memory State is missing FSRS values",
    );
  }

  if (state.fsrsCardState === "review" && state.fsrsStepIndex !== null) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Review Sense Memory State has an FSRS step",
    );
  }

  if (
    (state.fsrsCardState === "learning" ||
      state.fsrsCardState === "relearning") &&
    state.fsrsStepIndex === null
  ) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Learning Sense Memory State is missing an FSRS step",
    );
  }
}

function mapMemoryStateRow(row: MemoryStateRow): SenseMemoryState {
  if (row.last_memory_outcome_id === null) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Sense Memory State has no last Memory Outcome",
    );
  }

  const state: SenseMemoryState = {
    senseMemoryStateId: row.sense_memory_state_id,
    workspaceId: row.workspace_id,
    learnerUserId: row.learner_user_id,
    senseId: row.sense_id,
    dueAt: toNullableDate(row.due_at, "sense_memory_states.due_at"),
    reps: toSafeInteger(row.reps, "sense_memory_states.reps"),
    lapses: toSafeInteger(row.lapses, "sense_memory_states.lapses"),
    fsrsCardState: parseFsrsCardState(
      row.fsrs_card_state,
      "sense_memory_states.fsrs_card_state",
    ),
    fsrsStepIndex: row.fsrs_step_index,
    fsrsStability: row.fsrs_stability,
    fsrsDifficulty: row.fsrs_difficulty,
    fsrsLastReviewedAt: toNullableDate(
      row.fsrs_last_reviewed_at,
      "sense_memory_states.fsrs_last_reviewed_at",
    ),
    fsrsScheduledDays: row.fsrs_scheduled_days,
    revision: toSafeInteger(row.revision, "sense_memory_states.revision"),
    lastMemoryOutcomeId: row.last_memory_outcome_id,
    updatedAt: toDate(row.updated_at, "sense_memory_states.updated_at"),
  };

  if (state.revision <= 0 || state.reps < 0 || state.lapses < 0) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Sense Memory State has invalid counters or revision",
    );
  }

  validateFsrsShape(state);
  return state;
}

function mapMemoryStateToFsrsInput(
  senseId: string,
  row: MemoryStateRow | undefined,
): ReviewableCardScheduleState {
  if (row === undefined) {
    return createEmptyReviewableCardScheduleState(senseId);
  }

  const state = mapMemoryStateRow(row);
  return {
    cardId: senseId,
    reps: state.reps,
    lapses: state.lapses,
    fsrsCardState: state.fsrsCardState,
    fsrsStepIndex: state.fsrsStepIndex,
    fsrsStability: state.fsrsStability,
    fsrsDifficulty: state.fsrsDifficulty,
    fsrsLastReviewedAt: state.fsrsLastReviewedAt,
    fsrsScheduledDays: state.fsrsScheduledDays,
  };
}

function mapReviewScheduleToStateValues(schedule: ReviewSchedule): Readonly<{
  dueAt: Date | null;
  reps: number;
  lapses: number;
  fsrsCardState: FsrsCardState;
  fsrsStepIndex: number | null;
  fsrsStability: number | null;
  fsrsDifficulty: number | null;
  fsrsLastReviewedAt: Date | null;
  fsrsScheduledDays: number | null;
}> {
  return {
    dueAt: schedule.dueAt,
    reps: schedule.reps,
    lapses: schedule.lapses,
    fsrsCardState: schedule.fsrsCardState,
    fsrsStepIndex: schedule.fsrsStepIndex,
    fsrsStability: schedule.fsrsStability,
    fsrsDifficulty: schedule.fsrsDifficulty,
    fsrsLastReviewedAt: schedule.fsrsLastReviewedAt,
    fsrsScheduledDays: schedule.fsrsScheduledDays,
  };
}

function createAcquisitionPendingStateValues(): ReturnType<
  typeof mapReviewScheduleToStateValues
> {
  return {
    dueAt: null,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
  };
}

function normalizeDigestNumber(value: number, fieldName: string): string {
  if (!Number.isFinite(value)) {
    throw createAdapterError(
      "runtime_data_corrupt",
      `${fieldName} is not finite`,
    );
  }

  return value.toString();
}

function createSchedulerSettingsDigest(
  settings: WorkspaceSchedulerConfig,
): string {
  const canonical = [
    `version=${sensaSchedulerSettingsDigestVersion}`,
    `algorithm=${settings.algorithm}`,
    `desiredRetention=${
      normalizeDigestNumber(settings.desiredRetention, "desiredRetention")
    }`,
    `learningStepsMinutes=${
      settings.learningStepsMinutes.map((value) =>
        normalizeDigestNumber(value, "learningStepsMinutes")
      ).join(",")
    }`,
    `relearningStepsMinutes=${
      settings.relearningStepsMinutes.map((value) =>
        normalizeDigestNumber(value, "relearningStepsMinutes")
      ).join(",")
    }`,
    `maximumIntervalDays=${
      normalizeDigestNumber(settings.maximumIntervalDays, "maximumIntervalDays")
    }`,
    `enableFuzz=${settings.enableFuzz ? "true" : "false"}`,
  ].join("\n");

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function createEffectiveReviewTime(
  observedCompletedAt: Date,
  previousAcceptedReviewTime: Date | null,
): Readonly<{
  effectiveReviewedAt: Date;
  reviewTimeClamped: boolean;
  reviewTimeClampReason: typeof sensaReviewTimeClampReason | null;
}> {
  if (
    previousAcceptedReviewTime !== null &&
    observedCompletedAt.getTime() < previousAcceptedReviewTime.getTime()
  ) {
    const effectiveTime = previousAcceptedReviewTime.getTime() + 1;
    const effectiveReviewedAt = new Date(effectiveTime);
    if (Number.isNaN(effectiveReviewedAt.getTime())) {
      throw createAdapterError(
        "invalid_input",
        "Observed completion time cannot be clamped safely",
      );
    }

    return {
      effectiveReviewedAt,
      reviewTimeClamped: true,
      reviewTimeClampReason: sensaReviewTimeClampReason,
    };
  }

  return {
    effectiveReviewedAt: observedCompletedAt,
    reviewTimeClamped: false,
    reviewTimeClampReason: null,
  };
}

function assertOutcomeTimeShape(
  row: MemoryOutcomeRow,
  observed: Date,
  effective: Date,
): void {
  const reason = row.review_time_clamp_reason;
  if (!row.review_time_clamped) {
    if (reason !== null || effective.getTime() !== observed.getTime()) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "Stored Memory Outcome has an invalid unclamped time shape",
      );
    }
    return;
  }

  if (
    reason !== sensaReviewTimeClampReason ||
    effective.getTime() <= observed.getTime()
  ) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Stored Memory Outcome has an invalid clamped time shape",
    );
  }
}

function mapMemoryOutcomeRow(row: MemoryOutcomeRow): MemoryOutcomeSnapshot {
  const outcomeKind = parseMemoryOutcomeKind(
    row.outcome_kind,
    "memory_outcomes.outcome_kind",
  );
  const outcomeMappingVersion = row.outcome_mapping_version;
  if (outcomeMappingVersion !== sensaMemoryOutcomeMappingVersion) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Stored Memory Outcome uses an unsupported mapping version",
    );
  }
  if (!isSensaMemoryOutcomeDecisionCode(row.decision_code)
    || !memoryOutcomeDecisionMatchesKind(row.decision_code, outcomeKind)) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Stored Memory Outcome decision code does not match its kind",
    );
  }

  const observedCompletedAt = toDate(
    row.observed_completed_at,
    "memory_outcomes.observed_completed_at",
  );
  const priorMemoryRevision = toSafeInteger(
    row.prior_memory_revision,
    "memory_outcomes.prior_memory_revision",
  );
  const resultingMemoryRevision = toSafeInteger(
    row.resulting_memory_revision,
    "memory_outcomes.resulting_memory_revision",
  );
  if (
    priorMemoryRevision < 0 ||
    resultingMemoryRevision !== priorMemoryRevision + 1
  ) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Stored Memory Outcome has invalid revisions",
    );
  }

  const isAcquisitionPending =
    outcomeMappingVersion === sensaMemoryOutcomeMappingVersion &&
    outcomeKind === "introduced";
  let scheduleDisposition: MemoryOutcomeSnapshot["scheduleDisposition"];
  let fsrsRating: ReviewRating | null;
  let effectiveReviewedAt: Date | null;
  let fsrsAdapterVersion: MemoryOutcomeSnapshot["fsrsAdapterVersion"];
  let schedulerSettingsDigest: string | null;

  if (isAcquisitionPending) {
    if (
      row.schedule_disposition !== "acquisition_pending" ||
      row.fsrs_rating !== null ||
      row.effective_reviewed_at !== null ||
      row.review_time_clamped ||
      row.review_time_clamp_reason !== null ||
      row.fsrs_adapter_version !== null ||
      row.scheduler_settings_digest !== null
    ) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "Stored acquisition-pending Outcome contains an FSRS result",
      );
    }
    scheduleDisposition = "acquisition_pending";
    fsrsRating = null;
    effectiveReviewedAt = null;
    fsrsAdapterVersion = null;
    schedulerSettingsDigest = null;
  } else {
    const expectedRating = mapMemoryOutcomeToFsrsRating(outcomeKind);
    if (
      expectedRating === null ||
      row.schedule_disposition !== "fsrs_applied" ||
      row.fsrs_rating !== expectedRating
    ) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "Stored scheduled Memory Outcome rating does not match its kind",
      );
    }
    if (row.fsrs_adapter_version !== sensaFsrsAdapterVersion) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "Stored Memory Outcome uses an unsupported FSRS Adapter version",
      );
    }
    if (
      row.effective_reviewed_at === null ||
      row.scheduler_settings_digest === null
    ) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "Stored scheduled Memory Outcome is missing its FSRS result",
      );
    }
    effectiveReviewedAt = toDate(
      row.effective_reviewed_at,
      "memory_outcomes.effective_reviewed_at",
    );
    assertOutcomeTimeShape(row, observedCompletedAt, effectiveReviewedAt);
    scheduleDisposition = "fsrs_applied";
    fsrsRating = expectedRating;
    fsrsAdapterVersion = sensaFsrsAdapterVersion;
    schedulerSettingsDigest = validateDigest(
      row.scheduler_settings_digest,
      "memory_outcomes.scheduler_settings_digest",
    );
  }

  return {
    memoryOutcomeId: row.memory_outcome_id,
    workspaceId: row.workspace_id,
    learnerUserId: row.learner_user_id,
    senseId: row.sense_id,
    senseEncounterId: row.sense_encounter_id,
    outcomeKind,
    decisionCode: row.decision_code,
    outcomeMappingVersion,
    scheduleDisposition,
    fsrsRating,
    observedCompletedAt,
    effectiveReviewedAt,
    reviewTimeClamped: row.review_time_clamped,
    reviewTimeClampReason: row.review_time_clamp_reason === null
      ? null
      : sensaReviewTimeClampReason,
    priorMemoryRevision,
    resultingMemoryRevision,
    fsrsAdapterVersion,
    schedulerSettingsDigest,
    createdAt: toDate(row.created_at, "memory_outcomes.created_at"),
  };
}

async function loadEncounterForUpdate(
  executor: DatabaseExecutor,
  input: ApplyMemoryOutcomeInput,
): Promise<Readonly<{ row: EncounterRow; memoryStateRevisionAtOpen: number }>> {
  const result = await executor.query<EncounterRow>(
    [
      "SELECT sense_encounter_id, workspace_id, learner_user_id, sense_id, status,",
      "outcome_mapping_version, memory_state_revision_at_open",
      "FROM sensa.sense_encounters",
      "WHERE sense_encounter_id = $1",
      "FOR UPDATE",
    ].join(" "),
    [input.senseEncounterId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw createAdapterError(
      "encounter_not_found",
      `Sense Encounter ${input.senseEncounterId} was not found`,
    );
  }

  if (
    row.workspace_id !== input.workspaceId ||
    row.learner_user_id !== input.learnerUserId
  ) {
    throw createAdapterError(
      "encounter_scope_mismatch",
      "Sense Encounter scope does not match the completion input",
    );
  }
  if (row.outcome_mapping_version !== sensaMemoryOutcomeMappingVersion) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Sense Encounter uses an unsupported outcome mapping version",
    );
  }

  const memoryStateRevisionAtOpen = toSafeInteger(
    row.memory_state_revision_at_open,
    "sense_encounters.memory_state_revision_at_open",
  );
  if (memoryStateRevisionAtOpen < 0) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Sense Encounter has a negative open memory revision",
    );
  }

  return { row, memoryStateRevisionAtOpen };
}

async function loadExistingOutcome(
  executor: DatabaseExecutor,
  senseEncounterId: string,
): Promise<MemoryOutcomeRow | undefined> {
  const result = await executor.query<MemoryOutcomeRow>(
    [
      "SELECT memory_outcome_id, workspace_id, learner_user_id, sense_id, sense_encounter_id,",
      "outcome_kind, decision_code, outcome_mapping_version, schedule_disposition, fsrs_rating, observed_completed_at, effective_reviewed_at,",
      "review_time_clamped, review_time_clamp_reason, prior_memory_revision, resulting_memory_revision,",
      "fsrs_adapter_version, scheduler_settings_digest, created_at",
      "FROM sensa.memory_outcomes",
      "WHERE sense_encounter_id = $1",
      // The Encounter row is already locked by loadEncounterForUpdate. Memory
      // Outcomes are append-only, so the backend read path must not require
      // UPDATE privilege merely to check for an existing replay.
    ].join(" "),
    [senseEncounterId],
  );

  return result.rows[0];
}

async function loadOutcomeById(
  executor: DatabaseExecutor,
  memoryOutcomeId: string,
): Promise<MemoryOutcomeRow | undefined> {
  const result = await executor.query<MemoryOutcomeRow>(
    [
      "SELECT memory_outcome_id, workspace_id, learner_user_id, sense_id, sense_encounter_id,",
      "outcome_kind, decision_code, outcome_mapping_version, schedule_disposition, fsrs_rating, observed_completed_at, effective_reviewed_at,",
      "review_time_clamped, review_time_clamp_reason, prior_memory_revision, resulting_memory_revision,",
      "fsrs_adapter_version, scheduler_settings_digest, created_at",
      "FROM sensa.memory_outcomes",
      "WHERE memory_outcome_id = $1",
      "FOR SHARE",
    ].join(" "),
    [memoryOutcomeId],
  );

  return result.rows[0];
}

async function lockSenseMemoryState(
  executor: DatabaseExecutor,
  workspaceId: string,
  learnerUserId: string,
  senseId: string,
): Promise<void> {
  await executor.query(
    [
      "SELECT pg_catalog.pg_advisory_xact_lock(",
      "pg_catalog.hashtextextended($1::text || ':' || $2::text || ':' || $3::text, 0::bigint)",
      ")",
    ].join(" "),
    [workspaceId, learnerUserId, senseId],
  );
}

async function loadMemoryStateForUpdate(
  executor: DatabaseExecutor,
  workspaceId: string,
  learnerUserId: string,
  senseId: string,
): Promise<MemoryStateRow | undefined> {
  const result = await executor.query<MemoryStateRow>(
    [
      "SELECT sense_memory_state_id, workspace_id, learner_user_id, sense_id, due_at, reps, lapses,",
      "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at,",
      "fsrs_scheduled_days, revision, last_memory_outcome_id, updated_at",
      "FROM sensa.sense_memory_states",
      "WHERE workspace_id = $1 AND learner_user_id = $2 AND sense_id = $3",
      "FOR UPDATE",
    ].join(" "),
    [workspaceId, learnerUserId, senseId],
  );

  return result.rows[0];
}

function assertReplayInputMatchesStoredOutcome(
  input: ApplyMemoryOutcomeInput,
  row: MemoryOutcomeRow,
  storedOutcome: MemoryOutcomeSnapshot,
): void {
  if (
    row.workspace_id !== input.workspaceId ||
    row.learner_user_id !== input.learnerUserId ||
    row.sense_encounter_id !== input.senseEncounterId ||
    storedOutcome.outcomeKind !== input.decision.outcomeKind ||
    storedOutcome.decisionCode !== input.decision.decisionCode ||
    storedOutcome.observedCompletedAt.getTime() !==
      input.observedCompletedAt.getTime()
  ) {
    throw createAdapterError(
      "outcome_replay_conflict",
      "The Encounter already has a Memory Outcome with different scope, kind, or observed time",
    );
  }
}

async function createReplayResult(
  executor: DatabaseExecutor,
  input: ApplyMemoryOutcomeInput,
  encounter: Readonly<{
    senseId: string;
    memoryStateRevisionAtOpen: number;
  }>,
  row: MemoryOutcomeRow,
  stateRow: MemoryStateRow | undefined,
): Promise<ApplyMemoryOutcomeResult> {
  if (stateRow === undefined) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Existing Memory Outcome has no Memory State projection",
    );
  }

  const outcome = mapMemoryOutcomeRow(row);
  assertReplayInputMatchesStoredOutcome(input, row, outcome);
  const state = mapMemoryStateRow(stateRow);
  if (
    outcome.senseId !== encounter.senseId ||
    state.workspaceId !== input.workspaceId ||
    state.learnerUserId !== input.learnerUserId ||
    state.senseId !== encounter.senseId
  ) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Existing Memory Outcome and Memory State scope are inconsistent",
    );
  }

  if (state.revision < outcome.resultingMemoryRevision) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Current Memory State is older than the replayed Memory Outcome",
    );
  }

  if (state.revision === outcome.resultingMemoryRevision) {
    if (state.lastMemoryOutcomeId !== outcome.memoryOutcomeId) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "Current Memory State does not point to the replayed Memory Outcome",
      );
    }
  } else {
    const currentOutcomeRow = await loadOutcomeById(
      executor,
      state.lastMemoryOutcomeId,
    );
    if (currentOutcomeRow === undefined) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "Current Memory State points to a missing Memory Outcome",
      );
    }
    const currentOutcome = mapMemoryOutcomeRow(currentOutcomeRow);
    if (
      currentOutcome.workspaceId !== state.workspaceId ||
      currentOutcome.learnerUserId !== state.learnerUserId ||
      currentOutcome.senseId !== state.senseId ||
      currentOutcome.resultingMemoryRevision !== state.revision ||
      currentOutcome.priorMemoryRevision !== state.revision - 1 ||
      currentOutcome.memoryOutcomeId !== state.lastMemoryOutcomeId
    ) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "Current Memory State does not point to its authoritative Memory Outcome",
      );
    }
  }

  return {
    status: "replayed",
    rebased:
      outcome.priorMemoryRevision !== encounter.memoryStateRevisionAtOpen,
    memoryOutcome: outcome,
    memoryState: state,
  };
}

async function applyMemoryOutcomeInExecutor(
  executor: DatabaseExecutor,
  input: ApplyMemoryOutcomeInput,
): Promise<ApplyMemoryOutcomeResult> {
  requireNonEmpty(input.workspaceId, "workspaceId");
  requireNonEmpty(input.learnerUserId, "learnerUserId");
  requireNonEmpty(input.senseEncounterId, "senseEncounterId");
  const observedCompletedAt = requireDate(
    input.observedCompletedAt,
    "observedCompletedAt",
  );
  const encounter = await loadEncounterForUpdate(executor, input);
  const outcomeMappingVersion = encounter.row.outcome_mapping_version;
  const acquisitionPending =
    outcomeMappingVersion === sensaMemoryOutcomeMappingVersion &&
    input.decision.outcomeKind === "introduced";
  if (!memoryOutcomeDecisionMatchesKind(
    input.decision.decisionCode,
    input.decision.outcomeKind,
  )) {
    throw createAdapterError(
      "invalid_input",
      "Memory Outcome decision code does not match its kind",
    );
  }
  const outcomeRating = mapMemoryOutcomeToFsrsRating(input.decision.outcomeKind);
  const existingOutcome = await loadExistingOutcome(
    executor,
    input.senseEncounterId,
  );

  if (existingOutcome !== undefined) {
    if (
      encounter.row.status !== "active" && encounter.row.status !== "completed"
    ) {
      throw createAdapterError(
        "runtime_data_corrupt",
        `Sense Encounter ${input.senseEncounterId} has an Outcome in status ${encounter.row.status}`,
      );
    }
    const stateRow = await loadMemoryStateForUpdate(
      executor,
      input.workspaceId,
      input.learnerUserId,
      encounter.row.sense_id,
    );
    return createReplayResult(
      executor,
      input,
      {
        senseId: encounter.row.sense_id,
        memoryStateRevisionAtOpen: encounter.memoryStateRevisionAtOpen,
      },
      existingOutcome,
      stateRow,
    );
  }

  if (encounter.row.status !== "active") {
    throw createAdapterError(
      "encounter_not_active",
      `Sense Encounter ${input.senseEncounterId} is ${encounter.row.status} and has no Memory Outcome to replay`,
    );
  }

  await lockSenseMemoryState(
    executor,
    input.workspaceId,
    input.learnerUserId,
    encounter.row.sense_id,
  );
  const existingStateRow = await loadMemoryStateForUpdate(
    executor,
    input.workspaceId,
    input.learnerUserId,
    encounter.row.sense_id,
  );
  const existingState = existingStateRow === undefined
    ? null
    : mapMemoryStateRow(existingStateRow);
  const priorMemoryRevision = existingState?.revision ?? 0;
  if (priorMemoryRevision < encounter.memoryStateRevisionAtOpen) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Current Memory State revision is behind the Encounter open revision",
    );
  }
  const resultingMemoryRevision = priorMemoryRevision + 1;
  const rebased = priorMemoryRevision !== encounter.memoryStateRevisionAtOpen;
  let scheduleDisposition: MemoryOutcomeSnapshot["scheduleDisposition"];
  let effectiveReviewedAt: Date | null;
  let reviewTimeClamped: boolean;
  let reviewTimeClampReason: typeof sensaReviewTimeClampReason | null;
  let fsrsAdapterVersion: MemoryOutcomeSnapshot["fsrsAdapterVersion"];
  let schedulerSettingsDigest: string | null;
  let stateValues: ReturnType<typeof mapReviewScheduleToStateValues>;

  if (acquisitionPending) {
    if (existingStateRow !== undefined) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "An acquisition-pending introduction cannot replace an existing Sense Memory State",
      );
    }
    scheduleDisposition = "acquisition_pending";
    effectiveReviewedAt = null;
    reviewTimeClamped = false;
    reviewTimeClampReason = null;
    fsrsAdapterVersion = null;
    schedulerSettingsDigest = null;
    stateValues = createAcquisitionPendingStateValues();
  } else {
    if (outcomeRating === null) {
      throw createAdapterError(
        "runtime_data_corrupt",
        "A scheduled Memory Outcome has no FSRS rating",
      );
    }
    const schedulerConfig = await getWorkspaceSchedulerConfig(
      executor,
      input.workspaceId,
    );
    schedulerSettingsDigest = createSchedulerSettingsDigest(schedulerConfig);

    const effectiveReviewTime = createEffectiveReviewTime(
      observedCompletedAt,
      existingState?.fsrsLastReviewedAt ?? null,
    );
    const fsrsInput = mapMemoryStateToFsrsInput(
      encounter.row.sense_id,
      existingStateRow,
    );
    const schedule = computeReviewSchedule(
      fsrsInput,
      schedulerConfig,
      outcomeRating,
      effectiveReviewTime.effectiveReviewedAt,
    );
    scheduleDisposition = "fsrs_applied";
    effectiveReviewedAt = effectiveReviewTime.effectiveReviewedAt;
    reviewTimeClamped = effectiveReviewTime.reviewTimeClamped;
    reviewTimeClampReason = effectiveReviewTime.reviewTimeClampReason;
    fsrsAdapterVersion = sensaFsrsAdapterVersion;
    stateValues = mapReviewScheduleToStateValues(schedule);
  }

  const memoryOutcomeId = randomUUID();
  const outcomeResult = await executor.query<MemoryOutcomeRow>(
    [
      "INSERT INTO sensa.memory_outcomes (",
      "memory_outcome_id, workspace_id, learner_user_id, sense_id, sense_encounter_id,",
      "outcome_kind, decision_code, outcome_mapping_version, schedule_disposition, fsrs_rating, observed_completed_at, effective_reviewed_at,",
      "review_time_clamped, review_time_clamp_reason, prior_memory_revision, resulting_memory_revision,",
      "fsrs_adapter_version, scheduler_settings_digest",
      ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)",
      "RETURNING memory_outcome_id, workspace_id, learner_user_id, sense_id, sense_encounter_id,",
      "outcome_kind, decision_code, outcome_mapping_version, schedule_disposition, fsrs_rating, observed_completed_at, effective_reviewed_at,",
      "review_time_clamped, review_time_clamp_reason, prior_memory_revision, resulting_memory_revision,",
      "fsrs_adapter_version, scheduler_settings_digest, created_at",
    ].join(" "),
    [
      memoryOutcomeId,
      input.workspaceId,
      input.learnerUserId,
      encounter.row.sense_id,
      input.senseEncounterId,
      input.decision.outcomeKind,
      input.decision.decisionCode,
      outcomeMappingVersion,
      scheduleDisposition,
      outcomeRating,
      observedCompletedAt,
      effectiveReviewedAt,
      reviewTimeClamped,
      reviewTimeClampReason,
      priorMemoryRevision,
      resultingMemoryRevision,
      fsrsAdapterVersion,
      schedulerSettingsDigest,
    ],
  );
  const insertedOutcomeRow = outcomeResult.rows[0];
  if (insertedOutcomeRow === undefined) {
    throw createAdapterError(
      "schedule_conflict",
      "Memory Outcome insert did not return a row",
    );
  }
  const memoryOutcome = mapMemoryOutcomeRow(insertedOutcomeRow);
  if (
    memoryOutcome.memoryOutcomeId !== memoryOutcomeId ||
    memoryOutcome.priorMemoryRevision !== priorMemoryRevision ||
    memoryOutcome.resultingMemoryRevision !== resultingMemoryRevision
  ) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Inserted Memory Outcome returned unexpected identity or revision",
    );
  }

  let memoryStateRow: MemoryStateRow | undefined;
  if (existingStateRow === undefined) {
    const insertedStateResult = await executor.query<MemoryStateRow>(
      [
        "INSERT INTO sensa.sense_memory_states (",
        "sense_memory_state_id, workspace_id, learner_user_id, sense_id, due_at, reps, lapses,",
        "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at,",
        "fsrs_scheduled_days, revision, last_memory_outcome_id",
        ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
        "RETURNING sense_memory_state_id, workspace_id, learner_user_id, sense_id, due_at, reps, lapses,",
        "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at,",
        "fsrs_scheduled_days, revision, last_memory_outcome_id, updated_at",
      ].join(" "),
      [
        randomUUID(),
        input.workspaceId,
        input.learnerUserId,
        encounter.row.sense_id,
        stateValues.dueAt,
        stateValues.reps,
        stateValues.lapses,
        stateValues.fsrsCardState,
        stateValues.fsrsStepIndex,
        stateValues.fsrsStability,
        stateValues.fsrsDifficulty,
        stateValues.fsrsLastReviewedAt,
        stateValues.fsrsScheduledDays,
        resultingMemoryRevision,
        memoryOutcome.memoryOutcomeId,
      ],
    );
    memoryStateRow = insertedStateResult.rows[0];
  } else {
    const currentRevision = toSafeInteger(
      existingStateRow.revision,
      "sense_memory_states.revision",
    );
    const updatedStateResult = await executor.query<MemoryStateRow>(
      [
        "UPDATE sensa.sense_memory_states",
        "SET due_at = $1, reps = $2, lapses = $3, fsrs_card_state = $4, fsrs_step_index = $5,",
        "fsrs_stability = $6, fsrs_difficulty = $7, fsrs_last_reviewed_at = $8,",
        "fsrs_scheduled_days = $9, revision = $10, last_memory_outcome_id = $11, updated_at = now()",
        "WHERE sense_memory_state_id = $12 AND workspace_id = $13 AND learner_user_id = $14",
        "AND sense_id = $15 AND revision = $16",
        "RETURNING sense_memory_state_id, workspace_id, learner_user_id, sense_id, due_at, reps, lapses,",
        "fsrs_card_state, fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at,",
        "fsrs_scheduled_days, revision, last_memory_outcome_id, updated_at",
      ].join(" "),
      [
        stateValues.dueAt,
        stateValues.reps,
        stateValues.lapses,
        stateValues.fsrsCardState,
        stateValues.fsrsStepIndex,
        stateValues.fsrsStability,
        stateValues.fsrsDifficulty,
        stateValues.fsrsLastReviewedAt,
        stateValues.fsrsScheduledDays,
        resultingMemoryRevision,
        memoryOutcome.memoryOutcomeId,
        existingStateRow.sense_memory_state_id,
        input.workspaceId,
        input.learnerUserId,
        encounter.row.sense_id,
        currentRevision,
      ],
    );
    memoryStateRow = updatedStateResult.rows[0];
  }

  if (memoryStateRow === undefined) {
    throw createAdapterError(
      "schedule_conflict",
      "Sense Memory State update lost its locked revision; retry the completion",
    );
  }
  const memoryState = mapMemoryStateRow(memoryStateRow);
  if (
    memoryState.revision !== resultingMemoryRevision ||
    memoryState.lastMemoryOutcomeId !== memoryOutcome.memoryOutcomeId
  ) {
    throw createAdapterError(
      "runtime_data_corrupt",
      "Memory Outcome Module state update returned an unexpected revision",
    );
  }

  return {
    status: "applied",
    rebased,
    memoryOutcome,
    memoryState,
  };
}

export function createPostgresMemoryOutcomeModule(
  executor: DatabaseExecutor,
): MemoryOutcomeModule {
  return Object.freeze({
    applyMemoryOutcome: (
      input: ApplyMemoryOutcomeInput,
    ): Promise<ApplyMemoryOutcomeResult> => (
      applyMemoryOutcomeInExecutor(executor, input)
    ),
  });
}

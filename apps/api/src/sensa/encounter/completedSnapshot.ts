import type { DatabaseExecutor } from "../../database/index.js";
import { sensaFsrsAdapterVersion } from "../runtime/postgresMemoryOutcomeModule.js";
import {
  isSensaMemoryOutcomeDecisionCode,
  isSensaStopPolicyCompletionDecisionCode,
  mapMemoryOutcomeToFsrsRating,
  memoryOutcomeDecisionMatchesKind,
  sensaMemoryOutcomeVersion,
  stopCompletionDecisionMatchesOutcome,
} from "@sensa/learning-kernel";
import type {
  CompletedEncounter,
  MemoryOutcomeSnapshot,
  SenseMemoryState,
} from "@sensa/learning-kernel";
import { loadSemanticState } from "./semanticProjection.js";
import {
  encounterError as error,
  encounterQuery as query,
  toDate,
  toInteger,
} from "./support.js";

export type CompletedEncounterRow = Readonly<{
  sense_encounter_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_id: string;
  stop_policy_decision_code: string | null;
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
  observed_completed_at: Date | string;
  effective_reviewed_at: Date | string | null;
  review_time_clamped: boolean;
  review_time_clamp_reason: string | null;
  prior_memory_revision: number | string;
  resulting_memory_revision: number | string;
  fsrs_adapter_version: string | null;
  scheduler_settings_digest: string | null;
  created_at: Date | string;
}>;

type MemoryStateRow = Readonly<{
  sense_memory_state_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_id: string;
  due_at: Date | string | null;
  reps: number;
  lapses: number;
  fsrs_card_state: string;
  fsrs_step_index: number | null;
  fsrs_stability: number | null;
  fsrs_difficulty: number | null;
  fsrs_last_reviewed_at: Date | string | null;
  fsrs_scheduled_days: number | null;
  revision: number | string;
  last_memory_outcome_id: string;
  updated_at: Date | string;
}>;

function mapMemoryOutcome(row: MemoryOutcomeRow): MemoryOutcomeSnapshot {
  if (![
    "introduced",
    "retrieval_failed",
    "supported_retrieval",
    "independent_retrieval",
    "transfer_confirmed",
  ].includes(row.outcome_kind)) throw error("state_corrupt", "Memory Outcome uses an unsupported kind.", 500);
  if (row.outcome_mapping_version !== sensaMemoryOutcomeVersion) throw error("runtime_version_unsupported", "Memory Outcome uses an unsupported runtime version.", 409);
  const outcomeKind = row.outcome_kind as MemoryOutcomeSnapshot["outcomeKind"];
  if (!isSensaMemoryOutcomeDecisionCode(row.decision_code)
    || !memoryOutcomeDecisionMatchesKind(row.decision_code, outcomeKind)) {
    throw error("state_corrupt", "Memory Outcome decision code does not match its kind.", 500);
  }
  const acquisitionPending = outcomeKind === "introduced";
  const observed = toDate(row.observed_completed_at, "Memory Outcome observed time");
  const effective = toDate(row.effective_reviewed_at, "Memory Outcome effective time");
  if (observed === null) throw error("state_corrupt", "Memory Outcome observed timestamp is missing.", 500);
  const prior = toInteger(row.prior_memory_revision, "Memory Outcome prior revision");
  const resulting = toInteger(row.resulting_memory_revision, "Memory Outcome resulting revision");
  if (resulting !== prior + 1) throw error("state_corrupt", "Memory Outcome revisions are invalid.", 500);
  if (acquisitionPending) {
    if (row.schedule_disposition !== "acquisition_pending"
      || row.fsrs_rating !== null
      || effective !== null
      || row.review_time_clamped
      || row.review_time_clamp_reason !== null
      || row.fsrs_adapter_version !== null
      || row.scheduler_settings_digest !== null) {
      throw error("state_corrupt", "Acquisition-pending Outcome contains an FSRS result.", 500);
    }
  } else if (row.schedule_disposition !== "fsrs_applied"
    || row.fsrs_rating !== mapMemoryOutcomeToFsrsRating(outcomeKind)
    || effective === null
    || row.fsrs_adapter_version !== sensaFsrsAdapterVersion
    || row.scheduler_settings_digest === null
    || !/^[0-9a-f]{64}$/u.test(row.scheduler_settings_digest)) {
    throw error("state_corrupt", "Scheduled Memory Outcome is incomplete or invalid.", 500);
  }
  return {
    memoryOutcomeId: row.memory_outcome_id,
    workspaceId: row.workspace_id,
    learnerUserId: row.learner_user_id,
    senseId: row.sense_id,
    senseEncounterId: row.sense_encounter_id,
    outcomeKind,
    decisionCode: row.decision_code,
    outcomeMappingVersion: sensaMemoryOutcomeVersion,
    scheduleDisposition: acquisitionPending ? "acquisition_pending" : "fsrs_applied",
    fsrsRating: row.fsrs_rating as MemoryOutcomeSnapshot["fsrsRating"],
    observedCompletedAt: observed,
    effectiveReviewedAt: effective,
    reviewTimeClamped: row.review_time_clamped,
    reviewTimeClampReason: row.review_time_clamp_reason as MemoryOutcomeSnapshot["reviewTimeClampReason"],
    priorMemoryRevision: prior,
    resultingMemoryRevision: resulting,
    fsrsAdapterVersion: acquisitionPending ? null : sensaFsrsAdapterVersion,
    schedulerSettingsDigest: row.scheduler_settings_digest,
    createdAt: toDate(row.created_at, "Memory Outcome created time")!,
  };
}

function mapMemoryState(row: MemoryStateRow): SenseMemoryState {
  const dueAt = toDate(row.due_at, "Sense Memory State due time");
  const lastReviewed = toDate(row.fsrs_last_reviewed_at, "Sense Memory State review time");
  const updatedAt = toDate(row.updated_at, "Sense Memory State updated time");
  if (updatedAt === null) throw error("state_corrupt", "Sense Memory State updated time is missing.", 500);
  if (![
    "new",
    "learning",
    "review",
    "relearning",
  ].includes(row.fsrs_card_state)) throw error("state_corrupt", "Sense Memory State uses an unsupported FSRS state.", 500);
  return {
    senseMemoryStateId: row.sense_memory_state_id,
    workspaceId: row.workspace_id,
    learnerUserId: row.learner_user_id,
    senseId: row.sense_id,
    dueAt,
    reps: row.reps,
    lapses: row.lapses,
    fsrsCardState: row.fsrs_card_state as SenseMemoryState["fsrsCardState"],
    fsrsStepIndex: row.fsrs_step_index,
    fsrsStability: row.fsrs_stability,
    fsrsDifficulty: row.fsrs_difficulty,
    fsrsLastReviewedAt: lastReviewed,
    fsrsScheduledDays: row.fsrs_scheduled_days,
    revision: toInteger(row.revision, "Sense Memory State revision", 1),
    lastMemoryOutcomeId: row.last_memory_outcome_id,
    updatedAt,
  };
}

export async function loadCompletedSnapshot(
  executor: DatabaseExecutor,
  encounter: CompletedEncounterRow,
): Promise<CompletedEncounter> {
  const outcomeRows = await query<MemoryOutcomeRow>(executor, `
    SELECT memory_outcome_id::TEXT AS memory_outcome_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           sense_id::TEXT AS sense_id,
           sense_encounter_id::TEXT AS sense_encounter_id,
           outcome_kind::TEXT AS outcome_kind,
           decision_code,
           outcome_mapping_version,
           schedule_disposition,
           fsrs_rating,
           observed_completed_at,
           effective_reviewed_at,
           review_time_clamped,
           review_time_clamp_reason::TEXT AS review_time_clamp_reason,
           prior_memory_revision,
           resulting_memory_revision,
           fsrs_adapter_version,
           scheduler_settings_digest,
           created_at
      FROM sensa.memory_outcomes
     WHERE sense_encounter_id = $1
     LIMIT 1
  `, [encounter.sense_encounter_id]);
  const outcomeRow = outcomeRows[0];
  if (outcomeRow === undefined) throw error("state_corrupt", "Completed Encounter has no Memory Outcome.", 500);
  const stateRows = await query<MemoryStateRow>(executor, `
    SELECT sense_memory_state_id::TEXT AS sense_memory_state_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           sense_id::TEXT AS sense_id,
           due_at,
           reps,
           lapses,
           fsrs_card_state::TEXT AS fsrs_card_state,
           fsrs_step_index,
           fsrs_stability,
           fsrs_difficulty,
           fsrs_last_reviewed_at,
           fsrs_scheduled_days,
           revision,
           last_memory_outcome_id::TEXT AS last_memory_outcome_id,
           updated_at
      FROM sensa.sense_memory_states
     WHERE workspace_id = $1 AND learner_user_id = $2 AND sense_id = $3
     LIMIT 1
  `, [encounter.workspace_id, encounter.learner_user_id, encounter.sense_id]);
  const stateRow = stateRows[0];
  if (stateRow === undefined) throw error("state_corrupt", "Completed Encounter has no Sense Memory State.", 500);
  if (encounter.stop_policy_decision_code === null
    || !isSensaStopPolicyCompletionDecisionCode(encounter.stop_policy_decision_code)
    || !stopCompletionDecisionMatchesOutcome(
      encounter.stop_policy_decision_code,
      outcomeRow.outcome_kind as MemoryOutcomeSnapshot["outcomeKind"],
    )) {
    throw error("state_corrupt", "Completed Encounter has an invalid Stop Policy decision.", 500);
  }
  return {
    kind: "completed",
    encounterId: encounter.sense_encounter_id,
    stopDecisionCode: encounter.stop_policy_decision_code,
    memoryOutcome: mapMemoryOutcome(outcomeRow),
    memoryState: mapMemoryState(stateRow),
    semanticState: await loadSemanticState(executor, {
      workspaceId: encounter.workspace_id,
      learnerUserId: encounter.learner_user_id,
      senseId: encounter.sense_id,
    }),
  };
}



import type { DatabaseExecutor } from "../../database/index.js";
import {
  isSensaMemoryOutcomeDecisionCode,
  isSensaStopPolicyCompletionDecisionCode,
  mapMemoryOutcomeToFsrsRating,
  memoryOutcomeDecisionMatchesKind,
} from "@sensa/learning-kernel";
import {
  sensaSyncOutcomeMappingVersion,
  sensaSyncResultSchemaVersion,
  sensaSyncV2ResultSchemaVersion,
  sensaSyncV2WireVersion,
  sensaSyncWireVersion,
} from "@sensa/contracts/sensa";
import type {
  SensaSyncBootstrapResult,
  SensaSyncBootstrapSnapshot,
  SensaSyncCursorPair,
  SensaSyncLearningSessionSnapshot,
  SensaSyncLearnerDeclaredMasterySnapshot,
  SensaSyncLearnerSemanticStateSnapshot,
  SensaSyncMemoryOutcomeSnapshot,
  SensaSyncScope,
  SensaSyncSenseEncounterSnapshot,
  SensaSyncSenseMemoryStateSnapshot,
  SensaSyncStudyPlanSnapshot,
  SensaSyncV2BootstrapResult,
} from "@sensa/contracts/sensa";
import { supportedKernelVersions } from "./protocol.js";
import {
  asEnum,
  asSafeInteger,
  fail,
  query,
  timestamp,
  type Row,
} from "./support.js";

export function mapPlan(row: Row): SensaSyncStudyPlanSnapshot {
  return { studyPlanId: String(row.study_plan_id), workspaceId: String(row.workspace_id), learnerUserId: String(row.learner_user_id), bookVersionId: String(row.book_version_id), status: asEnum(row.status, ["active", "paused", "completed", "archived"] as const, "Study Plan status"), dailyNewSenseTarget: asSafeInteger(row.daily_new_sense_target, "daily new Sense target", 1), revision: asSafeInteger(row.revision, "Study Plan revision", 1), createdByReplicaId: String(row.created_by_replica_id), createdAt: timestamp(row.created_at, "Study Plan createdAt"), updatedAt: timestamp(row.updated_at, "Study Plan updatedAt"), activatedAt: timestamp(row.activated_at, "Study Plan activatedAt"), pausedAt: row.paused_at === null ? null : timestamp(row.paused_at, "Study Plan pausedAt"), completedAt: row.completed_at === null ? null : timestamp(row.completed_at, "Study Plan completedAt"), archivedAt: row.archived_at === null ? null : timestamp(row.archived_at, "Study Plan archivedAt") };
}

export function mapSession(row: Row): SensaSyncLearningSessionSnapshot {
  return { learningSessionId: String(row.learning_session_id), workspaceId: String(row.workspace_id), learnerUserId: String(row.learner_user_id), studyPlanId: String(row.study_plan_id), createdByReplicaId: String(row.created_by_replica_id), status: asEnum(row.status, ["active", "completed", "abandoned"] as const, "Learning Session status"), revision: asSafeInteger(row.revision, "Learning Session revision", 1), startedAt: timestamp(row.started_at, "Learning Session startedAt"), endedAt: row.ended_at === null ? null : timestamp(row.ended_at, "Learning Session endedAt"), createdAt: timestamp(row.created_at, "Learning Session createdAt"), updatedAt: timestamp(row.updated_at, "Learning Session updatedAt") };
}

function mapEncounter(row: Row): SensaSyncSenseEncounterSnapshot {
  const status = asEnum(row.status, ["planned", "active", "completed", "interrupted", "cancelled"] as const, "Encounter status");
  const stopPolicyDecisionCode = row.stop_policy_decision_code === null
    ? null
    : String(row.stop_policy_decision_code);
  if ((stopPolicyDecisionCode === null) !== (status !== "completed")
    || (stopPolicyDecisionCode !== null && !isSensaStopPolicyCompletionDecisionCode(stopPolicyDecisionCode))) {
    fail("state_corrupt", "Encounter completion is missing a valid Stop Policy Decision.", 500);
  }
  return { senseEncounterId: String(row.sense_encounter_id), workspaceId: String(row.workspace_id), learnerUserId: String(row.learner_user_id), learningSessionId: String(row.learning_session_id), studyPlanId: String(row.study_plan_id), senseId: String(row.sense_id), senseVersionId: String(row.sense_version_id), contentReleaseId: String(row.content_release_id), bookVersionId: String(row.book_version_id), sessionOrdinal: asSafeInteger(row.session_ordinal, "Encounter session ordinal", 1), kind: asEnum(row.kind, ["introduction", "review"] as const, "Encounter kind"), status, revision: asSafeInteger(row.revision, "Encounter revision", 1), kernelVersions: { capabilityResolverVersion: String(row.capability_resolver_version), semanticPolicyVersion: String(row.semantic_policy_version), stopPolicyVersion: String(row.stop_policy_version), evidenceRuleVersion: String(row.evidence_rule_version), stateUpdaterVersion: String(row.state_updater_version), outcomeMappingVersion: String(row.outcome_mapping_version) as typeof sensaSyncOutcomeMappingVersion }, stopPolicyDecisionCode, semanticStateRevisionAtOpen: asSafeInteger(row.semantic_state_revision_at_open, "Encounter semantic state revision at open"), memoryStateRevisionAtOpen: asSafeInteger(row.memory_state_revision_at_open, "Encounter memory state revision at open"), plannedAt: timestamp(row.planned_at, "Encounter plannedAt"), plannedLocalDate: String(row.planned_local_date), planningTimeZone: String(row.planning_time_zone), planningTimeZoneSource: asEnum(row.planning_time_zone_source, ["client", "user_settings", "utc_fallback"] as const, "planning timezone source"), openedAt: row.opened_at === null ? null : timestamp(row.opened_at, "Encounter openedAt"), closedAt: row.closed_at === null ? null : timestamp(row.closed_at, "Encounter closedAt"), createdAt: timestamp(row.created_at, "Encounter createdAt"), updatedAt: timestamp(row.updated_at, "Encounter updatedAt") };
}

function mapSemantic(row: Row): SensaSyncLearnerSemanticStateSnapshot {
  const dimension = (prefix: string) => ({ level: asEnum(row[`${prefix}_level`], ["unknown", "emerging", "stable"] as const, `${prefix} level`), positiveCount: asSafeInteger(row[`${prefix}_positive_count`], `${prefix} positive count`), failureStreak: asSafeInteger(row[`${prefix}_failure_streak`], `${prefix} failure streak`) });
  return { learnerSemanticStateId: String(row.learner_semantic_state_id), workspaceId: String(row.workspace_id), learnerUserId: String(row.learner_user_id), senseId: String(row.sense_id), grounding: dimension("grounding"), boundary: dimension("boundary"), formMapping: dimension("form_mapping"), retrieval: dimension("retrieval"), transfer: dimension("transfer"), projectionVersion: String(row.projection_version), revision: asSafeInteger(row.revision, "Semantic State revision", 1), stateDigest: String(row.state_digest), projectedThroughEvidenceId: row.projected_through_evidence_id === null ? null : String(row.projected_through_evidence_id), updatedAt: timestamp(row.updated_at, "Semantic State updatedAt") };
}

function mapMemory(row: Row): SensaSyncSenseMemoryStateSnapshot {
  return { senseMemoryStateId: String(row.sense_memory_state_id), workspaceId: String(row.workspace_id), learnerUserId: String(row.learner_user_id), senseId: String(row.sense_id), dueAt: row.due_at === null ? null : timestamp(row.due_at, "Memory State dueAt"), reps: asSafeInteger(row.reps, "Memory State reps"), lapses: asSafeInteger(row.lapses, "Memory State lapses"), fsrsCardState: asEnum(row.fsrs_card_state, ["new", "learning", "review", "relearning"] as const, "FSRS card state"), fsrsStepIndex: row.fsrs_step_index === null ? null : asSafeInteger(row.fsrs_step_index, "FSRS step index"), fsrsStability: row.fsrs_stability === null ? null : Number(row.fsrs_stability), fsrsDifficulty: row.fsrs_difficulty === null ? null : Number(row.fsrs_difficulty), fsrsLastReviewedAt: row.fsrs_last_reviewed_at === null ? null : timestamp(row.fsrs_last_reviewed_at, "FSRS last reviewedAt"), fsrsScheduledDays: row.fsrs_scheduled_days === null ? null : asSafeInteger(row.fsrs_scheduled_days, "FSRS scheduled days"), revision: asSafeInteger(row.revision, "Memory State revision", 1), lastMemoryOutcomeId: String(row.last_memory_outcome_id), updatedAt: timestamp(row.updated_at, "Memory State updatedAt") };
}

function mapLearnerDeclaredMastery(row: Row): SensaSyncLearnerDeclaredMasterySnapshot {
  return {
    learnerDeclaredMasteryId: String(row.learner_declared_mastery_id),
    workspaceId: String(row.workspace_id),
    learnerUserId: String(row.learner_user_id),
    senseId: String(row.sense_id),
    isMastered: Boolean(row.is_mastered),
    revision: asSafeInteger(row.revision, "Learner-Declared Mastery revision", 1),
    createdByReplicaId: String(row.created_by_replica_id),
    declaredAt: timestamp(row.declared_at, "Learner-Declared Mastery declaredAt"),
    revokedAt: row.revoked_at === null ? null : timestamp(row.revoked_at, "Learner-Declared Mastery revokedAt"),
    createdAt: timestamp(row.created_at, "Learner-Declared Mastery createdAt"),
    updatedAt: timestamp(row.updated_at, "Learner-Declared Mastery updatedAt"),
  };
}

function mapOutcome(row: Row): SensaSyncMemoryOutcomeSnapshot {
  if (row.outcome_mapping_version !== sensaSyncOutcomeMappingVersion) {
    fail("state_corrupt", "Memory Outcome uses an unsupported runtime version.", 500);
  }
  const outcomeKind = asEnum(row.outcome_kind, ["introduced", "retrieval_failed", "supported_retrieval", "independent_retrieval", "transfer_confirmed"] as const, "Memory Outcome kind");
  const decisionCode = String(row.decision_code);
  if (!isSensaMemoryOutcomeDecisionCode(decisionCode)
    || !memoryOutcomeDecisionMatchesKind(decisionCode, outcomeKind)) {
    fail("state_corrupt", "Memory Outcome is missing a compatible Decision code.", 500);
  }
  const acquisitionPending = outcomeKind === "introduced";
  if (acquisitionPending) {
    if (row.schedule_disposition !== "acquisition_pending"
      || row.fsrs_rating !== null
      || row.effective_reviewed_at !== null
      || Boolean(row.review_time_clamped)
      || row.review_time_clamp_reason !== null
      || row.fsrs_adapter_version !== null
      || row.scheduler_settings_digest !== null) {
      fail("state_corrupt", "Acquisition-pending Outcome contains an FSRS result.", 500);
    }
  } else if (row.schedule_disposition !== "fsrs_applied"
    || row.fsrs_rating !== mapMemoryOutcomeToFsrsRating(outcomeKind)
    || row.effective_reviewed_at === null
    || row.fsrs_adapter_version !== "sensa-fsrs-adapter-v2"
    || typeof row.scheduler_settings_digest !== "string") {
    fail("state_corrupt", "Scheduled Memory Outcome is incomplete.", 500);
  }
  return { memoryOutcomeId: String(row.memory_outcome_id), workspaceId: String(row.workspace_id), learnerUserId: String(row.learner_user_id), senseId: String(row.sense_id), senseEncounterId: String(row.sense_encounter_id), outcomeKind, decisionCode, outcomeMappingVersion: sensaSyncOutcomeMappingVersion, scheduleDisposition: acquisitionPending ? "acquisition_pending" : "fsrs_applied", fsrsRating: row.fsrs_rating === null ? null : asSafeInteger(row.fsrs_rating, "FSRS rating") as 0 | 1 | 2 | 3, observedCompletedAt: timestamp(row.observed_completed_at, "Memory Outcome observedCompletedAt"), effectiveReviewedAt: row.effective_reviewed_at === null ? null : timestamp(row.effective_reviewed_at, "Memory Outcome effectiveReviewedAt"), reviewTimeClamped: Boolean(row.review_time_clamped), reviewTimeClampReason: row.review_time_clamp_reason === null ? null : "previous_accepted_review_time", priorMemoryRevision: asSafeInteger(row.prior_memory_revision, "Memory Outcome prior revision"), resultingMemoryRevision: asSafeInteger(row.resulting_memory_revision, "Memory Outcome resulting revision"), fsrsAdapterVersion: acquisitionPending ? null : "sensa-fsrs-adapter-v2", schedulerSettingsDigest: row.scheduler_settings_digest === null ? null : String(row.scheduler_settings_digest), createdAt: timestamp(row.created_at, "Memory Outcome createdAt") };
}

function dbScope(scope: SensaSyncScope): Readonly<{ workspaceId: string; learnerUserId: string }> { return { workspaceId: scope.workspaceId, learnerUserId: scope.learnerUserId }; }

const planSelect = `
  SELECT study_plan_id::TEXT AS study_plan_id, workspace_id::TEXT AS workspace_id,
         learner_user_id, book_version_id::TEXT AS book_version_id, status::TEXT AS status,
         daily_new_sense_target, revision, created_by_replica_id::TEXT AS created_by_replica_id,
         created_at, updated_at, activated_at, paused_at, completed_at, archived_at
    FROM sensa.study_plans
`;

const sessionSelect = `
  SELECT learning_session_id::TEXT AS learning_session_id, workspace_id::TEXT AS workspace_id,
         learner_user_id, study_plan_id::TEXT AS study_plan_id,
         created_by_replica_id::TEXT AS created_by_replica_id, status::TEXT AS status,
         revision, started_at, ended_at, created_at, updated_at
    FROM sensa.learning_sessions
`;

const encounterSelect = `
  SELECT sense_encounter_id::TEXT AS sense_encounter_id,
         workspace_id::TEXT AS workspace_id, learner_user_id,
         learning_session_id::TEXT AS learning_session_id,
         study_plan_id::TEXT AS study_plan_id, sense_id::TEXT AS sense_id,
         sense_version_id::TEXT AS sense_version_id,
         content_release_id::TEXT AS content_release_id,
         book_version_id::TEXT AS book_version_id, session_ordinal,
         kind::TEXT AS kind, status::TEXT AS status, revision,
         capability_resolver_version, semantic_policy_version, stop_policy_version, evidence_rule_version,
         state_updater_version, outcome_mapping_version, stop_policy_decision_code,
         semantic_state_revision_at_open, memory_state_revision_at_open,
         planned_at, planned_local_date::TEXT AS planned_local_date,
         planning_time_zone, planning_time_zone_source::TEXT AS planning_time_zone_source,
         opened_at, closed_at, created_at, updated_at
    FROM sensa.sense_encounters
`;

const semanticSelect = `
  SELECT learner_semantic_state_id::TEXT AS learner_semantic_state_id,
         workspace_id::TEXT AS workspace_id, learner_user_id, sense_id::TEXT AS sense_id,
         grounding_level::TEXT AS grounding_level, grounding_positive_count,
         grounding_failure_streak, boundary_level::TEXT AS boundary_level,
         boundary_positive_count, boundary_failure_streak,
         form_mapping_level::TEXT AS form_mapping_level, form_mapping_positive_count,
         form_mapping_failure_streak, retrieval_level::TEXT AS retrieval_level,
         retrieval_positive_count, retrieval_failure_streak,
         transfer_level::TEXT AS transfer_level, transfer_positive_count,
         transfer_failure_streak, projection_version, revision, state_digest,
         projected_through_evidence_id::TEXT AS projected_through_evidence_id, updated_at
    FROM sensa.learner_semantic_states
`;

const memorySelect = `
  SELECT sense_memory_state_id::TEXT AS sense_memory_state_id,
         workspace_id::TEXT AS workspace_id, learner_user_id, sense_id::TEXT AS sense_id,
         due_at, reps, lapses, fsrs_card_state::TEXT AS fsrs_card_state,
         fsrs_step_index, fsrs_stability, fsrs_difficulty, fsrs_last_reviewed_at,
         fsrs_scheduled_days, revision, last_memory_outcome_id::TEXT AS last_memory_outcome_id,
         updated_at
    FROM sensa.sense_memory_states
`;

const learnerDeclaredMasterySelect = `
  SELECT learner_declared_mastery_id::TEXT AS learner_declared_mastery_id,
         workspace_id::TEXT AS workspace_id, learner_user_id,
         sense_id::TEXT AS sense_id, is_mastered, revision,
         created_by_replica_id::TEXT AS created_by_replica_id,
         declared_at, revoked_at, created_at, updated_at
    FROM sensa.learner_declared_masteries
`;

const outcomeSelect = `
  SELECT memory_outcome_id::TEXT AS memory_outcome_id,
         workspace_id::TEXT AS workspace_id, learner_user_id, sense_id::TEXT AS sense_id,
         sense_encounter_id::TEXT AS sense_encounter_id, outcome_kind::TEXT AS outcome_kind,
         decision_code, outcome_mapping_version, schedule_disposition, fsrs_rating, observed_completed_at,
         effective_reviewed_at, review_time_clamped,
         review_time_clamp_reason::TEXT AS review_time_clamp_reason,
         prior_memory_revision, resulting_memory_revision, fsrs_adapter_version,
         scheduler_settings_digest, created_at
    FROM sensa.memory_outcomes
`;

export async function loadPlan(executor: DatabaseExecutor, scope: SensaSyncScope, id: string, forUpdate = false): Promise<SensaSyncStudyPlanSnapshot> {
  const rows = await query<Row>(executor, `${planSelect} WHERE study_plan_id = $1 AND workspace_id = $2 AND learner_user_id = $3 ${forUpdate ? "FOR UPDATE" : ""}`, [id, scope.workspaceId, scope.learnerUserId]);
  if (rows[0] === undefined) fail("missing_dependency", "The requested Study Plan is not available.", 409);
  return mapPlan(rows[0]);
}

export async function loadSession(executor: DatabaseExecutor, scope: SensaSyncScope, id: string, forUpdate = false): Promise<SensaSyncLearningSessionSnapshot> {
  const rows = await query<Row>(executor, `${sessionSelect} WHERE learning_session_id = $1 AND workspace_id = $2 AND learner_user_id = $3 ${forUpdate ? "FOR UPDATE" : ""}`, [id, scope.workspaceId, scope.learnerUserId]);
  if (rows[0] === undefined) fail("missing_dependency", "The requested Learning Session is not available.", 409);
  return mapSession(rows[0]);
}

export async function loadEncounter(executor: DatabaseExecutor, scope: SensaSyncScope, id: string, forUpdate = false): Promise<SensaSyncSenseEncounterSnapshot> {
  const rows = await query<Row>(executor, `${encounterSelect} WHERE sense_encounter_id = $1 AND workspace_id = $2 AND learner_user_id = $3 ${forUpdate ? "FOR UPDATE" : ""}`, [id, scope.workspaceId, scope.learnerUserId]);
  if (rows[0] === undefined) fail("missing_dependency", "The requested Sense Encounter is not available.", 409);
  return mapEncounter(rows[0]);
}

export async function loadSemantic(executor: DatabaseExecutor, scope: SensaSyncScope, senseId: string): Promise<SensaSyncLearnerSemanticStateSnapshot | null> {
  const rows = await query<Row>(executor, `${semanticSelect} WHERE workspace_id = $1 AND learner_user_id = $2 AND sense_id = $3`, [scope.workspaceId, scope.learnerUserId, senseId]);
  return rows[0] === undefined ? null : mapSemantic(rows[0]);
}

export async function loadMemory(executor: DatabaseExecutor, scope: SensaSyncScope, senseId: string): Promise<SensaSyncSenseMemoryStateSnapshot | null> {
  const rows = await query<Row>(executor, `${memorySelect} WHERE workspace_id = $1 AND learner_user_id = $2 AND sense_id = $3`, [scope.workspaceId, scope.learnerUserId, senseId]);
  return rows[0] === undefined ? null : mapMemory(rows[0]);
}

export async function loadLearnerDeclaredMastery(executor: DatabaseExecutor, scope: SensaSyncScope, senseId: string, forUpdate = false): Promise<SensaSyncLearnerDeclaredMasterySnapshot | null> {
  const rows = await query<Row>(executor, `${learnerDeclaredMasterySelect} WHERE workspace_id = $1 AND learner_user_id = $2 AND sense_id = $3 ${forUpdate ? "FOR UPDATE" : ""}`, [scope.workspaceId, scope.learnerUserId, senseId]);
  return rows[0] === undefined ? null : mapLearnerDeclaredMastery(rows[0]);
}

export async function loadLearnerDeclaredMasteryById(executor: DatabaseExecutor, scope: SensaSyncScope, id: string): Promise<SensaSyncLearnerDeclaredMasterySnapshot | null> {
  const rows = await query<Row>(executor, `${learnerDeclaredMasterySelect} WHERE workspace_id = $1 AND learner_user_id = $2 AND learner_declared_mastery_id = $3`, [scope.workspaceId, scope.learnerUserId, id]);
  return rows[0] === undefined ? null : mapLearnerDeclaredMastery(rows[0]);
}

export async function loadOutcome(executor: DatabaseExecutor, scope: SensaSyncScope, id: string): Promise<SensaSyncMemoryOutcomeSnapshot> {
  const rows = await query<Row>(executor, `${outcomeSelect} WHERE memory_outcome_id = $1 AND workspace_id = $2 AND learner_user_id = $3`, [id, scope.workspaceId, scope.learnerUserId]);
  if (rows[0] === undefined) fail("state_corrupt", "The accepted Memory Outcome is missing.", 500);
  return mapOutcome(rows[0]);
}

async function loadBookReferences(executor: DatabaseExecutor, scope: SensaSyncScope): Promise<ReadonlyArray<Readonly<{ studyPlanId: string; bookVersionId: string; contentReleaseId: string; manifestDigest: string; targetLanguage: string; learnerLocale: string }>>> {
  const rows = await query<Row>(executor, `
    SELECT plans.study_plan_id::TEXT AS study_plan_id,
           books.book_version_id::TEXT AS book_version_id,
           books.content_release_id::TEXT AS content_release_id,
           books.manifest_digest, books.target_language, books.learner_locale
      FROM sensa.study_plans AS plans
      JOIN sensa.book_versions AS books ON books.book_version_id = plans.book_version_id
     WHERE plans.workspace_id = $1 AND plans.learner_user_id = $2
     ORDER BY plans.created_at ASC, plans.study_plan_id ASC
  `, [scope.workspaceId, scope.learnerUserId]);
  return rows.map((row) => ({ studyPlanId: String(row.study_plan_id), bookVersionId: String(row.book_version_id), contentReleaseId: String(row.content_release_id), manifestDigest: String(row.manifest_digest), targetLanguage: String(row.target_language), learnerLocale: String(row.learner_locale) }));
}

export async function loadLearnerDeclaredMasteries(executor: DatabaseExecutor, scope: SensaSyncScope): Promise<ReadonlyArray<SensaSyncLearnerDeclaredMasterySnapshot>> {
  const rows = await query<Row>(executor, `${learnerDeclaredMasterySelect} WHERE workspace_id = $1 AND learner_user_id = $2 ORDER BY updated_at ASC, sense_id ASC`, [scope.workspaceId, scope.learnerUserId]);
  return rows.map(mapLearnerDeclaredMastery);
}

export async function loadSnapshot(executor: DatabaseExecutor, scope: SensaSyncScope): Promise<Readonly<{
  pinnedBooks: ReadonlyArray<Readonly<{ studyPlanId: string; bookVersionId: string; contentReleaseId: string; manifestDigest: string; targetLanguage: string; learnerLocale: string }>>;
  studyPlans: ReadonlyArray<SensaSyncStudyPlanSnapshot>;
  learningSessions: ReadonlyArray<SensaSyncLearningSessionSnapshot>;
  senseEncounters: ReadonlyArray<SensaSyncSenseEncounterSnapshot>;
  semanticStates: ReadonlyArray<SensaSyncLearnerSemanticStateSnapshot>;
  memoryStates: ReadonlyArray<SensaSyncSenseMemoryStateSnapshot>;
}>> {
  const plans = await query<Row>(executor, `${planSelect} WHERE workspace_id = $1 AND learner_user_id = $2 ORDER BY created_at ASC, study_plan_id ASC`, [scope.workspaceId, scope.learnerUserId]);
  const sessions = await query<Row>(executor, `${sessionSelect} WHERE workspace_id = $1 AND learner_user_id = $2 AND (status = 'active' OR updated_at >= now() - INTERVAL '30 days') ORDER BY started_at ASC, learning_session_id ASC`, [scope.workspaceId, scope.learnerUserId]);
  const encounters = await query<Row>(executor, `${encounterSelect} WHERE workspace_id = $1 AND learner_user_id = $2 AND (status IN ('planned', 'active') OR updated_at >= now() - INTERVAL '30 days') ORDER BY planned_at ASC, sense_encounter_id ASC`, [scope.workspaceId, scope.learnerUserId]);
  const semantic = await query<Row>(executor, `${semanticSelect} WHERE workspace_id = $1 AND learner_user_id = $2 ORDER BY updated_at ASC, sense_id ASC`, [scope.workspaceId, scope.learnerUserId]);
  const memory = await query<Row>(executor, `${memorySelect} WHERE workspace_id = $1 AND learner_user_id = $2 ORDER BY updated_at ASC, sense_id ASC`, [scope.workspaceId, scope.learnerUserId]);
  return { pinnedBooks: await loadBookReferences(executor, scope), studyPlans: plans.map(mapPlan), learningSessions: sessions.map(mapSession), senseEncounters: encounters.map(mapEncounter), semanticStates: semantic.map(mapSemantic), memoryStates: memory.map(mapMemory) };
}

export function makeSnapshotResult(scope: SensaSyncScope, row: Row, snapshot: Awaited<ReturnType<typeof loadSnapshot>>, cursors: SensaSyncCursorPair): SensaSyncBootstrapResult {
  const replica = {
    replicaId: scope.replicaId,
    bootstrapRequired: false as const,
    bootstrapCursors: cursors,
    acknowledgedCursors: cursors,
    revision: asSafeInteger(row.revision, "replica revision", 1),
    bootstrappedAt: row.bootstrapped_at === null ? null : timestamp(row.bootstrapped_at, "replica bootstrappedAt"),
    lastPulledAt: row.last_pulled_at === null ? null : timestamp(row.last_pulled_at, "replica lastPulledAt"),
    lastPushedAt: row.last_pushed_at === null ? null : timestamp(row.last_pushed_at, "replica lastPushedAt"),
  };
  const value: SensaSyncBootstrapSnapshot = { replica, ...snapshot, cursors };
  return { wireVersion: sensaSyncWireVersion, resultSchemaVersion: sensaSyncResultSchemaVersion, bootstrapRequired: false, supportedKernelVersions: [supportedKernelVersions], snapshot: value };
}

export async function makeV2SnapshotResult(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  row: Row,
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>,
  cursors: SensaSyncCursorPair,
): Promise<SensaSyncV2BootstrapResult> {
  const replica = {
    replicaId: scope.replicaId,
    bootstrapRequired: false as const,
    bootstrapCursors: cursors,
    acknowledgedCursors: cursors,
    revision: asSafeInteger(row.revision, "replica revision", 1),
    bootstrappedAt: row.bootstrapped_at === null ? null : timestamp(row.bootstrapped_at, "replica bootstrappedAt"),
    lastPulledAt: row.last_pulled_at === null ? null : timestamp(row.last_pulled_at, "replica lastPulledAt"),
    lastPushedAt: row.last_pushed_at === null ? null : timestamp(row.last_pushed_at, "replica lastPushedAt"),
  };
  return {
    wireVersion: sensaSyncV2WireVersion,
    resultSchemaVersion: sensaSyncV2ResultSchemaVersion,
    bootstrapRequired: false,
    supportedKernelVersions: [supportedKernelVersions],
    snapshot: {
      replica,
      ...snapshot,
      learnerDeclaredMasteries: await loadLearnerDeclaredMasteries(executor, scope),
      cursors,
    },
  };
}

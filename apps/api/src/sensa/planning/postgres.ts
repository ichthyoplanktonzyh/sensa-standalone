import type { QueryResultRow } from "pg";
import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../database/index.js";
import { getDatabaseErrorFields } from "../../database/transient.js";
import { formatDateAsTimeZoneLocalDate, validateIanaTimeZone } from "../../progress/timeZone.js";
import { HttpError } from "../../shared/errors.js";
import {
  sensaExecutableLearningCapabilityResolverVersion,
  sensaEvidenceRuleVersion,
  sensaMemoryOutcomeVersion,
  sensaSemanticPolicyVersion,
  sensaStateUpdaterVersion,
  sensaStopPolicyVersion,
  type SensaPlanningTimeZoneSource,
} from "@sensa/learning-kernel";
import type {
  CreateStudyPlanInput,
  CreateStudyPlanResult,
  PlanNextInput,
  SensaLearningSessionSnapshot,
  SensaPlanNextResult,
  SensaPlanningModule,
  SensaPlannedEncounterSnapshot,
  SensaStudyPlanSnapshot,
  StartOrResumeLearningSessionInput,
  StartOrResumeLearningSessionResult,
} from "@sensa/contracts/sensa";

type Row = QueryResultRow & Record<string, unknown>;

type PlanningModuleOptions = Readonly<{
  clock?: () => Date;
}>;

// First retrieval is part of acquiring a new Sense, not an ordinary FSRS
// review.  Space it by other completed Senses in the same Session so reading
// speed cannot collapse the learning interval to a wall-clock minute.
const firstRetrievalInterveningSenseTarget = 3;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const datePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u;

function planningError(
  statusCode: number,
  message: string,
  code: string,
): HttpError {
  return new HttpError(statusCode, message, code);
}

function requireValidDate(now: Date): Date {
  const value = new Date(now.getTime());
  if (Number.isNaN(value.getTime())) {
    throw planningError(500, "Planning clock returned an invalid timestamp.", "SENSA_PLANNING_CLOCK_INVALID");
  }
  return value;
}

function readString(row: Row, key: string, message: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw planningError(500, `The persisted Sensa planning snapshot is invalid: ${message}.`, "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return value;
}

function readNullableString(row: Row, key: string, message: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw planningError(500, `The persisted Sensa planning snapshot is invalid: ${message}.`, "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return value;
}

function readUuid(row: Row, key: string, message: string): string {
  const value = readString(row, key, message);
  if (!uuidPattern.test(value)) {
    throw planningError(500, `The persisted Sensa planning snapshot is invalid: ${message}.`, "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return value.toLowerCase();
}

function readInteger(row: Row, key: string, message: string, minimum = 0): number {
  const value = row[key];
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^-?[0-9]+$/u.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw planningError(500, `The persisted Sensa planning snapshot is invalid: ${message}.`, "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return parsed;
}

function readIsoTimestamp(row: Row, key: string, message: string): string {
  const value = row[key];
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw planningError(500, `The persisted Sensa planning snapshot is invalid: ${message}.`, "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return date.toISOString();
}

function readNullableIsoTimestamp(row: Row, key: string, message: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw planningError(500, `The persisted Sensa planning snapshot is invalid: ${message}.`, "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return date.toISOString();
}

function readLocalDate(row: Row, key: string): string {
  const value = readString(row, key, "planned local date");
  if (!datePattern.test(value)) {
    throw planningError(500, "The persisted Sensa planning snapshot has an invalid local date.", "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return value;
}

function readStatus<T extends string>(row: Row, key: string, allowed: ReadonlySet<T>, message: string): T {
  const value = readString(row, key, message) as T;
  if (!allowed.has(value)) {
    throw planningError(500, `The persisted Sensa planning snapshot has an invalid ${message}.`, "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return value;
}

function mapStudyPlan(row: Row): SensaStudyPlanSnapshot {
  return {
    studyPlanId: readUuid(row, "study_plan_id", "Study Plan id"),
    workspaceId: readUuid(row, "workspace_id", "Workspace id"),
    learnerUserId: readString(row, "learner_user_id", "learner id"),
    bookVersionId: readUuid(row, "book_version_id", "Book Version id"),
    status: readStatus(row, "status", new Set(["active", "paused", "completed", "archived"] as const), "Study Plan status"),
    dailyNewSenseTarget: readInteger(row, "daily_new_sense_target", "daily new Sense target", 1),
    revision: readInteger(row, "revision", "Study Plan revision", 1),
    createdByReplicaId: readUuid(row, "created_by_replica_id", "replica id"),
    createdAt: readIsoTimestamp(row, "created_at", "created at"),
    updatedAt: readIsoTimestamp(row, "updated_at", "updated at"),
    activatedAt: readIsoTimestamp(row, "activated_at", "activated at"),
    pausedAt: readNullableIsoTimestamp(row, "paused_at", "paused at"),
    completedAt: readNullableIsoTimestamp(row, "completed_at", "completed at"),
    archivedAt: readNullableIsoTimestamp(row, "archived_at", "archived at"),
  };
}

function mapLearningSession(row: Row): SensaLearningSessionSnapshot {
  return {
    learningSessionId: readUuid(row, "learning_session_id", "Learning Session id"),
    workspaceId: readUuid(row, "workspace_id", "Workspace id"),
    learnerUserId: readString(row, "learner_user_id", "learner id"),
    studyPlanId: readUuid(row, "study_plan_id", "Study Plan id"),
    createdByReplicaId: readUuid(row, "created_by_replica_id", "replica id"),
    status: readStatus(row, "status", new Set(["active", "completed", "abandoned"] as const), "Learning Session status"),
    revision: readInteger(row, "revision", "Learning Session revision", 1),
    startedAt: readIsoTimestamp(row, "started_at", "started at"),
    endedAt: readNullableIsoTimestamp(row, "ended_at", "ended at"),
    createdAt: readIsoTimestamp(row, "created_at", "created at"),
    updatedAt: readIsoTimestamp(row, "updated_at", "updated at"),
  };
}

function mapEncounter(row: Row): SensaPlannedEncounterSnapshot {
  return {
    encounterId: readUuid(row, "sense_encounter_id", "Encounter id"),
    learningSessionId: readUuid(row, "learning_session_id", "Learning Session id"),
    studyPlanId: readUuid(row, "study_plan_id", "Study Plan id"),
    senseId: readUuid(row, "sense_id", "Sense id"),
    senseVersionId: readUuid(row, "sense_version_id", "Sense Version id"),
    contentReleaseId: readUuid(row, "content_release_id", "Content Release id"),
    bookVersionId: readUuid(row, "book_version_id", "Book Version id"),
    sessionOrdinal: readInteger(row, "session_ordinal", "Session ordinal", 1),
    kind: readStatus(row, "kind", new Set(["introduction", "review"] as const), "Encounter kind"),
    status: readStatus(row, "status", new Set(["planned", "active"] as const), "Encounter status"),
    reason: readStatus(row, "reason", new Set(["new", "due"] as const), "planning reason"),
    revision: readInteger(row, "revision", "Encounter revision", 1),
    capabilityResolverVersion: readStatus(row, "capability_resolver_version", new Set([sensaExecutableLearningCapabilityResolverVersion] as const), "Capability Resolver version"),
    semanticPolicyVersion: readStatus(row, "semantic_policy_version", new Set([sensaSemanticPolicyVersion] as const), "Semantic Policy version"),
    stopPolicyVersion: readStatus(row, "stop_policy_version", new Set([sensaStopPolicyVersion] as const), "Stop Policy version"),
    evidenceRuleVersion: readStatus(row, "evidence_rule_version", new Set([sensaEvidenceRuleVersion] as const), "Evidence Rule version"),
    stateUpdaterVersion: readStatus(row, "state_updater_version", new Set([sensaStateUpdaterVersion] as const), "State Updater version"),
    outcomeMappingVersion: readStatus(row, "outcome_mapping_version", new Set([sensaMemoryOutcomeVersion] as const), "Memory Outcome version"),
    plannedAt: readIsoTimestamp(row, "planned_at", "planned at"),
    plannedLocalDate: readLocalDate(row, "planned_local_date"),
    planningTimeZone: readString(row, "planning_time_zone", "planning timezone"),
    planningTimeZoneSource: readStatus(row, "planning_time_zone_source", new Set(["client", "user_settings", "utc_fallback"] as const), "planning timezone source"),
    openedAt: readNullableIsoTimestamp(row, "opened_at", "opened at"),
    closedAt: readNullableIsoTimestamp(row, "closed_at", "closed at"),
    createdAt: readIsoTimestamp(row, "created_at", "created at"),
    updatedAt: readIsoTimestamp(row, "updated_at", "updated at"),
  };
}

function getNow(options: PlanningModuleOptions): Date {
  return requireValidDate(options.clock?.() ?? new Date());
}

function mapDatabaseError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  const { sqlState } = getDatabaseErrorFields(error);
  if (sqlState === "23505") {
    throw planningError(
      409,
      "The Sensa planning request conflicts with an existing client-created identity or active plan.",
      "SENSA_PLANNING_CONFLICT",
    );
  }
  if (sqlState === "23503") {
    throw planningError(
      409,
      "The Sensa planning request references a missing or unavailable dependency.",
      "SENSA_PLANNING_DEPENDENCY_UNAVAILABLE",
    );
  }
  if (sqlState === "23514") {
    throw planningError(
      409,
      "The Sensa planning request violates a current immutable or publication rule.",
      "SENSA_PLANNING_RULE_VIOLATION",
    );
  }
  throw error;
}

async function query<RowType extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<string | number | boolean | Date | null | ReadonlyArray<string> | ReadonlyArray<number>>,
): Promise<ReadonlyArray<RowType & Record<string, unknown>>> {
  return (await executor.query<RowType>(text, params)).rows as ReadonlyArray<RowType & Record<string, unknown>>;
}

async function verifyReplicaScope(
  executor: DatabaseExecutor,
  input: Readonly<{ replicaId: string; workspaceId: string; learnerUserId: string }>,
): Promise<void> {
  const rows = await query<Row>(executor, `
    SELECT workspace_id::TEXT AS workspace_id,
           user_id AS learner_user_id
      FROM sync.workspace_replicas
     WHERE replica_id = $1
     LIMIT 1
  `, [input.replicaId]);
  const row = rows[0];
  if (row === undefined) {
    throw planningError(409, "replicaId is not registered for this learner and Workspace.", "SENSA_PLANNING_REPLICA_SCOPE_MISMATCH");
  }
  if (row.workspace_id !== input.workspaceId || row.learner_user_id !== input.learnerUserId) {
    throw planningError(409, "replicaId must belong to the authenticated learner and Workspace.", "SENSA_PLANNING_REPLICA_SCOPE_MISMATCH");
  }
}

async function assertPublicEligibleBook(
  executor: DatabaseExecutor,
  bookVersionId: string,
): Promise<void> {
  const rows = await query<Row>(executor, `
    SELECT versions.content_release_id::TEXT AS content_release_id,
           versions.status::TEXT AS book_status,
           releases.status::TEXT AS release_status,
           COUNT(members.ordinal)::INTEGER AS member_count,
           COUNT(approved_senses.sense_version_id)::INTEGER AS approved_sense_count,
           COUNT(DISTINCT lexeme_versions.lexeme_id)::INTEGER AS lexeme_count
      FROM sensa.book_versions AS versions
      JOIN sensa.content_releases AS releases
        ON releases.content_release_id = versions.content_release_id
      LEFT JOIN sensa.book_version_senses AS members
        ON members.book_version_id = versions.book_version_id
      LEFT JOIN sensa.sense_versions AS approved_senses
        ON approved_senses.sense_version_id = members.sense_version_id
       AND approved_senses.content_release_id = versions.content_release_id
       AND approved_senses.review_status = 'approved'
      LEFT JOIN sensa.senses AS stable_senses
        ON stable_senses.sense_id = approved_senses.sense_id
      LEFT JOIN sensa.lexeme_versions AS lexeme_versions
        ON lexeme_versions.content_release_id = versions.content_release_id
       AND lexeme_versions.lexeme_id = stable_senses.lexeme_id
     WHERE versions.book_version_id = $1
     GROUP BY versions.content_release_id, versions.status, releases.status
  `, [bookVersionId]);
  const row = rows[0];
  if (row === undefined
    || row.book_status !== "published"
    || row.release_status !== "published") {
    throw planningError(409, "Only a published public Sensa Book Version can be selected.", "SENSA_PLANNING_BOOK_NOT_PUBLIC");
  }
  const memberCount = Number(row.member_count);
  const approvedSenseCount = Number(row.approved_sense_count);
  const lexemeCount = Number(row.lexeme_count);
  if (!Number.isSafeInteger(memberCount)
    || memberCount < 1
    || memberCount !== approvedSenseCount
    || lexemeCount < 1_000) {
    throw planningError(409, "The selected Sensa Book Version has not passed the 1,000 distinct Lexeme publication gate.", "SENSA_PLANNING_BOOK_NOT_ELIGIBLE");
  }
  const packageGate = await query<{ eligible: boolean }>(executor, `
    SELECT sensa.is_public_book_version_eligible($1) AS eligible
  `, [bookVersionId]);
  if (packageGate[0]?.eligible !== true) {
    throw planningError(409, "The selected Sensa Book Version has not passed the published Content Package gate.", "SENSA_PLANNING_BOOK_NOT_ELIGIBLE");
  }
}

async function assertPinnedRuntimeEligible(
  executor: DatabaseExecutor,
  bookVersionId: string,
): Promise<void> {
  const rows = await query<Row>(executor, `
    SELECT versions.status::TEXT AS book_status,
           releases.status::TEXT AS release_status
      FROM sensa.book_versions AS versions
      JOIN sensa.content_releases AS releases
        ON releases.content_release_id = versions.content_release_id
     WHERE versions.book_version_id = $1
  `, [bookVersionId]);
  const row = rows[0];
  if (row === undefined) {
    throw planningError(409, "The pinned Sensa Book Version is not available.", "SENSA_PLANNING_BOOK_NOT_PUBLIC");
  }
  // A previously pinned immutable runtime remains usable after public
  // discovery moves on.  New public selection still goes through the full
  // published and 1,000-Lexeme/package gate below.
  if (row.book_status === "retired" && row.release_status === "superseded") return;
  await assertPublicEligibleBook(executor, bookVersionId);
}

function resolveProvidedTimeZone(value: string): string {
  const validation = validateIanaTimeZone(value);
  if (!validation.ok) {
    throw planningError(400, "timeZone must be a valid IANA timezone.", "SENSA_PLANNING_TIMEZONE_INVALID");
  }
  return validation.timeZone;
}

async function resolvePlanningTimeZone(
  executor: DatabaseExecutor,
  input: Readonly<{ timeZone?: string; learnerUserId: string }>,
): Promise<Readonly<{ timeZone: string; source: SensaPlanningTimeZoneSource }>> {
  if (input.timeZone !== undefined) {
    return { timeZone: resolveProvidedTimeZone(input.timeZone), source: "client" };
  }
  const rows = await query<Row>(executor, `
    SELECT progress_time_zone
      FROM org.user_settings
     WHERE user_id = $1
     LIMIT 1
  `, [input.learnerUserId]);
  const configured = rows[0]?.progress_time_zone;
  if (typeof configured === "string") {
    const validation = validateIanaTimeZone(configured);
    if (validation.ok) return { timeZone: validation.timeZone, source: "user_settings" };
  }
  return { timeZone: "UTC", source: "utc_fallback" };
}

function samePlanInput(row: Row, input: CreateStudyPlanInput): boolean {
  return row.workspace_id === input.workspaceId
    && row.learner_user_id === input.learnerUserId
    && row.book_version_id === input.bookVersionId
    && Number(row.daily_new_sense_target) === input.dailyNewSenseTarget
    && row.created_by_replica_id === input.replicaId;
}

async function lockActiveStudyPlan(
  executor: DatabaseExecutor,
  workspaceId: string,
  learnerUserId: string,
): Promise<Row | undefined> {
  const rows = await query<Row>(executor, `
    SELECT study_plan_id::TEXT AS study_plan_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           book_version_id::TEXT AS book_version_id,
           status::TEXT AS status,
           daily_new_sense_target,
           revision,
           created_by_replica_id::TEXT AS created_by_replica_id,
           created_at,
           updated_at,
           activated_at,
           paused_at,
           completed_at,
           archived_at
      FROM sensa.study_plans
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND status = 'active'
     ORDER BY created_at ASC, study_plan_id ASC
     LIMIT 1
     FOR UPDATE
  `, [workspaceId, learnerUserId]);
  return rows[0];
}

async function lockStudyPlan(
  executor: DatabaseExecutor,
  workspaceId: string,
  learnerUserId: string,
  studyPlanId: string,
): Promise<Row> {
  const rows = await query<Row>(executor, `
    SELECT study_plan_id::TEXT AS study_plan_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           book_version_id::TEXT AS book_version_id,
           status::TEXT AS status,
           daily_new_sense_target,
           revision,
           created_by_replica_id::TEXT AS created_by_replica_id,
           created_at,
           updated_at,
           activated_at,
           paused_at,
           completed_at,
           archived_at
      FROM sensa.study_plans
     WHERE study_plan_id = $1
       AND workspace_id = $2
       AND learner_user_id = $3
     FOR UPDATE
  `, [studyPlanId, workspaceId, learnerUserId]);
  const row = rows[0];
  if (row === undefined) {
    throw planningError(404, "The requested Sensa Study Plan is not available.", "SENSA_PLANNING_PLAN_NOT_FOUND");
  }
  return row;
}

async function lockLearningSession(
  executor: DatabaseExecutor,
  input: Readonly<{ workspaceId: string; learnerUserId: string; learningSessionId: string; studyPlanId: string }>,
): Promise<Row> {
  const rows = await query<Row>(executor, `
    SELECT learning_session_id::TEXT AS learning_session_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           study_plan_id::TEXT AS study_plan_id,
           created_by_replica_id::TEXT AS created_by_replica_id,
           status::TEXT AS status,
           revision,
           started_at,
           ended_at,
           created_at,
           updated_at
      FROM sensa.learning_sessions
     WHERE learning_session_id = $1
       AND workspace_id = $2
       AND learner_user_id = $3
       AND study_plan_id = $4
     FOR UPDATE
  `, [input.learningSessionId, input.workspaceId, input.learnerUserId, input.studyPlanId]);
  const row = rows[0];
  if (row === undefined) {
    throw planningError(404, "The requested Sensa Learning Session is not available.", "SENSA_PLANNING_SESSION_NOT_FOUND");
  }
  return row;
}

function ensureActive(row: Row, objectName: "Study Plan" | "Learning Session"): void {
  if (row.status !== "active") {
    throw planningError(409, `${objectName} is no longer active. Resume from the current authoritative snapshot.`, "SENSA_PLANNING_NOT_ACTIVE");
  }
}

async function loadExistingSessionForPlan(
  executor: DatabaseExecutor,
  workspaceId: string,
  learnerUserId: string,
  studyPlanId: string,
): Promise<Row | undefined> {
  const rows = await query<Row>(executor, `
    SELECT learning_session_id::TEXT AS learning_session_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           study_plan_id::TEXT AS study_plan_id,
           created_by_replica_id::TEXT AS created_by_replica_id,
           status::TEXT AS status,
           revision,
           started_at,
           ended_at,
           created_at,
           updated_at
      FROM sensa.learning_sessions
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND study_plan_id = $3
       AND status = 'active'
     ORDER BY started_at ASC, learning_session_id ASC
     LIMIT 1
     FOR UPDATE
  `, [workspaceId, learnerUserId, studyPlanId]);
  return rows[0];
}

async function loadExistingEncounter(
  executor: DatabaseExecutor,
  learningSessionId: string,
): Promise<Row | undefined> {
  const rows = await query<Row>(executor, `
    SELECT encounters.sense_encounter_id::TEXT AS sense_encounter_id,
           encounters.learning_session_id::TEXT AS learning_session_id,
           encounters.study_plan_id::TEXT AS study_plan_id,
           encounters.sense_id::TEXT AS sense_id,
           encounters.sense_version_id::TEXT AS sense_version_id,
           encounters.content_release_id::TEXT AS content_release_id,
           encounters.book_version_id::TEXT AS book_version_id,
           encounters.session_ordinal,
           encounters.kind::TEXT AS kind,
           encounters.status::TEXT AS status,
           encounters.revision,
           encounters.capability_resolver_version,
           encounters.semantic_policy_version,
           encounters.stop_policy_version,
           encounters.evidence_rule_version,
           encounters.state_updater_version,
           encounters.outcome_mapping_version,
           encounters.planned_at,
           encounters.planned_local_date::TEXT AS planned_local_date,
           encounters.planning_time_zone,
           encounters.planning_time_zone_source,
           encounters.opened_at,
           encounters.closed_at,
           encounters.created_at,
           encounters.updated_at,
           CASE WHEN encounters.kind = 'introduction' THEN 'new' ELSE 'due' END AS reason
      FROM sensa.sense_encounters AS encounters
     WHERE encounters.learning_session_id = $1
       AND encounters.status IN ('planned', 'active')
     ORDER BY encounters.session_ordinal ASC, encounters.sense_encounter_id ASC
     LIMIT 1
     FOR UPDATE
  `, [learningSessionId]);
  return rows[0];
}

async function countDailyNewReservations(
  executor: DatabaseExecutor,
  input: Readonly<{ workspaceId: string; learnerUserId: string; localDate: string }>,
): Promise<number> {
  const rows = await query<Row>(executor, `
    SELECT COUNT(DISTINCT sense_id)::INTEGER AS count
      FROM sensa.sense_encounters
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND planned_local_date = $3::DATE
       AND kind = 'introduction'
       AND (status = 'planned' OR opened_at IS NOT NULL)
  `, [input.workspaceId, input.learnerUserId, input.localDate]);
  const value = Number(rows[0]?.count ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw planningError(500, "The Sensa daily quota snapshot is invalid.", "SENSA_PLANNING_QUOTA_INVALID");
  }
  return value;
}

/**
 * Planning and Learner-Declared Mastery use the same learner-by-Sense
 * advisory lock.  It is required even when no mastery row exists yet: a
 * missing row cannot be protected by SELECT FOR UPDATE, and a declaration
 * racing a candidate selection must win before the candidate is inserted.
 */
async function lockLearnerSense(
  executor: DatabaseExecutor,
  input: Readonly<{ workspaceId: string; learnerUserId: string; senseId: string }>,
): Promise<void> {
  await executor.query(
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text || ':' || $2::text || ':' || $3::text, 0::bigint))",
    [input.workspaceId, input.learnerUserId, input.senseId],
  );
}

async function isLearnerSenseMastered(
  executor: DatabaseExecutor,
  input: Readonly<{ workspaceId: string; learnerUserId: string; senseId: string }>,
): Promise<boolean> {
  const rows = await query<Row>(executor, `
    SELECT is_mastered
      FROM sensa.learner_declared_masteries
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND sense_id = $3
  `, [input.workspaceId, input.learnerUserId, input.senseId]);
  return rows[0]?.is_mastered === true;
}

async function selectDueCandidate(
  executor: DatabaseExecutor,
  input: Readonly<{
    workspaceId: string;
    learnerUserId: string;
    studyPlanId: string;
    learningSessionId: string;
    now: Date;
    allowShortAcquisitionGap: boolean;
  }>,
): Promise<Row | undefined> {
  const rows = await query<Row>(executor, `
    SELECT members.sense_version_id::TEXT AS sense_version_id,
           stable_senses.sense_id::TEXT AS sense_id,
           versions.content_release_id::TEXT AS content_release_id,
           members.book_version_id::TEXT AS book_version_id,
           members.ordinal,
           memory.due_at,
           outcomes.outcome_kind::TEXT AS last_outcome_kind
      FROM sensa.book_version_senses AS members
      JOIN sensa.book_versions AS versions
        ON versions.book_version_id = members.book_version_id
       AND versions.status IN ('published', 'retired')
      JOIN sensa.content_releases AS releases
        ON releases.content_release_id = versions.content_release_id
       AND releases.status IN ('published', 'superseded')
      JOIN sensa.sense_versions AS sense_versions
        ON sense_versions.sense_version_id = members.sense_version_id
       AND sense_versions.content_release_id = versions.content_release_id
       AND sense_versions.review_status = 'approved'
      JOIN sensa.senses AS stable_senses
        ON stable_senses.sense_id = sense_versions.sense_id
      JOIN sensa.sense_memory_states AS memory
        ON memory.workspace_id = $1
       AND memory.learner_user_id = $2
       AND memory.sense_id = stable_senses.sense_id
      JOIN sensa.memory_outcomes AS outcomes
        ON outcomes.memory_outcome_id = memory.last_memory_outcome_id
       AND outcomes.workspace_id = memory.workspace_id
       AND outcomes.learner_user_id = memory.learner_user_id
       AND outcomes.sense_id = memory.sense_id
      JOIN sensa.sense_encounters AS outcome_encounters
        ON outcome_encounters.sense_encounter_id = outcomes.sense_encounter_id
     WHERE versions.book_version_id = (
       SELECT plans.book_version_id
         FROM sensa.study_plans AS plans
        WHERE plans.study_plan_id = $3
     )
       AND NOT EXISTS (
         SELECT 1
           FROM sensa.sense_encounters AS existing
          WHERE existing.learning_session_id = $4
            AND existing.sense_id = stable_senses.sense_id
            AND existing.status IN ('planned', 'active')
       )
       AND NOT EXISTS (
         SELECT 1
           FROM sensa.sense_encounters AS reviewed
          WHERE reviewed.learning_session_id = $4
            AND reviewed.sense_id = stable_senses.sense_id
            AND reviewed.kind = 'review'
            AND reviewed.status <> 'cancelled'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM sensa.learner_declared_masteries AS masteries
          WHERE masteries.workspace_id = $1
            AND masteries.learner_user_id = $2
            AND masteries.sense_id = stable_senses.sense_id
            AND masteries.is_mastered
       )
       AND (
         (
           outcomes.outcome_kind = 'introduced'
           AND (
             outcome_encounters.learning_session_id <> $4
             OR $6
             OR (
               SELECT COUNT(DISTINCT intervening.sense_id)
                 FROM sensa.sense_encounters AS intervening
                WHERE intervening.learning_session_id = $4
                  AND intervening.session_ordinal > outcome_encounters.session_ordinal
                  AND intervening.sense_id <> stable_senses.sense_id
                  AND intervening.status = 'completed'
             ) >= $7
           )
         )
         OR (
           outcomes.outcome_kind <> 'introduced'
           AND memory.due_at <= $5
         )
       )
     ORDER BY CASE WHEN outcomes.outcome_kind = 'introduced' THEN 1 ELSE 0 END ASC,
              memory.due_at ASC,
              members.ordinal ASC,
              stable_senses.sense_id ASC
     LIMIT 1
  `, [
    input.workspaceId,
    input.learnerUserId,
    input.studyPlanId,
    input.learningSessionId,
    input.now,
    input.allowShortAcquisitionGap,
    firstRetrievalInterveningSenseTarget,
  ]);
  return rows[0];
}

async function selectNewCandidate(
  executor: DatabaseExecutor,
  input: Readonly<{ workspaceId: string; learnerUserId: string; studyPlanId: string; learningSessionId: string }>,
): Promise<Row | undefined> {
  const rows = await query<Row>(executor, `
    SELECT members.sense_version_id::TEXT AS sense_version_id,
           stable_senses.sense_id::TEXT AS sense_id,
           versions.content_release_id::TEXT AS content_release_id,
           members.book_version_id::TEXT AS book_version_id,
           members.ordinal
      FROM sensa.book_version_senses AS members
      JOIN sensa.book_versions AS versions
        ON versions.book_version_id = members.book_version_id
       AND versions.status IN ('published', 'retired')
      JOIN sensa.content_releases AS releases
        ON releases.content_release_id = versions.content_release_id
       AND releases.status IN ('published', 'superseded')
      JOIN sensa.sense_versions AS sense_versions
        ON sense_versions.sense_version_id = members.sense_version_id
       AND sense_versions.content_release_id = versions.content_release_id
       AND sense_versions.review_status = 'approved'
      JOIN sensa.senses AS stable_senses
        ON stable_senses.sense_id = sense_versions.sense_id
     WHERE versions.book_version_id = (
       SELECT plans.book_version_id
         FROM sensa.study_plans AS plans
        WHERE plans.study_plan_id = $1
     )
       AND NOT EXISTS (
         SELECT 1
           FROM sensa.sense_memory_states AS memory
          WHERE memory.workspace_id = $2
            AND memory.learner_user_id = $3
            AND memory.sense_id = stable_senses.sense_id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM sensa.sense_encounters AS existing
          WHERE existing.learning_session_id = $4
            AND existing.sense_id = stable_senses.sense_id
            AND existing.status <> 'cancelled'
       )
       AND NOT EXISTS (
         SELECT 1
           FROM sensa.learner_declared_masteries AS masteries
          WHERE masteries.workspace_id = $2
            AND masteries.learner_user_id = $3
            AND masteries.sense_id = stable_senses.sense_id
            AND masteries.is_mastered
       )
     ORDER BY members.ordinal ASC, stable_senses.sense_id ASC
     LIMIT 1
  `, [input.studyPlanId, input.workspaceId, input.learnerUserId, input.learningSessionId]);
  return rows[0];
}

async function nextSessionOrdinal(executor: DatabaseExecutor, learningSessionId: string): Promise<number> {
  const rows = await query<Row>(executor, `
    SELECT COALESCE(MAX(session_ordinal), 0)::INTEGER + 1 AS next_ordinal
      FROM sensa.sense_encounters
     WHERE learning_session_id = $1
  `, [learningSessionId]);
  return readInteger(rows[0] ?? {}, "next_ordinal", "next Encounter ordinal", 1);
}

function createWorkspaceScope(input: Readonly<{ workspaceId: string; learnerUserId: string }>): WorkspaceDatabaseScope {
  return { userId: input.learnerUserId, workspaceId: input.workspaceId };
}

export type SensaPlanNextExecutorOptions = Readonly<{
  /** Used by Sync to preserve the operation's canonical occurredAt timestamp. */
  clock?: () => Date;
  /** Offline identity asserted by Sync; public Planning continues to generate one. */
  encounterId?: string;
}>;

/**
 * Execute the canonical Planning decision inside a caller-owned transaction.
 * The caller may roll back the transaction when an offline assertion does not
 * match this server-selected candidate.
 */
export async function planNextInExecutor(
  executor: DatabaseExecutor,
  input: PlanNextInput,
  executorOptions: SensaPlanNextExecutorOptions = {},
): Promise<SensaPlanNextResult> {
  const plan = await lockStudyPlan(executor, input.workspaceId, input.learnerUserId, input.studyPlanId);
  ensureActive(plan, "Study Plan");
  await assertPinnedRuntimeEligible(executor, readUuid(plan, "book_version_id", "Book Version id"));
  const session = await lockLearningSession(executor, input);
  ensureActive(session, "Learning Session");

  const existing = await loadExistingEncounter(executor, input.learningSessionId);
  if (existing !== undefined) {
    return { kind: "planned_encounter", encounter: mapEncounter(existing) };
  }

  const now = getNow({ clock: executorOptions.clock });
  const resolvedTimeZone = await resolvePlanningTimeZone(executor, {
    timeZone: input.timeZone,
    learnerUserId: input.learnerUserId,
  });
  const plannedLocalDate = formatDateAsTimeZoneLocalDate(now, resolvedTimeZone.timeZone);
  const due = await selectDueCandidate(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    studyPlanId: input.studyPlanId,
    learningSessionId: input.learningSessionId,
    now,
    allowShortAcquisitionGap: false,
  });
  let candidate = due;
  let reason: "new" | "due" = "due";
  if (candidate === undefined && input.selectionMode === "mixed") {
    const reserved = await countDailyNewReservations(executor, {
      workspaceId: input.workspaceId,
      learnerUserId: input.learnerUserId,
      localDate: plannedLocalDate,
    });
    const dailyTarget = readInteger(plan, "daily_new_sense_target", "daily new Sense target", 1);
    if (reserved < dailyTarget) {
      candidate = await selectNewCandidate(executor, {
        workspaceId: input.workspaceId,
        learnerUserId: input.learnerUserId,
        studyPlanId: input.studyPlanId,
        learningSessionId: input.learningSessionId,
      });
      reason = "new";
    }

    // Once no new Sense can be introduced, drain the Session's remaining
    // first-retrieval queue even when its final members have fewer than the
    // preferred number of intervening Senses. This gives every introduced
    // Sense one evidence-bearing retrieval before the Session can finish.
    if (candidate === undefined) {
      candidate = await selectDueCandidate(executor, {
        workspaceId: input.workspaceId,
        learnerUserId: input.learnerUserId,
        studyPlanId: input.studyPlanId,
        learningSessionId: input.learningSessionId,
        now,
        allowShortAcquisitionGap: true,
      });
      reason = "due";
    }
    if (candidate === undefined && reserved >= dailyTarget) {
      return { kind: "no_candidate", reason: "daily_new_target_reached" };
    }
  }
  if (candidate === undefined) {
    return { kind: "no_candidate", reason: "no_eligible_sense" };
  }

  // Candidate SQL filters committed declarations.  Recheck after the shared
  // Sense lock to close the race where a declaration commits between SELECT
  // and Encounter INSERT.  The declaration operation will cancel/interrupt a
  // reservation that won the lock first; this branch prevents a stale insert
  // when the declaration won first.
  await lockLearnerSense(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    senseId: String(candidate.sense_id),
  });
  if (await isLearnerSenseMastered(executor, {
    workspaceId: input.workspaceId,
    learnerUserId: input.learnerUserId,
    senseId: String(candidate.sense_id),
  })) {
    return { kind: "no_candidate", reason: "no_eligible_sense" };
  }

  const ordinal = await nextSessionOrdinal(executor, input.learningSessionId);
  const encounterId = executorOptions.encounterId ?? crypto.randomUUID();
  const inserted = await query<Row>(executor, `
    INSERT INTO sensa.sense_encounters (
      sense_encounter_id,
      workspace_id,
      learner_user_id,
      learning_session_id,
      study_plan_id,
      sense_id,
      sense_version_id,
      content_release_id,
      book_version_id,
      session_ordinal,
      kind,
      status,
      revision,
      capability_resolver_version,
      semantic_policy_version,
      stop_policy_version,
      evidence_rule_version,
      state_updater_version,
      outcome_mapping_version,
      planned_at,
      planned_local_date,
      planning_time_zone,
      planning_time_zone_source,
      created_at,
      updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'planned', 1,
      $12, $13, $14, $15, $16, $17, $18, $19::DATE, $20, $21, $18, $18
    )
    RETURNING sense_encounter_id::TEXT AS sense_encounter_id,
              learning_session_id::TEXT AS learning_session_id,
              study_plan_id::TEXT AS study_plan_id,
              sense_id::TEXT AS sense_id,
              sense_version_id::TEXT AS sense_version_id,
              content_release_id::TEXT AS content_release_id,
              book_version_id::TEXT AS book_version_id,
              session_ordinal,
              kind::TEXT AS kind,
              status::TEXT AS status,
              revision,
              capability_resolver_version,
              semantic_policy_version,
              stop_policy_version,
              evidence_rule_version,
              state_updater_version,
              outcome_mapping_version,
              planned_at,
              planned_local_date::TEXT AS planned_local_date,
              planning_time_zone,
              planning_time_zone_source,
              opened_at,
              closed_at,
              created_at,
              updated_at,
              CASE WHEN kind = 'introduction' THEN 'new' ELSE 'due' END AS reason
  `, [
    encounterId,
    input.workspaceId,
    input.learnerUserId,
    input.learningSessionId,
    input.studyPlanId,
    candidate.sense_id,
    candidate.sense_version_id,
    candidate.content_release_id,
    candidate.book_version_id,
    ordinal,
    reason === "new" ? "introduction" : "review",
    sensaExecutableLearningCapabilityResolverVersion,
    sensaSemanticPolicyVersion,
    sensaStopPolicyVersion,
    sensaEvidenceRuleVersion,
    sensaStateUpdaterVersion,
    sensaMemoryOutcomeVersion,
    now,
    plannedLocalDate,
    resolvedTimeZone.timeZone,
    resolvedTimeZone.source,
  ]);
  const row = inserted[0];
  if (row === undefined) {
    throw planningError(500, "The Sensa Encounter was not returned after planning.", "SENSA_PLANNING_SNAPSHOT_INVALID");
  }
  return { kind: "planned_encounter", encounter: mapEncounter(row) };
}

export function createPostgresSensaPlanningModule(
  options: PlanningModuleOptions = {},
): SensaPlanningModule {
  const run = <Result>(
    input: Readonly<{ workspaceId: string; learnerUserId: string }>,
    callback: (executor: DatabaseExecutor) => Promise<Result>,
  ): Promise<Result> => transactionWithWorkspaceScope(createWorkspaceScope(input), callback);

  return {
    async createStudyPlan(input: CreateStudyPlanInput): Promise<CreateStudyPlanResult> {
      try {
        return await run(input, async (executor) => {
          const existingRows = await query<Row>(executor, `
            SELECT study_plan_id::TEXT AS study_plan_id,
                   workspace_id::TEXT AS workspace_id,
                   learner_user_id,
                   book_version_id::TEXT AS book_version_id,
                   status::TEXT AS status,
                   daily_new_sense_target,
                   revision,
                   created_by_replica_id::TEXT AS created_by_replica_id,
                   created_at,
                   updated_at,
                   activated_at,
                   paused_at,
                   completed_at,
                   archived_at
              FROM sensa.study_plans
             WHERE study_plan_id = $1
             FOR UPDATE
          `, [input.studyPlanId]);
          const existing = existingRows[0];
          if (existing !== undefined) {
            if (!samePlanInput(existing, input)) {
              throw planningError(409, "studyPlanId was already used with different canonical Study Plan input.", "SENSA_PLANNING_IDEMPOTENCY_CONFLICT");
            }
            return { status: "replayed", studyPlan: mapStudyPlan(existing) };
          }

          await verifyReplicaScope(executor, {
            replicaId: input.replicaId,
            workspaceId: input.workspaceId,
            learnerUserId: input.learnerUserId,
          });
          const active = await lockActiveStudyPlan(executor, input.workspaceId, input.learnerUserId);
          if (active !== undefined) {
            throw planningError(409, "This learner already has an active Sensa Study Plan.", "SENSA_PLANNING_ACTIVE_PLAN_EXISTS");
          }
          await assertPublicEligibleBook(executor, input.bookVersionId);
          const now = getNow(options);
          const inserted = await query<Row>(executor, `
            INSERT INTO sensa.study_plans (
              study_plan_id,
              workspace_id,
              learner_user_id,
              book_version_id,
              status,
              daily_new_sense_target,
              revision,
              created_by_replica_id,
              created_at,
              updated_at,
              activated_at
            ) VALUES ($1, $2, $3, $4, 'active', $5, 1, $6, $7, $7, $7)
            RETURNING study_plan_id::TEXT AS study_plan_id,
                      workspace_id::TEXT AS workspace_id,
                      learner_user_id,
                      book_version_id::TEXT AS book_version_id,
                      status::TEXT AS status,
                      daily_new_sense_target,
                      revision,
                      created_by_replica_id::TEXT AS created_by_replica_id,
                      created_at,
                      updated_at,
                      activated_at,
                      paused_at,
                      completed_at,
                      archived_at
          `, [
            input.studyPlanId,
            input.workspaceId,
            input.learnerUserId,
            input.bookVersionId,
            input.dailyNewSenseTarget,
            input.replicaId,
            now,
          ]);
          const row = inserted[0];
          if (row === undefined) {
            throw planningError(500, "The Sensa Study Plan was not returned after creation.", "SENSA_PLANNING_SNAPSHOT_INVALID");
          }
          return { status: "created", studyPlan: mapStudyPlan(row) };
        });
      } catch (error) {
        return mapDatabaseError(error);
      }
    },

    async startOrResumeLearningSession(input: StartOrResumeLearningSessionInput): Promise<StartOrResumeLearningSessionResult> {
      try {
        return await run(input, async (executor) => {
          const plan = await lockStudyPlan(executor, input.workspaceId, input.learnerUserId, input.studyPlanId);
          ensureActive(plan, "Study Plan");
          await verifyReplicaScope(executor, {
            replicaId: input.replicaId,
            workspaceId: input.workspaceId,
            learnerUserId: input.learnerUserId,
          });

          const requestedRows = await query<Row>(executor, `
            SELECT learning_session_id::TEXT AS learning_session_id,
                   workspace_id::TEXT AS workspace_id,
                   learner_user_id,
                   study_plan_id::TEXT AS study_plan_id,
                   created_by_replica_id::TEXT AS created_by_replica_id,
                   status::TEXT AS status,
                   revision,
                   started_at,
                   ended_at,
                   created_at,
                   updated_at
              FROM sensa.learning_sessions
             WHERE learning_session_id = $1
             FOR UPDATE
          `, [input.learningSessionId]);
          const requested = requestedRows[0];
          if (requested !== undefined) {
            if (requested.workspace_id !== input.workspaceId
              || requested.learner_user_id !== input.learnerUserId
              || requested.study_plan_id !== input.studyPlanId) {
              throw planningError(409, "learningSessionId belongs to a different Sensa planning scope.", "SENSA_PLANNING_SESSION_SCOPE_CONFLICT");
            }
            if (requested.status !== "active") {
              throw planningError(409, "A terminal Learning Session cannot be resumed.", "SENSA_PLANNING_SESSION_TERMINAL");
            }
            return { status: "resumed", learningSession: mapLearningSession(requested) };
          }

          const existing = await loadExistingSessionForPlan(
            executor,
            input.workspaceId,
            input.learnerUserId,
            input.studyPlanId,
          );
          if (existing !== undefined) {
            return { status: "resumed", learningSession: mapLearningSession(existing) };
          }

          const now = getNow(options);
          const inserted = await query<Row>(executor, `
            INSERT INTO sensa.learning_sessions (
              learning_session_id,
              workspace_id,
              learner_user_id,
              study_plan_id,
              created_by_replica_id,
              status,
              revision,
              started_at,
              created_at,
              updated_at
            ) VALUES ($1, $2, $3, $4, $5, 'active', 1, $6, $6, $6)
            RETURNING learning_session_id::TEXT AS learning_session_id,
                      workspace_id::TEXT AS workspace_id,
                      learner_user_id,
                      study_plan_id::TEXT AS study_plan_id,
                      created_by_replica_id::TEXT AS created_by_replica_id,
                      status::TEXT AS status,
                      revision,
                      started_at,
                      ended_at,
                      created_at,
                      updated_at
          `, [
            input.learningSessionId,
            input.workspaceId,
            input.learnerUserId,
            input.studyPlanId,
            input.replicaId,
            now,
          ]);
          const row = inserted[0];
          if (row === undefined) {
            throw planningError(500, "The Sensa Learning Session was not returned after creation.", "SENSA_PLANNING_SNAPSHOT_INVALID");
          }
          return { status: "started", learningSession: mapLearningSession(row) };
        });
      } catch (error) {
        return mapDatabaseError(error);
      }
    },

    async planNext(input: PlanNextInput): Promise<SensaPlanNextResult> {
      try {
        return await run(input, (executor) => planNextInExecutor(executor, input, { clock: options.clock }));
      } catch (error) {
        return mapDatabaseError(error);
      }
    },
  };
}

export const postgresSensaPlanningModule = createPostgresSensaPlanningModule();

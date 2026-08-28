import type { DatabaseExecutor } from "../../../database/index.js";
import { getDatabaseErrorFields } from "../../../database/transient.js";
import type {
  SensaSyncOperation,
  SensaSyncScope,
} from "@sensa/contracts/sensa";
import { loadPlan, loadSession } from "../snapshots.js";
import {
  asSafeInteger,
  fail,
  query,
  verifyReplicaScope,
  type Row,
} from "../support.js";
import type { OperationExecution } from "./types.js";

type PlanSessionOperation = Extract<
  SensaSyncOperation,
  {
    kind:
      | "study_plan.create"
      | "study_plan.update"
      | "learning_session.start"
      | "learning_session.complete";
  }
>;

async function assertPublicBookVersion(executor: DatabaseExecutor, bookVersionId: string): Promise<void> {
  const rows = await query<Row>(executor, `
    SELECT versions.content_release_id::TEXT AS content_release_id,
           versions.status::TEXT AS book_status,
           releases.status::TEXT AS release_status,
           COUNT(members.sense_version_id)::INTEGER AS member_count,
           COUNT(approved.sense_version_id)::INTEGER AS approved_count,
           COUNT(DISTINCT lexemes.lexeme_id)::INTEGER AS lexeme_count
      FROM sensa.book_versions AS versions
      JOIN sensa.content_releases AS releases ON releases.content_release_id = versions.content_release_id
      LEFT JOIN sensa.book_version_senses AS members ON members.book_version_id = versions.book_version_id
      LEFT JOIN sensa.sense_versions AS approved
        ON approved.sense_version_id = members.sense_version_id
       AND approved.content_release_id = versions.content_release_id
       AND approved.review_status = 'approved'
      LEFT JOIN sensa.senses AS senses ON senses.sense_id = approved.sense_id
      LEFT JOIN sensa.lexeme_versions AS lexemes
        ON lexemes.content_release_id = versions.content_release_id
       AND lexemes.lexeme_id = senses.lexeme_id
     WHERE versions.book_version_id = $1
     GROUP BY versions.content_release_id, versions.status, releases.status
  `, [bookVersionId]);
  const row = rows[0];
  if (row === undefined || row.book_status !== "published" || row.release_status !== "published") fail("content_unavailable", "Study Plans may only pin a published public Book Version.", 409);
  const memberCount = asSafeInteger(row.member_count, "Book member count");
  const approvedCount = asSafeInteger(row.approved_count, "approved Sense count");
  const lexemeCount = asSafeInteger(row.lexeme_count, "distinct Lexeme count");
  if (memberCount < 1_000 || memberCount !== approvedCount || lexemeCount < 1_000) fail("content_unavailable", "The selected Book Version has not passed the 1,000 distinct Lexeme publication gate.", 409);
  const unsatisfied = await query<Row>(executor, `
    SELECT members.sense_version_id
      FROM sensa.book_version_senses AS members
     WHERE members.book_version_id = $1
       AND NOT sensa.book_member_manifest_satisfied($1, members.sense_version_id, (SELECT content_release_id FROM sensa.book_versions WHERE book_version_id = $1))
     LIMIT 1
  `, [bookVersionId]);
  if (unsatisfied[0] !== undefined) fail("content_unavailable", "The selected Book Version has a Sense without a satisfied immutable Content Manifest.", 409);
}

async function insertPlan(executor: DatabaseExecutor, scope: SensaSyncScope, operation: Extract<SensaSyncOperation, { kind: "study_plan.create" }>): Promise<OperationExecution> {
  await verifyReplicaScope(executor, scope);
  const existingRows = await query<Row>(executor, `
    SELECT study_plan_id::TEXT AS study_plan_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           book_version_id::TEXT AS book_version_id,
           status::TEXT AS status,
           daily_new_sense_target
      FROM sensa.study_plans
     WHERE study_plan_id = $1
     FOR UPDATE
  `, [operation.studyPlanId]);
  const existing = existingRows[0];
  if (existing !== undefined) {
    if (existing.workspace_id !== scope.workspaceId || existing.learner_user_id !== scope.learnerUserId || existing.book_version_id !== operation.bookVersionId || existing.status !== "active" || asSafeInteger(existing.daily_new_sense_target, "Study Plan daily target", 1) !== operation.dailyNewSenseTarget) {
      fail("immutable_fact_conflict", "studyPlanId is already used by a different immutable Study Plan.", 409, operation.operationId);
    }
    return { payload: { kind: "study_plan", snapshot: await loadPlan(executor, scope, operation.studyPlanId) }, entities: [], facts: [], rebased: true };
  }
  await assertPublicBookVersion(executor, operation.bookVersionId);
  const active = await query<Row>(executor, `SELECT study_plan_id FROM sensa.study_plans WHERE workspace_id = $1 AND learner_user_id = $2 AND status = 'active' FOR UPDATE`, [scope.workspaceId, scope.learnerUserId]);
  if (active[0] !== undefined) fail("schedule_conflict", "This learner already has an active Sensa Study Plan.", 409, operation.operationId);
  try {
    await executor.query(`INSERT INTO sensa.study_plans (study_plan_id, workspace_id, learner_user_id, book_version_id, status, daily_new_sense_target, revision, created_by_replica_id) VALUES ($1, $2, $3, $4, 'active', $5, 1, $6)`, [operation.studyPlanId, scope.workspaceId, scope.learnerUserId, operation.bookVersionId, operation.dailyNewSenseTarget, scope.replicaId]);
  } catch (caught) {
    const { sqlState } = getDatabaseErrorFields(caught);
    if (sqlState === "23505") fail("immutable_fact_conflict", "studyPlanId is already used by a different immutable Study Plan.", 409, operation.operationId);
    throw caught;
  }
  return { payload: { kind: "study_plan", snapshot: await loadPlan(executor, scope, operation.studyPlanId) }, entities: [{ entityType: "study_plan", entityId: operation.studyPlanId, entityRevision: 1 }], facts: [], rebased: false };
}

async function updatePlan(executor: DatabaseExecutor, scope: SensaSyncScope, operation: Extract<SensaSyncOperation, { kind: "study_plan.update" }>): Promise<OperationExecution> {
  const current = await loadPlan(executor, scope, operation.studyPlanId, true);
  if (current.revision !== operation.expectedRevision) fail("revision_conflict", "Study Plan revision is stale; pull the authoritative snapshot before retrying.", 409, operation.operationId);
  const status = operation.mutation === "pacing" ? current.status : operation.status;
  const target = operation.mutation === "status" ? current.dailyNewSenseTarget : operation.dailyNewSenseTarget;
  if (status === current.status && target === current.dailyNewSenseTarget) fail("invalid_operation", "Study Plan update must change pacing or status.", 400, operation.operationId);
  await executor.query(`UPDATE sensa.study_plans SET status = $1::sensa.study_plan_status, daily_new_sense_target = $2 WHERE study_plan_id = $3 AND revision = $4`, [status, target, operation.studyPlanId, operation.expectedRevision]);
  const snapshot = await loadPlan(executor, scope, operation.studyPlanId);
  return { payload: { kind: "study_plan", snapshot }, entities: [{ entityType: "study_plan", entityId: snapshot.studyPlanId, entityRevision: snapshot.revision }], facts: [], rebased: false };
}

async function startSession(executor: DatabaseExecutor, scope: SensaSyncScope, operation: Extract<SensaSyncOperation, { kind: "learning_session.start" }>): Promise<OperationExecution> {
  const plan = await loadPlan(executor, scope, operation.studyPlanId, true);
  if (plan.status !== "active") fail("schedule_conflict", "An active Study Plan is required to start a Learning Session.", 409, operation.operationId);
  await verifyReplicaScope(executor, scope);
  const existing = await query<Row>(executor, `
    SELECT learning_session_id::TEXT AS learning_session_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           study_plan_id::TEXT AS study_plan_id,
           status::TEXT AS status
      FROM sensa.learning_sessions
     WHERE learning_session_id = $1
     FOR UPDATE
  `, [operation.learningSessionId]);
  if (existing[0] !== undefined) {
    const row = existing[0];
    if (row.workspace_id !== scope.workspaceId || row.learner_user_id !== scope.learnerUserId || row.study_plan_id !== operation.studyPlanId || row.status !== "active") fail("immutable_fact_conflict", "learningSessionId is already used by a different or terminal Session.", 409, operation.operationId);
    const snapshot = await loadSession(executor, scope, operation.learningSessionId);
    return { payload: { kind: "learning_session", snapshot }, entities: [], facts: [], rebased: true };
  }
  const active = await query<Row>(executor, `SELECT learning_session_id FROM sensa.learning_sessions WHERE workspace_id = $1 AND learner_user_id = $2 AND study_plan_id = $3 AND status = 'active' FOR UPDATE`, [scope.workspaceId, scope.learnerUserId, operation.studyPlanId]);
  if (active[0] !== undefined) fail("schedule_conflict", "This Study Plan already has an active Learning Session.", 409, operation.operationId);
  await executor.query(`INSERT INTO sensa.learning_sessions (learning_session_id, workspace_id, learner_user_id, study_plan_id, created_by_replica_id, status, revision) VALUES ($1, $2, $3, $4, $5, 'active', 1)`, [operation.learningSessionId, scope.workspaceId, scope.learnerUserId, operation.studyPlanId, scope.replicaId]);
  const snapshot = await loadSession(executor, scope, operation.learningSessionId);
  return { payload: { kind: "learning_session", snapshot }, entities: [{ entityType: "learning_session", entityId: snapshot.learningSessionId, entityRevision: snapshot.revision }], facts: [], rebased: false };
}

async function completeSession(executor: DatabaseExecutor, scope: SensaSyncScope, operation: Extract<SensaSyncOperation, { kind: "learning_session.complete" }>): Promise<OperationExecution> {
  const current = await loadSession(executor, scope, operation.learningSessionId, true);
  if (current.status !== "active") {
    if (current.status === operation.status) return { payload: { kind: "learning_session", snapshot: current }, entities: [], facts: [], rebased: true };
    fail("terminal_state_conflict", "The Learning Session already has a different terminal state.", 409, operation.operationId);
  }
  if (current.revision !== operation.expectedRevision) fail("revision_conflict", "Learning Session revision is stale; pull the authoritative snapshot before retrying.", 409, operation.operationId);
  await executor.query(`UPDATE sensa.learning_sessions SET status = $1::sensa.learning_session_status WHERE learning_session_id = $2 AND revision = $3`, [operation.status, operation.learningSessionId, operation.expectedRevision]);
  const snapshot = await loadSession(executor, scope, operation.learningSessionId);
  return { payload: { kind: "learning_session", snapshot }, entities: [{ entityType: "learning_session", entityId: snapshot.learningSessionId, entityRevision: snapshot.revision }], facts: [], rebased: false };
}

export async function executePlanSessionOperation(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  operation: PlanSessionOperation,
): Promise<OperationExecution> {
  switch (operation.kind) {
    case "study_plan.create":
      return insertPlan(executor, scope, operation);
    case "study_plan.update":
      return updatePlan(executor, scope, operation);
    case "learning_session.start":
      return startSession(executor, scope, operation);
    case "learning_session.complete":
      return completeSession(executor, scope, operation);
  }
}


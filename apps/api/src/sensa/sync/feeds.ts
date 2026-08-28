import type { DatabaseExecutor } from "../../database/index.js";
import type { LearningAction } from "@sensa/learning-kernel";
import {
  canonicalJsonDigest,
  canonicalLearningActionDigestV3,
  learningActionSchema,
  parseLearningActionPayload,
} from "@sensa/learning-kernel";
import {
  sensaSyncAppendFactTypes,
  sensaSyncChangeActions,
  sensaSyncMutableEntityTypes,
  sensaSyncV2MutableEntityTypes,
} from "@sensa/contracts/sensa";
import type {
  SensaSyncAppendFact,
  SensaSyncChangeAction,
  SensaSyncCursor,
  SensaSyncLearningAttemptFact,
  SensaSyncLearningEvidenceFact,
  SensaSyncMutableChange,
  SensaSyncScope,
  SensaSyncV2MutableChange,
} from "@sensa/contracts/sensa";
import { makeCursor, makeV2Cursor } from "./protocol.js";
import {
  loadEncounter,
  loadLearnerDeclaredMasteryById,
  loadMemory,
  loadOutcome,
  loadPlan,
  loadSemantic,
  loadSession,
} from "./snapshots.js";
import {
  asDate,
  asEnum,
  asSafeInteger,
  canonicalPayload,
  fail,
  query,
  timestamp,
  type Row,
} from "./support.js";

export type FeedEntity = Readonly<{
  entityType:
    | "study_plan"
    | "learning_session"
    | "sense_encounter"
    | "learner_semantic_state"
    | "sense_memory_state"
    | "learner_declared_mastery";
  entityId: string;
  entityRevision: number;
  action?: SensaSyncChangeAction;
  tombstoneReason?: string | null;
}>;

export type FeedFact = Readonly<{
  factType:
    | "learning_action"
    | "learning_attempt"
    | "learning_evidence"
    | "memory_outcome";
  factId: string;
  occurredAt: Date;
}>;

export async function stageFeeds(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  operationId: string,
  entities: readonly FeedEntity[],
  facts: readonly FeedFact[],
): Promise<void> {
  for (const entity of entities) {
    await executor.query(`
      INSERT INTO sensa.sync_mutable_changes (
        workspace_id, learner_user_id, entity_type, entity_id, entity_revision,
        action, tombstone_reason, source_operation_id
      ) VALUES ($1, $2, $3::sensa.sync_mutable_entity_type, $4, $5, $6::sensa.sync_change_action, $7, $8)
    `, [scope.workspaceId, scope.learnerUserId, entity.entityType, entity.entityId, entity.entityRevision, entity.action ?? "upsert", entity.tombstoneReason ?? null, operationId]);
  }

  for (const fact of facts) {
    // The feed timestamp must retain the database fact's microsecond precision.
    const occurredAtSql = fact.factType === "learning_action"
      ? "(SELECT actions.created_at FROM sensa.learning_actions AS actions WHERE actions.learning_action_id = $4 AND actions.workspace_id = $1 AND actions.learner_user_id = $2)"
      : fact.factType === "learning_attempt"
        ? "(SELECT attempts.occurred_at FROM sensa.learning_attempts AS attempts WHERE attempts.learning_attempt_id = $4 AND attempts.workspace_id = $1 AND attempts.learner_user_id = $2)"
        : fact.factType === "learning_evidence"
          ? "(SELECT evidence.occurred_at FROM sensa.learning_evidence AS evidence WHERE evidence.learning_evidence_id = $4 AND evidence.workspace_id = $1 AND evidence.learner_user_id = $2)"
          : "(SELECT outcomes.observed_completed_at FROM sensa.memory_outcomes AS outcomes WHERE outcomes.memory_outcome_id = $4 AND outcomes.workspace_id = $1 AND outcomes.learner_user_id = $2)";
    await executor.query(`
      INSERT INTO sensa.sync_append_facts (
        workspace_id, learner_user_id, fact_type, fact_id, occurred_at, source_operation_id
      ) VALUES ($1, $2, $3::sensa.sync_append_fact_type, $4, ${occurredAtSql}, $5)
    `, [scope.workspaceId, scope.learnerUserId, fact.factType, fact.factId, operationId]);
  }
}

export async function loadAttemptFact(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  attemptId: string,
): Promise<Readonly<{ fact: SensaSyncLearningAttemptFact; occurredAt: Date }>> {
  const rows = await query<Row>(executor, `
    SELECT learning_attempt_id::TEXT AS learning_attempt_id, workspace_id::TEXT AS workspace_id,
           learner_user_id, sense_encounter_id::TEXT AS sense_encounter_id,
           learning_action_id::TEXT AS learning_action_id, ordinal,
           source_replica_id::TEXT AS source_replica_id, response_schema_version,
           response_payload, duration_ms, validity::TEXT AS validity, is_correct,
           evaluation_code, occurred_at, recorded_at, response_digest
      FROM sensa.learning_attempts
     WHERE learning_attempt_id = $1 AND workspace_id = $2 AND learner_user_id = $3
  `, [attemptId, scope.workspaceId, scope.learnerUserId]);
  const row = rows[0];
  if (row === undefined) fail("state_corrupt", "Accepted Learning Attempt is missing.", 500);
  const payload = canonicalPayload(row.response_payload, "Attempt response payload");
  const fact: SensaSyncLearningAttemptFact = {
    learningAttemptId: String(row.learning_attempt_id),
    workspaceId: String(row.workspace_id),
    learnerUserId: String(row.learner_user_id),
    senseEncounterId: String(row.sense_encounter_id),
    learningActionId: String(row.learning_action_id),
    ordinal: asSafeInteger(row.ordinal, "Attempt ordinal", 1),
    sourceReplicaId: String(row.source_replica_id),
    responseSchemaVersion: String(row.response_schema_version),
    responsePayload: { object: payload, digest: String(row.response_digest) },
    durationMs: row.duration_ms === null ? null : asSafeInteger(row.duration_ms, "Attempt duration"),
    validity: asEnum(row.validity, ["valid", "invalid"] as const, "Attempt validity"),
    isCorrect: row.is_correct === null ? null : Boolean(row.is_correct),
    evaluationCode: String(row.evaluation_code),
    occurredAt: timestamp(row.occurred_at, "Attempt occurredAt"),
    recordedAt: timestamp(row.recorded_at, "Attempt recordedAt"),
  };
  return { fact, occurredAt: asDate(row.occurred_at, "Attempt occurredAt") };
}

export async function loadActionFact(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  actionId: string,
): Promise<Readonly<{ fact: SensaSyncAppendFact; occurredAt: Date }>> {
  const rows = await query<Row>(executor, `
    SELECT learning_action_id::TEXT AS learning_action_id,
           workspace_id::TEXT AS workspace_id, learner_user_id,
           sense_encounter_id::TEXT AS sense_encounter_id, ordinal,
           target_dimension::TEXT AS target_dimension, primitive::TEXT AS primitive,
           scaffold_level::TEXT AS scaffold_level, renderer_kind::TEXT AS renderer_kind,
           semantic_policy_decision_code, action_schema_version, evidence_rule_version,
           action_payload, action_digest, created_at
      FROM sensa.learning_actions
     WHERE learning_action_id = $1 AND workspace_id = $2 AND learner_user_id = $3
  `, [actionId, scope.workspaceId, scope.learnerUserId]);
  const row = rows[0];
  if (row === undefined) fail("state_corrupt", "Accepted Learning Action is missing.", 500);
  const payload = parseLearningActionPayload(row.action_payload);
  if (payload === null) fail("state_corrupt", "Accepted Learning Action payload is not closed.", 500);
  const assetRows = await query<Row>(executor, `
    SELECT ordinal, learning_asset_id::TEXT AS learning_asset_id, asset_role
      FROM sensa.learning_action_assets
     WHERE learning_action_id = $1
     ORDER BY ordinal ASC
  `, [actionId]);
  const candidateAction = {
    learningActionId: String(row.learning_action_id),
    ordinal: asSafeInteger(row.ordinal, "Action ordinal", 1),
    targetDimension: String(row.target_dimension),
    primitive: String(row.primitive),
    scaffoldLevel: String(row.scaffold_level),
    rendererKind: String(row.renderer_kind),
    semanticPolicyDecisionCode: String(row.semantic_policy_decision_code),
    actionSchemaVersion: String(row.action_schema_version),
    evidenceRuleVersion: String(row.evidence_rule_version),
    actionPayload: { object: payload, digest: canonicalJsonDigest(payload) },
    actionDigest: String(row.action_digest),
    assets: assetRows.map((asset) => ({
      learningAssetId: String(asset.learning_asset_id),
      ordinal: asSafeInteger(asset.ordinal, "Action Asset ordinal", 1),
      role: String(asset.asset_role),
    })),
  };
  const parsedAction = learningActionSchema.safeParse(candidateAction);
  if (!parsedAction.success) fail("state_corrupt", "Accepted Learning Action failed its runtime contract.", 500);
  const action: LearningAction = parsedAction.data;
  if (action.actionDigest !== canonicalLearningActionDigestV3(String(row.sense_encounter_id), action.ordinal, action.semanticPolicyDecisionCode, payload, action.assets)) {
    fail("state_corrupt", "Accepted Learning Action digest is inconsistent.", 500);
  }
  const fact: SensaSyncAppendFact = {
    factSequence: "" as SensaSyncCursor,
    factType: "learning_action",
    factId: action.learningActionId,
    occurredAt: timestamp(row.created_at, "Learning Action createdAt"),
    fact: {
      action,
      workspaceId: String(row.workspace_id),
      learnerUserId: String(row.learner_user_id),
      senseEncounterId: String(row.sense_encounter_id),
      createdAt: timestamp(row.created_at, "Learning Action createdAt"),
    },
  };
  return { fact, occurredAt: asDate(row.created_at, "Learning Action createdAt") };
}

export async function loadEvidenceFacts(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  attemptId: string,
): Promise<ReadonlyArray<FeedFact>> {
  const rows = await query<Row>(executor, `
    SELECT learning_evidence_id::TEXT AS learning_evidence_id, occurred_at
      FROM sensa.learning_evidence
     WHERE learning_attempt_id = $1 AND workspace_id = $2 AND learner_user_id = $3
     ORDER BY learning_evidence_id ASC
  `, [attemptId, scope.workspaceId, scope.learnerUserId]);
  return rows.map((row) => ({
    factType: "learning_evidence" as const,
    factId: String(row.learning_evidence_id),
    occurredAt: asDate(row.occurred_at, "Evidence occurredAt"),
  }));
}

async function senseIdForMutableEntity(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  table: "learner_semantic_states" | "sense_memory_states",
  idColumn: "learner_semantic_state_id" | "sense_memory_state_id",
  entityId: unknown,
): Promise<string | null> {
  const rows = await query<Row>(executor, `
    SELECT sense_id::TEXT AS sense_id
      FROM sensa.${table}
     WHERE ${idColumn} = $1 AND workspace_id = $2 AND learner_user_id = $3
  `, [entityId, scope.workspaceId, scope.learnerUserId]);
  return rows[0] === undefined ? null : String(rows[0].sense_id);
}

export async function mutableChangeFromRow(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  row: Row,
  epoch: number,
): Promise<SensaSyncMutableChange> {
  const sequence = asSafeInteger(row.mutable_change_sequence, "mutable change sequence", 1);
  const entityType = asEnum(row.entity_type, sensaSyncMutableEntityTypes, "mutable entity type");
  const action = asEnum(row.action, sensaSyncChangeActions, "mutable change action");
  const entityRevision = asSafeInteger(row.entity_revision, "mutable entity revision", 1);
  const base = { mutableSequence: makeCursor(scope, epoch, "mutable", sequence), entityType, entityId: String(row.entity_id), entityRevision };
  if (action === "tombstone") {
    return { ...base, action, snapshot: null, tombstoneReason: String(row.tombstone_reason ?? "entity_unavailable") } as SensaSyncMutableChange;
  }
  let snapshot: SensaSyncMutableChange["snapshot"] = null;
  switch (entityType) {
    case "study_plan": snapshot = await loadPlan(executor, scope, String(row.entity_id)); break;
    case "learning_session": snapshot = await loadSession(executor, scope, String(row.entity_id)); break;
    case "sense_encounter": snapshot = await loadEncounter(executor, scope, String(row.entity_id)); break;
    case "learner_semantic_state": {
      const senseId = await senseIdForMutableEntity(executor, scope, "learner_semantic_states", "learner_semantic_state_id", row.entity_id);
      if (senseId !== null) snapshot = await loadSemantic(executor, scope, senseId);
      break;
    }
    case "sense_memory_state": {
      const senseId = await senseIdForMutableEntity(executor, scope, "sense_memory_states", "sense_memory_state_id", row.entity_id);
      if (senseId !== null) snapshot = await loadMemory(executor, scope, senseId);
      break;
    }
  }
  if (snapshot === null) {
    return { ...base, action: "tombstone", snapshot: null, tombstoneReason: "entity_unavailable" } as SensaSyncMutableChange;
  }
  if (snapshot.revision < entityRevision) fail("state_corrupt", "Mutable feed revision is newer than its authoritative snapshot.", 500);
  return { ...base, entityRevision: snapshot.revision, action: "upsert", snapshot, tombstoneReason: null } as SensaSyncMutableChange;
}

export async function mutableChangeFromV2Row(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  row: Row,
  epoch: number,
): Promise<SensaSyncV2MutableChange> {
  const sequence = asSafeInteger(row.mutable_change_sequence, "mutable change sequence", 1);
  const entityType = asEnum(row.entity_type, sensaSyncV2MutableEntityTypes, "mutable entity type");
  const action = asEnum(row.action, sensaSyncChangeActions, "mutable change action");
  const entityRevision = asSafeInteger(row.entity_revision, "mutable entity revision", 1);
  const base = { mutableSequence: makeV2Cursor(scope, epoch, "mutable", sequence), entityType, entityId: String(row.entity_id), entityRevision };
  if (action === "tombstone") {
    return { ...base, action, snapshot: null, tombstoneReason: String(row.tombstone_reason ?? "entity_unavailable") } as SensaSyncV2MutableChange;
  }
  let snapshot: SensaSyncV2MutableChange["snapshot"] = null;
  switch (entityType) {
    case "study_plan": snapshot = await loadPlan(executor, scope, String(row.entity_id)); break;
    case "learning_session": snapshot = await loadSession(executor, scope, String(row.entity_id)); break;
    case "sense_encounter": snapshot = await loadEncounter(executor, scope, String(row.entity_id)); break;
    case "learner_semantic_state": {
      const senseId = await senseIdForMutableEntity(executor, scope, "learner_semantic_states", "learner_semantic_state_id", row.entity_id);
      if (senseId !== null) snapshot = await loadSemantic(executor, scope, senseId);
      break;
    }
    case "sense_memory_state": {
      const senseId = await senseIdForMutableEntity(executor, scope, "sense_memory_states", "sense_memory_state_id", row.entity_id);
      if (senseId !== null) snapshot = await loadMemory(executor, scope, senseId);
      break;
    }
    case "learner_declared_mastery":
      snapshot = await loadLearnerDeclaredMasteryById(executor, scope, String(row.entity_id));
      break;
  }
  if (snapshot === null) {
    return { ...base, action: "tombstone", snapshot: null, tombstoneReason: "entity_unavailable" } as SensaSyncV2MutableChange;
  }
  if (snapshot.revision < entityRevision) fail("state_corrupt", "Mutable feed revision is newer than its authoritative snapshot.", 500);
  return { ...base, entityRevision: snapshot.revision, action: "upsert", snapshot, tombstoneReason: null } as SensaSyncV2MutableChange;
}

export async function appendFactFromRow(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  row: Row,
  epoch: number,
): Promise<SensaSyncAppendFact> {
  const factType = asEnum(row.fact_type, sensaSyncAppendFactTypes, "append fact type");
  const sequence = asSafeInteger(row.fact_sequence, "fact sequence", 1);
  const factId = String(row.fact_id);
  if (factType === "learning_action") {
    const loaded = await loadActionFact(executor, scope, factId);
    return { ...loaded.fact, factSequence: makeCursor(scope, epoch, "fact", sequence) };
  }
  if (factType === "learning_attempt") {
    const loaded = await loadAttemptFact(executor, scope, factId);
    return { factSequence: makeCursor(scope, epoch, "fact", sequence), factType, factId, occurredAt: loaded.fact.occurredAt, fact: loaded.fact } as SensaSyncAppendFact;
  }
  if (factType === "learning_evidence") {
    const rows = await query<Row>(executor, `
      SELECT learning_evidence_id::TEXT AS learning_evidence_id, workspace_id::TEXT AS workspace_id,
             learner_user_id, sense_id::TEXT AS sense_id, sense_version_id::TEXT AS sense_version_id,
             sense_encounter_id::TEXT AS sense_encounter_id, learning_action_id::TEXT AS learning_action_id,
             learning_attempt_id::TEXT AS learning_attempt_id, dimension::TEXT AS dimension,
             polarity::TEXT AS polarity, context_novelty::TEXT AS context_novelty,
             evidence_rule_version, basis_code, occurred_at, derived_at
        FROM sensa.learning_evidence
       WHERE learning_evidence_id = $1 AND workspace_id = $2 AND learner_user_id = $3
    `, [factId, scope.workspaceId, scope.learnerUserId]);
    const evidence = rows[0];
    if (evidence === undefined) fail("state_corrupt", "Accepted Learning Evidence is missing.", 500);
    const fact: SensaSyncLearningEvidenceFact = {
      learningEvidenceId: String(evidence.learning_evidence_id),
      workspaceId: String(evidence.workspace_id),
      learnerUserId: String(evidence.learner_user_id),
      senseId: String(evidence.sense_id),
      senseVersionId: String(evidence.sense_version_id),
      senseEncounterId: String(evidence.sense_encounter_id),
      learningActionId: String(evidence.learning_action_id),
      learningAttemptId: String(evidence.learning_attempt_id),
      dimension: asEnum(evidence.dimension, ["grounding", "boundary", "form_mapping", "retrieval", "transfer"] as const, "Evidence dimension"),
      polarity: asEnum(evidence.polarity, ["positive", "negative"] as const, "Evidence polarity"),
      contextNovelty: asEnum(evidence.context_novelty, ["familiar", "novel"] as const, "Evidence context novelty"),
      evidenceRuleVersion: String(evidence.evidence_rule_version),
      basisCode: String(evidence.basis_code),
      occurredAt: timestamp(evidence.occurred_at, "Evidence occurredAt"),
      derivedAt: timestamp(evidence.derived_at, "Evidence derivedAt"),
    };
    return { factSequence: makeCursor(scope, epoch, "fact", sequence), factType, factId, occurredAt: fact.occurredAt, fact } as SensaSyncAppendFact;
  }
  const outcome = await loadOutcome(executor, scope, factId);
  return { factSequence: makeCursor(scope, epoch, "fact", sequence), factType, factId, occurredAt: outcome.observedCompletedAt, fact: outcome } as SensaSyncAppendFact;
}

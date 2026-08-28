import { randomUUID } from "node:crypto";

import type { DatabaseExecutor } from "../../database/index.js";
import {
  createEvidenceId,
  createStateDigest,
  emptySemanticState,
  rebuildSemanticState,
  sensaEvidenceRuleV1Version,
  sensaEvidenceRuleVersion,
  sensaRulePacketDimensions,
  sensaStateUpdaterV1Version,
  sensaStateUpdaterVersion,
} from "@sensa/learning-kernel";
import type {
  SensaEvidenceCandidate,
  SensaEvidenceProjectionFact,
  SensaSemanticStateSnapshot,
} from "@sensa/learning-kernel";
import {
  encounterError as error,
  encounterQuery as query,
  toDate,
  toInteger,
  type EncounterQueryRow as Row,
} from "./support.js";

export type SemanticProjectionEncounter = Readonly<{
  sense_encounter_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_id: string;
  evidence_rule_version: string;
}>;

type EvidenceRow = Readonly<{
  learning_evidence_id: string;
  learning_attempt_id: string;
  dimension: string;
  polarity: string;
  context_novelty: string;
  evidence_rule_version: string;
  basis_code: string;
  occurred_at: Date | string;
  derived_at: Date | string;
}>;

type SemanticStateRow = Readonly<{
  learner_semantic_state_id: string;
  workspace_id: string;
  learner_user_id: string;
  sense_id: string;
  grounding_level: string;
  grounding_positive_count: number;
  grounding_failure_streak: number;
  boundary_level: string;
  boundary_positive_count: number;
  boundary_failure_streak: number;
  form_mapping_level: string;
  form_mapping_positive_count: number;
  form_mapping_failure_streak: number;
  retrieval_level: string;
  retrieval_positive_count: number;
  retrieval_failure_streak: number;
  transfer_level: string;
  transfer_positive_count: number;
  transfer_failure_streak: number;
  projection_version: string;
  revision: number | string;
  state_digest: string;
  projected_through_evidence_id: string | null;
}>;

export async function loadEvidence(
  executor: DatabaseExecutor,
  encounterId: string,
): Promise<readonly EvidenceRow[]> {
  return query<EvidenceRow>(executor, `
    SELECT learning_evidence_id::TEXT AS learning_evidence_id,
           learning_attempt_id::TEXT AS learning_attempt_id,
           dimension::TEXT AS dimension,
           polarity::TEXT AS polarity,
           context_novelty::TEXT AS context_novelty,
           evidence_rule_version,
           basis_code,
           occurred_at,
           derived_at
      FROM sensa.learning_evidence
     WHERE sense_encounter_id = $1
     ORDER BY derived_at ASC, learning_evidence_id ASC
  `, [encounterId]);
}

export async function loadSemanticState(
  executor: DatabaseExecutor,
  scope: Readonly<{ workspaceId: string; learnerUserId: string; senseId: string }>,
  forUpdate = false,
): Promise<SensaSemanticStateSnapshot> {
  const rows = await query<SemanticStateRow>(executor, `
    SELECT learner_semantic_state_id::TEXT AS learner_semantic_state_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           sense_id::TEXT AS sense_id,
           grounding_level::TEXT AS grounding_level,
           grounding_positive_count,
           grounding_failure_streak,
           boundary_level::TEXT AS boundary_level,
           boundary_positive_count,
           boundary_failure_streak,
           form_mapping_level::TEXT AS form_mapping_level,
           form_mapping_positive_count,
           form_mapping_failure_streak,
           retrieval_level::TEXT AS retrieval_level,
           retrieval_positive_count,
           retrieval_failure_streak,
           transfer_level::TEXT AS transfer_level,
           transfer_positive_count,
           transfer_failure_streak,
           projection_version,
           revision,
           state_digest,
           projected_through_evidence_id::TEXT AS projected_through_evidence_id
      FROM sensa.learner_semantic_states
     WHERE workspace_id = $1 AND learner_user_id = $2 AND sense_id = $3
     ${forUpdate ? "FOR UPDATE" : ""}
  `, [scope.workspaceId, scope.learnerUserId, scope.senseId]);
  const row = rows[0];
  if (row === undefined) return emptySemanticState(scope.workspaceId, scope.learnerUserId, scope.senseId);
  if (row.projection_version !== sensaStateUpdaterVersion
    && row.projection_version !== sensaStateUpdaterV1Version) {
    throw error("runtime_version_unsupported", "Learner Semantic State uses an unsupported State Updater version.", 409);
  }
  const state = {
    workspaceId: row.workspace_id,
    learnerUserId: row.learner_user_id,
    senseId: row.sense_id,
    grounding: { level: row.grounding_level as "unknown" | "emerging" | "stable", positiveCount: row.grounding_positive_count, failureStreak: row.grounding_failure_streak },
    boundary: { level: row.boundary_level as "unknown" | "emerging" | "stable", positiveCount: row.boundary_positive_count, failureStreak: row.boundary_failure_streak },
    form_mapping: { level: row.form_mapping_level as "unknown" | "emerging" | "stable", positiveCount: row.form_mapping_positive_count, failureStreak: row.form_mapping_failure_streak },
    retrieval: { level: row.retrieval_level as "unknown" | "emerging" | "stable", positiveCount: row.retrieval_positive_count, failureStreak: row.retrieval_failure_streak },
    transfer: { level: row.transfer_level as "unknown" | "emerging" | "stable", positiveCount: row.transfer_positive_count, failureStreak: row.transfer_failure_streak },
    projectionVersion: row.projection_version,
    revision: toInteger(row.revision, "semantic state revision", 1),
    stateDigest: row.state_digest,
    projectedThroughEvidenceId: row.projected_through_evidence_id,
  } satisfies SensaSemanticStateSnapshot;
  if (createStateDigest(state) !== state.stateDigest) throw error("state_corrupt", "Learner Semantic State digest cannot be reproduced.", 500);
  return state;
}

export async function lockSemanticScope(
  executor: DatabaseExecutor,
  scope: Readonly<{ workspaceId: string; learnerUserId: string; senseId: string }>,
): Promise<void> {
  await executor.query(
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text || ':' || $2::text || ':' || $3::text, 0::bigint))",
    [scope.workspaceId, scope.learnerUserId, scope.senseId],
  );
}

export async function persistSemanticEvidence(
  executor: DatabaseExecutor,
  encounter: SemanticProjectionEncounter,
  attemptId: string,
  actionId: string,
  occurredAt: Date,
  evidence: readonly SensaEvidenceCandidate[],
): Promise<SensaSemanticStateSnapshot> {
  if (evidence.length === 0) return loadSemanticState(executor, { workspaceId: encounter.workspace_id, learnerUserId: encounter.learner_user_id, senseId: encounter.sense_id });
  const scope = { workspaceId: encounter.workspace_id, learnerUserId: encounter.learner_user_id, senseId: encounter.sense_id };
  await lockSemanticScope(executor, scope);
  const before = await loadSemanticState(executor, scope, true);
  const previous = await query<Row>(executor, "SELECT MAX(derived_at) AS derived_at FROM sensa.learning_evidence WHERE workspace_id = $1 AND learner_user_id = $2 AND sense_id = $3", [scope.workspaceId, scope.learnerUserId, scope.senseId]);
  const previousDerivedAt = toDate(previous[0]?.derived_at ?? null, "Evidence derived time") ?? new Date(0);
  const inserted: EvidenceRow[] = [];
  const ordered = [...evidence].sort((left, right) => sensaRulePacketDimensions.indexOf(left.dimension) - sensaRulePacketDimensions.indexOf(right.dimension));
  for (let index = 0; index < ordered.length; index += 1) {
    const candidate = ordered[index]!;
    const evidenceId = createEvidenceId(
      attemptId,
      candidate.dimension,
      encounter.evidence_rule_version,
      candidate.basisCode,
    );
    const derivedAt = new Date(previousDerivedAt.getTime() + index + 1);
    const rows = await query<EvidenceRow>(executor, `
      INSERT INTO sensa.learning_evidence (
        learning_evidence_id, workspace_id, learner_user_id, sense_id, sense_version_id,
        sense_encounter_id, learning_action_id, learning_attempt_id, dimension, polarity,
        context_novelty, evidence_rule_version, basis_code, occurred_at, derived_at
      ) SELECT $1, $2, $3, $4, encounters.sense_version_id, $5, $6, $7,
               $8::sensa.mastery_dimension, $9::sensa.evidence_polarity,
               $10::sensa.context_novelty, $11, $12, $13, $14
        FROM sensa.sense_encounters AS encounters
       WHERE encounters.sense_encounter_id = $5
      RETURNING learning_evidence_id::TEXT AS learning_evidence_id,
                dimension::TEXT AS dimension,
                polarity::TEXT AS polarity,
                context_novelty::TEXT AS context_novelty,
                evidence_rule_version,
                basis_code,
                occurred_at,
                derived_at
    `, [evidenceId, scope.workspaceId, scope.learnerUserId, scope.senseId, encounter.sense_encounter_id, actionId, attemptId, candidate.dimension, candidate.polarity, candidate.contextNovelty, encounter.evidence_rule_version, candidate.basisCode, occurredAt, derivedAt]);
    const row = rows[0];
    if (row !== undefined) inserted.push(row);
  }
  if (inserted.length === 0) return before;
  const projectionRows = await query<EvidenceRow>(executor, `
    SELECT learning_evidence_id::TEXT AS learning_evidence_id,
           learning_attempt_id::TEXT AS learning_attempt_id,
           dimension::TEXT AS dimension,
           polarity::TEXT AS polarity,
           context_novelty::TEXT AS context_novelty,
           evidence_rule_version,
           basis_code,
           occurred_at,
           derived_at
      FROM sensa.learning_evidence
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND sense_id = $3
     ORDER BY derived_at ASC, learning_evidence_id ASC
  `, [scope.workspaceId, scope.learnerUserId, scope.senseId]);
  const projectionEvidence = projectionRows.map((row): SensaEvidenceProjectionFact => {
    if (row.evidence_rule_version !== sensaEvidenceRuleV1Version
      && row.evidence_rule_version !== sensaEvidenceRuleVersion) {
      throw error("runtime_version_unsupported", "Learning Evidence uses an unsupported Evidence Rule version.", 409);
    }
    return {
      learningEvidenceId: row.learning_evidence_id,
      dimension: row.dimension as SensaEvidenceCandidate["dimension"],
      polarity: row.polarity as SensaEvidenceCandidate["polarity"],
      contextNovelty: row.context_novelty as SensaEvidenceCandidate["contextNovelty"],
      evidenceRuleVersion: row.evidence_rule_version,
      basisCode: row.basis_code,
    };
  });
  const next = rebuildSemanticState({
    ...scope,
    evidence: projectionEvidence,
    projectionVersion: sensaStateUpdaterVersion,
    revision: before.revision + 1,
  });
  const stateValues = {
    grounding: next.grounding,
    boundary: next.boundary,
    form_mapping: next.form_mapping,
    retrieval: next.retrieval,
    transfer: next.transfer,
  };
  const existingRows = await query<Row>(executor, "SELECT learner_semantic_state_id FROM sensa.learner_semantic_states WHERE workspace_id = $1 AND learner_user_id = $2 AND sense_id = $3 FOR UPDATE", [scope.workspaceId, scope.learnerUserId, scope.senseId]);
  if (existingRows[0] === undefined) {
    await executor.query(`
      INSERT INTO sensa.learner_semantic_states (
        learner_semantic_state_id, workspace_id, learner_user_id, sense_id,
        grounding_level, grounding_positive_count, grounding_failure_streak,
        boundary_level, boundary_positive_count, boundary_failure_streak,
        form_mapping_level, form_mapping_positive_count, form_mapping_failure_streak,
        retrieval_level, retrieval_positive_count, retrieval_failure_streak,
        transfer_level, transfer_positive_count, transfer_failure_streak,
        projection_version, revision, state_digest, projected_through_evidence_id
      ) VALUES ($1, $2, $3, $4,
        $5::sensa.mastery_level, $6, $7, $8::sensa.mastery_level, $9, $10,
        $11::sensa.mastery_level, $12, $13, $14::sensa.mastery_level, $15, $16,
        $17::sensa.mastery_level, $18, $19, $20, 1, $21, $22)
    `, [randomUUID(), scope.workspaceId, scope.learnerUserId, scope.senseId,
      stateValues.grounding.level, stateValues.grounding.positiveCount, stateValues.grounding.failureStreak,
      stateValues.boundary.level, stateValues.boundary.positiveCount, stateValues.boundary.failureStreak,
      stateValues.form_mapping.level, stateValues.form_mapping.positiveCount, stateValues.form_mapping.failureStreak,
      stateValues.retrieval.level, stateValues.retrieval.positiveCount, stateValues.retrieval.failureStreak,
      stateValues.transfer.level, stateValues.transfer.positiveCount, stateValues.transfer.failureStreak,
      sensaStateUpdaterVersion, next.stateDigest, next.projectedThroughEvidenceId]);
  } else {
    await executor.query(`
      UPDATE sensa.learner_semantic_states
         SET grounding_level = $1::sensa.mastery_level, grounding_positive_count = $2, grounding_failure_streak = $3,
             boundary_level = $4::sensa.mastery_level, boundary_positive_count = $5, boundary_failure_streak = $6,
             form_mapping_level = $7::sensa.mastery_level, form_mapping_positive_count = $8, form_mapping_failure_streak = $9,
             retrieval_level = $10::sensa.mastery_level, retrieval_positive_count = $11, retrieval_failure_streak = $12,
             transfer_level = $13::sensa.mastery_level, transfer_positive_count = $14, transfer_failure_streak = $15,
             projection_version = $16, state_digest = $17, projected_through_evidence_id = $18
       WHERE workspace_id = $19 AND learner_user_id = $20 AND sense_id = $21
    `, [stateValues.grounding.level, stateValues.grounding.positiveCount, stateValues.grounding.failureStreak,
      stateValues.boundary.level, stateValues.boundary.positiveCount, stateValues.boundary.failureStreak,
      stateValues.form_mapping.level, stateValues.form_mapping.positiveCount, stateValues.form_mapping.failureStreak,
      stateValues.retrieval.level, stateValues.retrieval.positiveCount, stateValues.retrieval.failureStreak,
      stateValues.transfer.level, stateValues.transfer.positiveCount, stateValues.transfer.failureStreak,
      sensaStateUpdaterVersion, next.stateDigest, next.projectedThroughEvidenceId,
      scope.workspaceId, scope.learnerUserId, scope.senseId]);
  }
  return loadSemanticState(executor, scope);
}


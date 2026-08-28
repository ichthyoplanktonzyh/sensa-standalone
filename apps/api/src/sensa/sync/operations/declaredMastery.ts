import type { DatabaseExecutor } from "../../../database/index.js";
import type {
  SensaSyncScope,
  SensaSyncSenseEncounterSnapshot,
  SensaSyncV2Operation,
} from "@sensa/contracts/sensa";
import type { FeedEntity } from "../feeds.js";
import {
  loadEncounter,
  loadLearnerDeclaredMastery,
} from "../snapshots.js";
import {
  asSafeInteger,
  fail,
  query,
  type Row,
} from "../support.js";
import type { V2OperationExecution } from "./types.js";

async function lockLearnerSense(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  senseId: string,
): Promise<void> {
  await executor.query(
    "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text || ':' || $2::text || ':' || $3::text, 0::bigint))",
    [scope.workspaceId, scope.learnerUserId, senseId],
  );
}

async function loadEncounterSenseIdentity(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  encounterId: string,
): Promise<string> {
  const rows = await query<Row>(executor, `
    SELECT sense_id::TEXT AS sense_id
      FROM sensa.sense_encounters
     WHERE sense_encounter_id = $1
       AND workspace_id = $2
       AND learner_user_id = $3
  `, [encounterId, scope.workspaceId, scope.learnerUserId]);
  const senseId = rows[0]?.sense_id;
  if (typeof senseId !== "string" || senseId.trim() === "") {
    fail("missing_dependency", "The supplied Encounter is not available.", 409);
  }
  return senseId;
}

async function lockNonterminalSenseEncounters(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  senseId: string,
): Promise<ReadonlyArray<Readonly<{ senseEncounterId: string; status: "planned" | "active"; revision: number }>>> {
  const rows = await query<Row>(executor, `
    SELECT sense_encounter_id::TEXT AS sense_encounter_id,
           status::TEXT AS status,
           revision
      FROM sensa.sense_encounters
     WHERE workspace_id = $1
       AND learner_user_id = $2
       AND sense_id = $3
       AND status IN ('planned', 'active')
     ORDER BY sense_encounter_id ASC
     FOR UPDATE
  `, [scope.workspaceId, scope.learnerUserId, senseId]);
  return rows.map((row) => ({
    senseEncounterId: String(row.sense_encounter_id),
    status: row.status === "planned" ? "planned" : "active",
    revision: asSafeInteger(row.revision, "Encounter revision", 1),
  }));
}

export async function executeDeclaredMasteryOperation(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
  operation: Extract<SensaSyncV2Operation, { kind: "learner_declared_mastery.set" }>,
): Promise<V2OperationExecution> {
  const senseRows = await query<Row>(executor, `SELECT sense_id FROM sensa.senses WHERE sense_id = $1`, [operation.senseId]);
  if (senseRows[0] === undefined) fail("missing_dependency", "The requested Sense is not available.", 409, operation.operationId);

  // Validate the optional context's immutable scope before taking any row
  // lock. Encounter identity is immutable, and this keeps a malformed
  // cross-Sense context from introducing a second Sense lock order.
  if (operation.encounter !== undefined) {
    const contextSenseId = await loadEncounterSenseIdentity(
      executor,
      scope,
      operation.encounter.senseEncounterId,
    );
    if (contextSenseId !== operation.senseId) {
      fail("schedule_conflict", "The supplied Encounter belongs to a different Sense.", 409, operation.operationId);
    }
  }

  // This lock is shared by Planning and Encounter.  It protects both the
  // creation of a previously-missing declaration row and the candidate/open
  // decision that could otherwise race this operation.
  await lockLearnerSense(executor, scope, operation.senseId);
  const nonterminalEncounters = await lockNonterminalSenseEncounters(
    executor,
    scope,
    operation.senseId,
  );
  const before = await loadLearnerDeclaredMastery(executor, scope, operation.senseId, true);
  let masteryChanged = false;
  if (before === null) {
    if (operation.expectedRevision !== 0) fail("revision_conflict", "Learner-Declared Mastery does not exist at the requested revision.", 409, operation.operationId);
    if (!operation.isMastered) fail("invalid_operation", "A Learner-Declared Mastery must be created as mastered; revoke only an existing declaration.", 400, operation.operationId);
    await executor.query(`
      INSERT INTO sensa.learner_declared_masteries (
        learner_declared_mastery_id, workspace_id, learner_user_id, sense_id,
        is_mastered, revision, created_by_replica_id, declared_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, TRUE, 1, $5,
                LEAST($6::TIMESTAMPTZ, statement_timestamp()),
                statement_timestamp(), statement_timestamp())
    `, [operation.entityId, scope.workspaceId, scope.learnerUserId, operation.senseId, scope.replicaId, new Date(operation.occurredAt)]);
    masteryChanged = true;
  } else {
    if (before.learnerDeclaredMasteryId !== operation.entityId) {
      fail("immutable_fact_conflict", "entityId does not match the canonical Learner-Declared Mastery for this Sense.", 409, operation.operationId);
    }
    if (before.revision !== operation.expectedRevision) {
      fail("revision_conflict", "Learner-Declared Mastery revision is stale; pull the authoritative snapshot before retrying.", 409, operation.operationId);
    }
    if (before.isMastered !== operation.isMastered) {
      await executor.query(`
        UPDATE sensa.learner_declared_masteries
           SET is_mastered = $4,
               declared_at = CASE
                 WHEN $4 THEN GREATEST(
                   LEAST($5::TIMESTAMPTZ, statement_timestamp()),
                   COALESCE(revoked_at, declared_at)
                 )
                 ELSE declared_at
               END,
               revoked_at = CASE
                 WHEN $4 THEN NULL
                 ELSE GREATEST(
                   LEAST($5::TIMESTAMPTZ, statement_timestamp()),
                   declared_at
                 )
               END
         WHERE learner_declared_mastery_id = $1
           AND workspace_id = $2
           AND learner_user_id = $3
           AND revision = $6
      `, [operation.entityId, scope.workspaceId, scope.learnerUserId, operation.isMastered, new Date(operation.occurredAt), operation.expectedRevision]);
      masteryChanged = true;
    }
  }

  const snapshot = await loadLearnerDeclaredMastery(executor, scope, operation.senseId);
  if (snapshot === null) fail("state_corrupt", "Learner-Declared Mastery disappeared after mutation.", 500, operation.operationId);

  let encounter: SensaSyncSenseEncounterSnapshot | null = null;
  const entities: FeedEntity[] = masteryChanged
    ? [{
        entityType: "learner_declared_mastery",
        entityId: snapshot.learnerDeclaredMasteryId,
        entityRevision: snapshot.revision,
      }]
    : [];
  let encounterChanged = false;
  if (operation.encounter !== undefined) {
    const current = await loadEncounter(executor, scope, operation.encounter.senseEncounterId, true);
    if (["planned", "active"].includes(current.status)
      && current.revision !== operation.encounter.expectedRevision) {
      fail("revision_conflict", "The supplied Encounter revision is stale; pull the authoritative Encounter before retrying.", 409, operation.operationId);
    }
  }

  if (operation.isMastered) {
    for (const candidate of nonterminalEncounters) {
      const terminalStatus = candidate.status === "planned" ? "cancelled" : "interrupted";
      const updated = await executor.query(`
        UPDATE sensa.sense_encounters
           SET status = $2::sensa.encounter_status
         WHERE sense_encounter_id = $1
           AND status = $3::sensa.encounter_status
           AND revision = $4
      `, [candidate.senseEncounterId, terminalStatus, candidate.status, candidate.revision]);
      if (updated.rowCount !== 1) {
        fail("schedule_conflict", "A same-Sense Encounter changed before Learner-Declared Mastery could close it.", 409, operation.operationId, true);
      }
      const changed = await loadEncounter(executor, scope, candidate.senseEncounterId);
      encounterChanged = true;
      entities.push({
        entityType: "sense_encounter",
        entityId: changed.senseEncounterId,
        entityRevision: changed.revision,
      });
      if (operation.encounter?.senseEncounterId === changed.senseEncounterId) {
        encounter = changed;
      }
    }
  }

  if (operation.encounter !== undefined && encounter === null) {
    encounter = await loadEncounter(executor, scope, operation.encounter.senseEncounterId);
  }

  return {
    payload: { kind: "learner_declared_mastery", snapshot, encounter },
    entities,
    facts: [],
    rebased: !masteryChanged && !encounterChanged,
  };
}


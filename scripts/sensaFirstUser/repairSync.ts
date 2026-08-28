#!/usr/bin/env tsx

/**
 * Local-only repair for the first-user Sensa Sync ledger after an explicit
 * Study Plan replacement.  This is intentionally not a general history
 * cleanup command: every candidate row must be attributable to the supplied
 * archived Plan, and any operation that also carries a retained row aborts.
 */

import pg from "pg";
import process from "node:process";

const { Pool } = pg;

const defaultDatabaseUrl = "postgresql://localhost:5432/sensa_standalone_dev";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type JsonObject = Record<string, unknown>;
type DatabaseClient = pg.PoolClient;

type RepairOptions = Readonly<{
  databaseUrl: string;
  workspaceId: string;
  learnerUserId: string;
  planId: string;
  allowInsecureLocalDb: boolean;
  dryRun: boolean;
}>;

type MutableFeedRow = Readonly<{
  sequence: string;
  entityType: string;
  entityId: string;
  operationId: string;
  canonicalExists: boolean;
}>;

type FactFeedRow = Readonly<{
  sequence: string;
  factType: string;
  factId: string;
  operationId: string;
  canonicalExists: boolean;
}>;

type ScopeSnapshot = Readonly<{
  activePlanId: string | null;
  planCount: number;
  sessionCount: number;
  encounterCount: number;
  actionCount: number;
  attemptCount: number;
  evidenceCount: number;
  outcomeCount: number;
  semanticStateCount: number;
  memoryStateCount: number;
  masteryCount: number;
}>;

function fail(message: string): never {
  throw new Error(message);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string`);
  return value;
}

function requireUuid(value: unknown, label: string): string {
  const result = requireString(value, label).toLowerCase();
  if (!uuidPattern.test(result)) fail(`${label} must be a UUID`);
  return result;
}

function parseArgs(argv: readonly string[]): RepairOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const options = new Set([
    "--database-url",
    "--workspace-id",
    "--learner-user-id",
    "--plan-id",
  ]);
  const knownFlags = new Set(["--allow-insecure-local-db", "--dry-run", "--help"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (knownFlags.has(arg)) {
      flags.add(arg);
      continue;
    }
    if (!options.has(arg)) fail(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
    values.set(arg, value);
    index += 1;
  }
  if (flags.has("--help")) {
    console.log(`Usage: npm run sensa:repair-first-user-sync -- \\
  --workspace-id WORKSPACE_UUID \\
  --learner-user-id LEARNER_ID \\
  --plan-id ARCHIVED_PLAN_UUID \\
  [--database-url postgresql://...@localhost:5432/sensa_standalone_dev] \\
  [--allow-insecure-local-db] [--dry-run]`);
    process.exit(0);
  }
  const workspaceId = requireUuid(values.get("--workspace-id"), "--workspace-id");
  const planId = requireUuid(values.get("--plan-id"), "--plan-id");
  const learnerUserId = values.get("--learner-user-id");
  if (learnerUserId === undefined || learnerUserId.trim() === "" || learnerUserId.length > 256) {
    fail("--learner-user-id must be a non-empty value of at most 256 characters");
  }
  const databaseUrl = values.get("--database-url")
    ?? process.env.SENSA_FIRST_USER_DATABASE_URL
    ?? process.env.DATABASE_URL
    ?? defaultDatabaseUrl;
  const allowInsecureLocalDb = flags.has("--allow-insecure-local-db")
    || process.env.SENSA_FIRST_USER_ALLOW_INSECURE_LOCAL_DB === "true";
  if (!allowInsecureLocalDb) {
    fail("This local repair requires --allow-insecure-local-db or SENSA_FIRST_USER_ALLOW_INSECURE_LOCAL_DB=true");
  }
  assertLoopbackDatabaseUrl(databaseUrl);
  return {
    databaseUrl,
    workspaceId,
    learnerUserId,
    planId,
    allowInsecureLocalDb,
    dryRun: flags.has("--dry-run"),
  };
}

function assertLoopbackDatabaseUrl(databaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("--database-url must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    fail("--database-url must use postgresql:// or postgres://");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, "");
  const isLoopback = hostname === "localhost"
    || hostname === "::1"
    || /^127(?:\.[0-9]{1,3}){3}$/u.test(hostname);
  if (!isLoopback) fail(`Refusing non-loopback database host ${parsed.hostname}; this command is local-only`);
}

async function queryRows<T extends pg.QueryResultRow>(
  client: DatabaseClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<readonly T[]> {
  return (await client.query<T>(sql, params as unknown[])).rows;
}

async function queryOne<T extends pg.QueryResultRow>(
  client: DatabaseClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  return (await client.query<T>(sql, params as unknown[])).rows[0];
}

function containsString(value: unknown, target: string): boolean {
  if (value === target) return true;
  if (Array.isArray(value)) return value.some((item) => containsString(item, target));
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some((item) => containsString(item, target));
}

function containsAnyString(value: unknown, targets: ReadonlySet<string>): boolean {
  for (const target of targets) {
    if (containsString(value, target)) return true;
  }
  return false;
}

async function canonicalMutableExists(
  client: DatabaseClient,
  row: Readonly<{ entityType: string; entityId: string }>,
  scope: RepairOptions,
): Promise<boolean> {
  const tableByType: Readonly<Record<string, string>> = {
    study_plan: "study_plans",
    learning_session: "learning_sessions",
    sense_encounter: "sense_encounters",
    learner_semantic_state: "learner_semantic_states",
    sense_memory_state: "sense_memory_states",
  };
  const table = tableByType[row.entityType];
  if (table === undefined) fail(`Unsupported mutable entity type ${row.entityType}`);
  const idColumnByType: Readonly<Record<string, string>> = {
    study_plan: "study_plan_id",
    learning_session: "learning_session_id",
    sense_encounter: "sense_encounter_id",
    learner_semantic_state: "learner_semantic_state_id",
    sense_memory_state: "sense_memory_state_id",
  };
  const idColumn = idColumnByType[row.entityType];
  if (idColumn === undefined) fail(`Unsupported mutable entity type ${row.entityType}`);
  const found = await queryOne<JsonObject>(client, `
    SELECT 1
      FROM sensa.${table}
     WHERE ${idColumn} = $1
       AND workspace_id = $2
       AND learner_user_id = $3
     LIMIT 1
  `, [row.entityId, scope.workspaceId, scope.learnerUserId]);
  return found !== undefined;
}

async function canonicalFactExists(
  client: DatabaseClient,
  row: Readonly<{ factType: string; factId: string }>,
  scope: RepairOptions,
): Promise<boolean> {
  const tableByType: Readonly<Record<string, string>> = {
    learning_action: "learning_actions",
    learning_attempt: "learning_attempts",
    learning_evidence: "learning_evidence",
    memory_outcome: "memory_outcomes",
  };
  const idColumnByType: Readonly<Record<string, string>> = {
    learning_action: "learning_action_id",
    learning_attempt: "learning_attempt_id",
    learning_evidence: "learning_evidence_id",
    memory_outcome: "memory_outcome_id",
  };
  const table = tableByType[row.factType];
  const idColumn = idColumnByType[row.factType];
  if (table === undefined || idColumn === undefined) fail(`Unsupported append fact type ${row.factType}`);
  const found = await queryOne<JsonObject>(client, `
    SELECT 1
      FROM sensa.${table}
     WHERE ${idColumn} = $1
       AND workspace_id = $2
       AND learner_user_id = $3
     LIMIT 1
  `, [row.factId, scope.workspaceId, scope.learnerUserId]);
  return found !== undefined;
}

async function loadScopeSnapshot(client: DatabaseClient, scope: RepairOptions): Promise<ScopeSnapshot> {
  const row = await queryOne<JsonObject>(client, `
    SELECT
      (SELECT study_plan_id::TEXT FROM sensa.study_plans WHERE workspace_id = $1 AND learner_user_id = $2 AND status = 'active' LIMIT 1) AS active_plan_id,
      (SELECT COUNT(*)::INTEGER FROM sensa.study_plans WHERE workspace_id = $1 AND learner_user_id = $2) AS plan_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.learning_sessions WHERE workspace_id = $1 AND learner_user_id = $2) AS session_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.sense_encounters WHERE workspace_id = $1 AND learner_user_id = $2) AS encounter_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.learning_actions WHERE workspace_id = $1 AND learner_user_id = $2) AS action_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.learning_attempts WHERE workspace_id = $1 AND learner_user_id = $2) AS attempt_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.learning_evidence WHERE workspace_id = $1 AND learner_user_id = $2) AS evidence_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.memory_outcomes WHERE workspace_id = $1 AND learner_user_id = $2) AS outcome_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.learner_semantic_states WHERE workspace_id = $1 AND learner_user_id = $2) AS semantic_state_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.sense_memory_states WHERE workspace_id = $1 AND learner_user_id = $2) AS memory_state_count,
      (SELECT COUNT(*)::INTEGER FROM sensa.learner_declared_masteries WHERE workspace_id = $1 AND learner_user_id = $2) AS mastery_count
  `, [scope.workspaceId, scope.learnerUserId]);
  if (row === undefined) fail("Could not capture the learner scope snapshot");
  return {
    activePlanId: row.active_plan_id === null ? null : requireString(row.active_plan_id, "active Plan ID"),
    planCount: Number(row.plan_count ?? -1),
    sessionCount: Number(row.session_count ?? -1),
    encounterCount: Number(row.encounter_count ?? -1),
    actionCount: Number(row.action_count ?? -1),
    attemptCount: Number(row.attempt_count ?? -1),
    evidenceCount: Number(row.evidence_count ?? -1),
    outcomeCount: Number(row.outcome_count ?? -1),
    semanticStateCount: Number(row.semantic_state_count ?? -1),
    memoryStateCount: Number(row.memory_state_count ?? -1),
    masteryCount: Number(row.mastery_count ?? -1),
  };
}

function assertScopeSnapshotUnchanged(before: ScopeSnapshot, after: ScopeSnapshot): void {
  const keys: readonly (keyof ScopeSnapshot)[] = [
    "activePlanId",
    "planCount",
    "sessionCount",
    "encounterCount",
    "actionCount",
    "attemptCount",
    "evidenceCount",
    "outcomeCount",
    "semanticStateCount",
    "memoryStateCount",
    "masteryCount",
  ];
  for (const key of keys) {
    if (before[key] !== after[key]) fail(`Learner scope changed during repair at ${key}`);
  }
}

async function verifySyncOperationBounds(client: DatabaseClient, scope: RepairOptions): Promise<void> {
  const rows = await queryRows<JsonObject>(client, `
    SELECT operations.operation_id,
           operations.first_mutable_sequence::TEXT AS first_mutable_sequence,
           operations.last_mutable_sequence::TEXT AS last_mutable_sequence,
           operations.first_fact_sequence::TEXT AS first_fact_sequence,
           operations.last_fact_sequence::TEXT AS last_fact_sequence,
           (SELECT MIN(changes.mutable_change_sequence)::TEXT FROM sensa.sync_mutable_changes AS changes WHERE changes.workspace_id = operations.workspace_id AND changes.learner_user_id = operations.learner_user_id AND changes.source_operation_id = operations.operation_id) AS actual_first_mutable_sequence,
           (SELECT MAX(changes.mutable_change_sequence)::TEXT FROM sensa.sync_mutable_changes AS changes WHERE changes.workspace_id = operations.workspace_id AND changes.learner_user_id = operations.learner_user_id AND changes.source_operation_id = operations.operation_id) AS actual_last_mutable_sequence,
           (SELECT MIN(facts.fact_sequence)::TEXT FROM sensa.sync_append_facts AS facts WHERE facts.workspace_id = operations.workspace_id AND facts.learner_user_id = operations.learner_user_id AND facts.source_operation_id = operations.operation_id) AS actual_first_fact_sequence,
           (SELECT MAX(facts.fact_sequence)::TEXT FROM sensa.sync_append_facts AS facts WHERE facts.workspace_id = operations.workspace_id AND facts.learner_user_id = operations.learner_user_id AND facts.source_operation_id = operations.operation_id) AS actual_last_fact_sequence
      FROM sensa.sync_operations AS operations
     WHERE operations.workspace_id = $1 AND operations.learner_user_id = $2
  `, [scope.workspaceId, scope.learnerUserId]);
  for (const row of rows) {
    const operationId = requireString(row.operation_id, "Sensa Sync operation ID");
    const check = (left: unknown, right: unknown, label: string) => {
      const actual = left === null || left === undefined ? null : String(left);
      const expected = right === null || right === undefined ? null : String(right);
      if (actual !== expected) fail(`${operationId} ${label} does not match its feed rows`);
    };
    check(row.first_mutable_sequence, row.actual_first_mutable_sequence, "first mutable bound");
    check(row.last_mutable_sequence, row.actual_last_mutable_sequence, "last mutable bound");
    check(row.first_fact_sequence, row.actual_first_fact_sequence, "first fact bound");
    check(row.last_fact_sequence, row.actual_last_fact_sequence, "last fact bound");
  }
}

async function verifyNoOrphanFeedRows(client: DatabaseClient, scope: RepairOptions): Promise<void> {
  const mutable = await queryOne<JsonObject>(client, `
    SELECT COUNT(*)::INTEGER AS count
      FROM sensa.sync_mutable_changes AS changes
     WHERE changes.workspace_id = $1
       AND changes.learner_user_id = $2
       AND (
         (changes.entity_type = 'study_plan' AND NOT EXISTS (SELECT 1 FROM sensa.study_plans AS rows WHERE rows.study_plan_id = changes.entity_id AND rows.workspace_id = changes.workspace_id AND rows.learner_user_id = changes.learner_user_id))
         OR (changes.entity_type = 'learning_session' AND NOT EXISTS (SELECT 1 FROM sensa.learning_sessions AS rows WHERE rows.learning_session_id = changes.entity_id AND rows.workspace_id = changes.workspace_id AND rows.learner_user_id = changes.learner_user_id))
         OR (changes.entity_type = 'sense_encounter' AND NOT EXISTS (SELECT 1 FROM sensa.sense_encounters AS rows WHERE rows.sense_encounter_id = changes.entity_id AND rows.workspace_id = changes.workspace_id AND rows.learner_user_id = changes.learner_user_id))
         OR (changes.entity_type = 'learner_semantic_state' AND NOT EXISTS (SELECT 1 FROM sensa.learner_semantic_states AS rows WHERE rows.learner_semantic_state_id = changes.entity_id AND rows.workspace_id = changes.workspace_id AND rows.learner_user_id = changes.learner_user_id))
         OR (changes.entity_type = 'sense_memory_state' AND NOT EXISTS (SELECT 1 FROM sensa.sense_memory_states AS rows WHERE rows.sense_memory_state_id = changes.entity_id AND rows.workspace_id = changes.workspace_id AND rows.learner_user_id = changes.learner_user_id))
       )
  `, [scope.workspaceId, scope.learnerUserId]);
  if (Number(mutable?.count ?? -1) !== 0) fail("Sensa Sync still has orphan mutable changes in the repaired learner scope");
  const facts = await queryOne<JsonObject>(client, `
    SELECT COUNT(*)::INTEGER AS count
      FROM sensa.sync_append_facts AS facts
     WHERE facts.workspace_id = $1
       AND facts.learner_user_id = $2
       AND (
         (facts.fact_type = 'learning_action' AND NOT EXISTS (SELECT 1 FROM sensa.learning_actions AS rows WHERE rows.learning_action_id = facts.fact_id AND rows.workspace_id = facts.workspace_id AND rows.learner_user_id = facts.learner_user_id))
         OR (facts.fact_type = 'learning_attempt' AND NOT EXISTS (SELECT 1 FROM sensa.learning_attempts AS rows WHERE rows.learning_attempt_id = facts.fact_id AND rows.workspace_id = facts.workspace_id AND rows.learner_user_id = facts.learner_user_id))
         OR (facts.fact_type = 'learning_evidence' AND NOT EXISTS (SELECT 1 FROM sensa.learning_evidence AS rows WHERE rows.learning_evidence_id = facts.fact_id AND rows.workspace_id = facts.workspace_id AND rows.learner_user_id = facts.learner_user_id))
         OR (facts.fact_type = 'memory_outcome' AND NOT EXISTS (SELECT 1 FROM sensa.memory_outcomes AS rows WHERE rows.memory_outcome_id = facts.fact_id AND rows.workspace_id = facts.workspace_id AND rows.learner_user_id = facts.learner_user_id))
       )
  `, [scope.workspaceId, scope.learnerUserId]);
  if (Number(facts?.count ?? -1) !== 0) fail("Sensa Sync still has orphan append facts in the repaired learner scope");
}

async function repair(client: DatabaseClient, scope: RepairOptions): Promise<JsonObject> {
  const plan = await queryOne<JsonObject>(client, `
    SELECT study_plan_id::TEXT AS study_plan_id,
           workspace_id::TEXT AS workspace_id,
           learner_user_id,
           status::TEXT AS status
      FROM sensa.study_plans
     WHERE study_plan_id = $1
     FOR UPDATE
  `, [scope.planId]);
  if (plan === undefined) fail(`Study Plan ${scope.planId} does not exist`);
  if (plan.workspace_id !== scope.workspaceId || plan.learner_user_id !== scope.learnerUserId) {
    fail("Repair Study Plan does not belong to the requested learner and Workspace");
  }
  if (plan.status !== "archived") fail(`Repair requires an archived old Plan; got ${String(plan.status)}`);

  const before = await loadScopeSnapshot(client, scope);
  if (before.activePlanId === scope.planId) fail("Repair target Plan is still active");

  const sessionRows = await queryRows<JsonObject>(client, `
    SELECT learning_session_id::TEXT AS id
      FROM sensa.learning_sessions
     WHERE workspace_id = $1 AND learner_user_id = $2 AND study_plan_id = $3
     FOR UPDATE
  `, [scope.workspaceId, scope.learnerUserId, scope.planId]);
  const encounterRows = await queryRows<JsonObject>(client, `
    SELECT sense_encounter_id::TEXT AS id
      FROM sensa.sense_encounters
     WHERE workspace_id = $1 AND learner_user_id = $2 AND study_plan_id = $3
     FOR UPDATE
  `, [scope.workspaceId, scope.learnerUserId, scope.planId]);
  const sessionIds = new Set(sessionRows.map((row) => requireString(row.id, "old Plan session ID")));
  const encounterIds = new Set(encounterRows.map((row) => requireString(row.id, "old Plan encounter ID")));
  const oldFacts = await queryOne<JsonObject>(client, `
    SELECT
      (SELECT COUNT(*)::INTEGER FROM sensa.learning_attempts AS rows JOIN sensa.sense_encounters AS encounters ON encounters.sense_encounter_id = rows.sense_encounter_id WHERE rows.workspace_id = $1 AND rows.learner_user_id = $2 AND encounters.study_plan_id = $3) AS attempts,
      (SELECT COUNT(*)::INTEGER FROM sensa.learning_evidence AS rows JOIN sensa.sense_encounters AS encounters ON encounters.sense_encounter_id = rows.sense_encounter_id WHERE rows.workspace_id = $1 AND rows.learner_user_id = $2 AND encounters.study_plan_id = $3) AS evidence,
      (SELECT COUNT(*)::INTEGER FROM sensa.memory_outcomes AS rows JOIN sensa.sense_encounters AS encounters ON encounters.sense_encounter_id = rows.sense_encounter_id WHERE rows.workspace_id = $1 AND rows.learner_user_id = $2 AND encounters.study_plan_id = $3) AS outcomes
  `, [scope.workspaceId, scope.learnerUserId, scope.planId]);
  if (Number(oldFacts?.attempts ?? -1) !== 0 || Number(oldFacts?.evidence ?? -1) !== 0 || Number(oldFacts?.outcomes ?? -1) !== 0) {
    fail(`Refusing to repair old Plan ${scope.planId}: learning history remains in its runtime rows`);
  }

  const operationRows = await queryRows<JsonObject>(client, `
    SELECT operation_id, result_payload
      FROM sensa.sync_operations
     WHERE workspace_id = $1 AND learner_user_id = $2
     FOR UPDATE
  `, [scope.workspaceId, scope.learnerUserId]);
  const operationPayloads = new Map<string, unknown>();
  for (const row of operationRows) operationPayloads.set(requireString(row.operation_id, "operation ID"), row.result_payload);
  const mutableRaw = await queryRows<JsonObject>(client, `
    SELECT mutable_change_sequence::TEXT AS sequence,
           entity_type::TEXT AS entity_type,
           entity_id::TEXT AS entity_id,
           source_operation_id
      FROM sensa.sync_mutable_changes
     WHERE workspace_id = $1 AND learner_user_id = $2
     FOR UPDATE
  `, [scope.workspaceId, scope.learnerUserId]);
  const factRaw = await queryRows<JsonObject>(client, `
    SELECT fact_sequence::TEXT AS sequence,
           fact_type::TEXT AS fact_type,
           fact_id::TEXT AS fact_id,
           source_operation_id
      FROM sensa.sync_append_facts
     WHERE workspace_id = $1 AND learner_user_id = $2
     FOR UPDATE
  `, [scope.workspaceId, scope.learnerUserId]);

  const mutableRows: MutableFeedRow[] = [];
  for (const row of mutableRaw) {
    const sequence = requireString(row.sequence, "mutable sequence");
    const entityType = requireString(row.entity_type, "mutable entity type");
    const entityId = requireUuid(row.entity_id, "mutable entity ID");
    const operationId = requireString(row.source_operation_id, "mutable source operation ID");
    const canonicalExists = await canonicalMutableExists(client, { entityType, entityId }, scope);
    mutableRows.push({ sequence, entityType, entityId, operationId, canonicalExists });
    if (entityType === "learning_session" && !canonicalExists && containsString(operationPayloads.get(operationId), scope.planId)) sessionIds.add(entityId);
    if (entityType === "sense_encounter" && !canonicalExists && containsString(operationPayloads.get(operationId), scope.planId)) encounterIds.add(entityId);
  }

  const factRows: FactFeedRow[] = [];
  for (const row of factRaw) {
    const sequence = requireString(row.sequence, "fact sequence");
    const factType = requireString(row.fact_type, "fact type");
    const factId = requireUuid(row.fact_id, "fact ID");
    const operationId = requireString(row.source_operation_id, "fact source operation ID");
    const canonicalExists = await canonicalFactExists(client, { factType, factId }, scope);
    factRows.push({ sequence, factType, factId, operationId, canonicalExists });
  }

  const targetMutableSequences = new Set<string>();
  const targetFactSequences = new Set<string>();
  const targetOperationIds = new Set<string>();
  for (const row of mutableRows) {
    const targetEntity = (row.entityType === "learning_session" && sessionIds.has(row.entityId))
      || (row.entityType === "sense_encounter" && encounterIds.has(row.entityId));
    if (targetEntity) {
      if (row.canonicalExists) fail(`Repair target mutable entity ${row.entityType}/${row.entityId} still exists unexpectedly`);
      targetMutableSequences.add(row.sequence);
      targetOperationIds.add(row.operationId);
    } else if (!row.canonicalExists) {
      fail(`Found an orphan mutable entity outside the explicitly targeted archived Plan: ${row.entityType}/${row.entityId}`);
    }
  }
  for (const row of factRows) {
    const payload = operationPayloads.get(row.operationId);
    const targetContext = containsString(payload, scope.planId)
      || containsAnyString(payload, encounterIds)
      || containsAnyString(payload, sessionIds);
    if (!row.canonicalExists && targetContext) {
      targetFactSequences.add(row.sequence);
      targetOperationIds.add(row.operationId);
    } else if (!row.canonicalExists) {
      fail(`Found an orphan append fact outside the explicitly targeted archived Plan: ${row.factType}/${row.factId}`);
    } else if (targetContext && targetOperationIds.has(row.operationId)) {
      fail(`Refusing to delete operation ${row.operationId}: it references a retained append fact ${row.factType}/${row.factId}`);
    }
  }

  const targetOperations = [...targetOperationIds];
  const allMutableByOperation = targetOperations.length === 0 ? [] : await queryRows<JsonObject>(client, `
    SELECT mutable_change_sequence::TEXT AS sequence, source_operation_id
      FROM sensa.sync_mutable_changes
     WHERE workspace_id = $1 AND learner_user_id = $2 AND source_operation_id = ANY($3::TEXT[])
     FOR UPDATE
  `, [scope.workspaceId, scope.learnerUserId, targetOperations]);
  const allFactsByOperation = targetOperations.length === 0 ? [] : await queryRows<JsonObject>(client, `
    SELECT fact_sequence::TEXT AS sequence, source_operation_id
      FROM sensa.sync_append_facts
     WHERE workspace_id = $1 AND learner_user_id = $2 AND source_operation_id = ANY($3::TEXT[])
     FOR UPDATE
  `, [scope.workspaceId, scope.learnerUserId, targetOperations]);
  for (const row of allMutableByOperation) {
    const sequence = requireString(row.sequence, "operation mutable sequence");
    if (!targetMutableSequences.has(sequence)) fail(`Refusing to delete operation ${String(row.source_operation_id)}: it references a retained mutable entity`);
  }
  for (const row of allFactsByOperation) {
    const sequence = requireString(row.sequence, "operation fact sequence");
    if (!targetFactSequences.has(sequence)) fail(`Refusing to delete operation ${String(row.source_operation_id)}: it references a retained fact`);
  }

  const deletedSessions = await client.query(`
    DELETE FROM sensa.learning_sessions
     WHERE workspace_id = $1 AND learner_user_id = $2 AND study_plan_id = $3
  `, [scope.workspaceId, scope.learnerUserId, scope.planId]);
  const deletedMutable = targetMutableSequences.size === 0 ? { rowCount: 0 } : await client.query(`
    DELETE FROM sensa.sync_mutable_changes
     WHERE workspace_id = $1 AND learner_user_id = $2 AND mutable_change_sequence = ANY($3::BIGINT[])
  `, [scope.workspaceId, scope.learnerUserId, [...targetMutableSequences]]);
  const deletedFacts = targetFactSequences.size === 0 ? { rowCount: 0 } : await client.query(`
    DELETE FROM sensa.sync_append_facts
     WHERE workspace_id = $1 AND learner_user_id = $2 AND fact_sequence = ANY($3::BIGINT[])
  `, [scope.workspaceId, scope.learnerUserId, [...targetFactSequences]]);
  const deletedOperations = targetOperations.length === 0 ? { rowCount: 0 } : await client.query(`
    DELETE FROM sensa.sync_operations
     WHERE workspace_id = $1 AND learner_user_id = $2 AND operation_id = ANY($3::TEXT[])
  `, [scope.workspaceId, scope.learnerUserId, targetOperations]);
  if (Number(deletedSessions.rowCount ?? -1) !== sessionRows.length
    || Number(deletedMutable.rowCount ?? -1) !== targetMutableSequences.size
    || Number(deletedFacts.rowCount ?? -1) !== targetFactSequences.size
    || Number(deletedOperations.rowCount ?? -1) !== targetOperations.length) {
    fail("Repair deletion counts did not match its captured target rows");
  }
  const repaired = targetOperations.length > 0 || targetMutableSequences.size > 0 || targetFactSequences.size > 0 || sessionRows.length > 0;
  const replicas = repaired ? await client.query(`
    UPDATE sensa.sync_replica_states
       SET bootstrap_required = TRUE
     WHERE workspace_id = $1 AND learner_user_id = $2 AND NOT bootstrap_required
  `, [scope.workspaceId, scope.learnerUserId]) : { rowCount: 0 };
  await verifyNoOrphanFeedRows(client, scope);
  await verifySyncOperationBounds(client, scope);
  if (repaired) {
    const pending = await queryOne<JsonObject>(client, `
      SELECT COUNT(*)::INTEGER AS count
        FROM sensa.sync_replica_states
       WHERE workspace_id = $1 AND learner_user_id = $2 AND NOT bootstrap_required
    `, [scope.workspaceId, scope.learnerUserId]);
    if (Number(pending?.count ?? -1) !== 0) fail("Some affected Sensa Sync replicas were not marked bootstrap-required");
  }
  const after = await loadScopeSnapshot(client, scope);
  assertScopeSnapshotUnchanged(before, after);
  return {
    workspaceId: scope.workspaceId,
    learnerUserId: scope.learnerUserId,
    archivedPlanId: scope.planId,
    activePlanId: after.activePlanId,
    deletedSessions: Number(deletedSessions.rowCount ?? 0),
    deletedMutableFeedRows: Number(deletedMutable.rowCount ?? 0),
    deletedFactFeedRows: Number(deletedFacts.rowCount ?? 0),
    deletedOperations: Number(deletedOperations.rowCount ?? 0),
    rebootstrapReplicaCount: Number(replicas.rowCount ?? 0),
    scopeSnapshot: after,
    dryRun: scope.dryRun,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: options.databaseUrl, max: 1 });
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`sensa-first-user-sync-repair:${options.workspaceId}:${options.learnerUserId}`]);
    const result = await repair(client, options);
    if (options.dryRun) {
      await client.query("ROLLBACK");
      transactionStarted = false;
    } else {
      await client.query("COMMIT");
      transactionStarted = false;
    }
    console.log(JSON.stringify({ command: "sensa-first-user-sync-repair", ...result }, null, 2));
  } catch (error) {
    if (transactionStarted) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

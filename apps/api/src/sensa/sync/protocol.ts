import { z } from "zod";

import {
  sensaLearningResponseSchemaVersion,
  sensaExecutableLearningCapabilityResolverVersion,
  sensaEvidenceRuleVersion,
  sensaMemoryOutcomeVersion,
  sensaSemanticPolicyVersion,
  sensaStateUpdaterVersion,
  sensaStopPolicyVersion,
} from "@sensa/learning-kernel";
import {
  createSensaSyncPullLimit,
  sensaSyncAppendFactTypes,
  sensaSyncCanonicalizerVersion,
  sensaSyncChangeActions,
  sensaSyncMaximumPullLimit,
  sensaSyncMutableEntityTypes,
  sensaSyncOperationKinds,
  sensaSyncOutcomeMappingVersion,
  sensaSyncV2CanonicalizerVersion,
  sensaSyncV2MutableEntityTypes,
  sensaSyncV2OperationSchema,
  sensaSyncV2WireVersion,
  sensaSyncWireVersion,
} from "@sensa/contracts/sensa";
import type {
  SensaSyncBootstrapInput,
  SensaSyncCursor,
  SensaSyncCursorPair,
  SensaSyncKernelVersionTuple,
  SensaSyncOperation,
  SensaSyncOperationKind,
  SensaSyncPullInput,
  SensaSyncPushInput,
  SensaSyncScope,
  SensaSyncStudyPlanSnapshot,
  SensaSyncTimestamp,
  SensaSyncV2BootstrapInput,
  SensaSyncV2Operation,
  SensaSyncV2PullInput,
  SensaSyncV2PushInput,
} from "@sensa/contracts/sensa";
import { validateIanaTimeZone } from "../../progress/timeZone.js";
import {
  fail,
  parseCanonicalObjectPayload,
  requireExactKeys,
  requireInteger,
  requireObject,
  requireSha256,
  requireString,
  requireTimestamp,
  requireUuid,
  stableJson,
  digest,
} from "./support.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const supportedKernelVersions: SensaSyncKernelVersionTuple = Object.freeze({
  capabilityResolverVersion: sensaExecutableLearningCapabilityResolverVersion,
  semanticPolicyVersion: sensaSemanticPolicyVersion,
  stopPolicyVersion: sensaStopPolicyVersion,
  evidenceRuleVersion: sensaEvidenceRuleVersion,
  stateUpdaterVersion: sensaStateUpdaterVersion,
  outcomeMappingVersion: sensaMemoryOutcomeVersion,
});

export type CursorKind = "mutable" | "fact";
const cursorScopeSchema = z.object({
  workspaceId: z.string().regex(uuidPattern),
  learnerUserId: z.string().trim().min(1),
  replicaId: z.string().regex(uuidPattern),
}).strict();
const cursorPairSchema = z.object({
  bootstrapEpoch: z.number().int().positive(),
  mutableCursor: z.string().min(1),
  factCursor: z.string().min(1),
}).strict();
const cursorDataSchema = z.object({
  scope: cursorScopeSchema,
  wireVersion: z.literal(sensaSyncWireVersion),
  bootstrapEpoch: z.number().int().positive(),
  kind: z.enum(["mutable", "fact"]),
  sequence: z.number().int().nonnegative(),
}).strict();
type CursorData = Readonly<{
  scope: SensaSyncScope;
  wireVersion: typeof sensaSyncWireVersion;
  bootstrapEpoch: number;
  kind: CursorKind;
  sequence: number;
}>;

export function makeCursor(scope: SensaSyncScope, epoch: number, kind: CursorKind, sequence: number): SensaSyncCursor {
  const data: CursorData = {
    scope,
    wireVersion: sensaSyncWireVersion,
    bootstrapEpoch: epoch,
    kind,
    sequence,
  };
  return Buffer.from(stableJson(data), "utf8").toString("base64url") as SensaSyncCursor;
}

export function parseCursor(value: unknown, kind: CursorKind): CursorData {
  const cursorError = (message = `${kind} cursor is invalid.`): never => fail("invalid_cursor", message, 409);
  const encoded = typeof value === "string" && value.length >= 8 && value.length <= 1024
    ? value
    : cursorError();
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) cursorError();
  let parsed: unknown;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) cursorError();
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    cursorError();
  }
  const result = cursorDataSchema.safeParse(parsed);
  const data = result.success ? result.data : cursorError(`${kind} cursor shape is invalid.`);
  if (data.kind !== kind) cursorError(`${kind} cursor belongs to another wire version or feed.`);
  return {
    scope: data.scope,
    wireVersion: data.wireVersion,
    bootstrapEpoch: data.bootstrapEpoch,
    kind: data.kind,
    sequence: data.sequence,
  };
}

function parseCursorPair(value: unknown, scope: SensaSyncScope): SensaSyncCursorPair {
  const result = cursorPairSchema.safeParse(value);
  if (!result.success) fail("invalid_cursor", "cursors shape is invalid.", 409);
  const mutable = parseCursor(result.data.mutableCursor, "mutable");
  const fact = parseCursor(result.data.factCursor, "fact");
  if (mutable.bootstrapEpoch !== fact.bootstrapEpoch
    || mutable.bootstrapEpoch !== result.data.bootstrapEpoch
    || stableJson(mutable.scope) !== stableJson(scope)
    || stableJson(fact.scope) !== stableJson(scope)) {
    fail("invalid_cursor", "Cursors are not bound to this learner, Workspace, replica, and epoch.", 409);
  }
  return {
    bootstrapEpoch: mutable.bootstrapEpoch,
    mutableCursor: result.data.mutableCursor,
    factCursor: result.data.factCursor,
  };
}

export function cursorPair(scope: SensaSyncScope, epoch: number, mutable: number, fact: number): SensaSyncCursorPair {
  return {
    bootstrapEpoch: epoch,
    mutableCursor: makeCursor(scope, epoch, "mutable", mutable),
    factCursor: makeCursor(scope, epoch, "fact", fact),
  };
}

type V2CursorData = Readonly<{
  scope: SensaSyncScope;
  wireVersion: typeof sensaSyncV2WireVersion;
  bootstrapEpoch: number;
  kind: CursorKind;
  sequence: number;
}>;
const v2CursorDataSchema = z.object({
  scope: cursorScopeSchema,
  wireVersion: z.literal(sensaSyncV2WireVersion),
  bootstrapEpoch: z.number().int().positive(),
  kind: z.enum(["mutable", "fact"]),
  sequence: z.number().int().nonnegative(),
}).strict();

export function makeV2Cursor(scope: SensaSyncScope, epoch: number, kind: CursorKind, sequence: number): SensaSyncCursor {
  const data: V2CursorData = {
    scope,
    wireVersion: sensaSyncV2WireVersion,
    bootstrapEpoch: epoch,
    kind,
    sequence,
  };
  return Buffer.from(stableJson(data), "utf8").toString("base64url") as SensaSyncCursor;
}

export function parseV2Cursor(value: unknown, kind: CursorKind): V2CursorData {
  const cursorError = (message = `${kind} cursor is invalid.`): never => fail("invalid_cursor", message, 409);
  const encoded = typeof value === "string" && value.length >= 8 && value.length <= 1024
    ? value
    : cursorError();
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) cursorError();
  let parsed: unknown;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) cursorError();
    parsed = JSON.parse(decoded.toString("utf8"));
  } catch {
    cursorError();
  }
  const result = v2CursorDataSchema.safeParse(parsed);
  const data = result.success ? result.data : cursorError(`${kind} cursor shape is invalid.`);
  if (data.kind !== kind) cursorError(`${kind} cursor belongs to another wire version or feed.`);
  return {
    scope: data.scope,
    wireVersion: data.wireVersion,
    bootstrapEpoch: data.bootstrapEpoch,
    kind: data.kind,
    sequence: data.sequence,
  };
}

function parseV2CursorPair(value: unknown, scope: SensaSyncScope): SensaSyncCursorPair {
  const result = cursorPairSchema.safeParse(value);
  if (!result.success) fail("invalid_cursor", "cursors shape is invalid.", 409);
  const mutable = parseV2Cursor(result.data.mutableCursor, "mutable");
  const fact = parseV2Cursor(result.data.factCursor, "fact");
  if (mutable.bootstrapEpoch !== fact.bootstrapEpoch
    || mutable.bootstrapEpoch !== result.data.bootstrapEpoch
    || stableJson(mutable.scope) !== stableJson(scope)
    || stableJson(fact.scope) !== stableJson(scope)) {
    fail("invalid_cursor", "Cursors are not bound to this learner, Workspace, replica, and epoch.", 409);
  }
  return {
    bootstrapEpoch: mutable.bootstrapEpoch,
    mutableCursor: result.data.mutableCursor,
    factCursor: result.data.factCursor,
  };
}

export function v2CursorPair(scope: SensaSyncScope, epoch: number, mutable: number, fact: number): SensaSyncCursorPair {
  return {
    bootstrapEpoch: epoch,
    mutableCursor: makeV2Cursor(scope, epoch, "mutable", mutable),
    factCursor: makeV2Cursor(scope, epoch, "fact", fact),
  };
}

function requireWireVersion(value: unknown): typeof sensaSyncWireVersion {
  if (value !== sensaSyncWireVersion) fail("upgrade_required", "wireVersion must be sensa-sync-v1.", 409);
  return sensaSyncWireVersion;
}

function requireV2WireVersion(value: unknown): typeof sensaSyncV2WireVersion {
  if (value !== sensaSyncV2WireVersion) fail("upgrade_required", "wireVersion must be sensa-sync-v2.", 409);
  return sensaSyncV2WireVersion;
}

function parseKernelVersions(value: unknown): SensaSyncKernelVersionTuple {
  const object = requireObject(value, "kernelVersions");
  requireExactKeys(object, ["capabilityResolverVersion", "semanticPolicyVersion", "stopPolicyVersion", "evidenceRuleVersion", "stateUpdaterVersion", "outcomeMappingVersion"], "kernelVersions");
  const result = {
    capabilityResolverVersion: requireString(object.capabilityResolverVersion, "capabilityResolverVersion"),
    semanticPolicyVersion: requireString(object.semanticPolicyVersion, "semanticPolicyVersion"),
    stopPolicyVersion: requireString(object.stopPolicyVersion, "stopPolicyVersion"),
    evidenceRuleVersion: requireString(object.evidenceRuleVersion, "evidenceRuleVersion"),
    stateUpdaterVersion: requireString(object.stateUpdaterVersion, "stateUpdaterVersion"),
    outcomeMappingVersion: requireString(object.outcomeMappingVersion, "outcomeMappingVersion") as typeof sensaSyncOutcomeMappingVersion,
  };
  if (stableJson(result) !== stableJson(supportedKernelVersions)) fail("upgrade_required", "The requested Kernel tuple is not supported by this server.", 409);
  return result;
}

function parseOperation(value: unknown): SensaSyncOperation {
  const object = requireObject(value, "operation");
  const kind = requireString(object.kind, "operation.kind", 128) as SensaSyncOperationKind;
  if (!sensaSyncOperationKinds.includes(kind)) fail("invalid_operation", `Unsupported Sensa Sync operation kind ${kind}.`, 400);
  const operationId = requireString(object.operationId, "operation.operationId", 256);
  const occurredAt = requireTimestamp(object.occurredAt, "operation.occurredAt");
  const base = { operationId, occurredAt };
  switch (kind) {
    case "study_plan.create":
      requireExactKeys(object, ["kind", "operationId", "occurredAt", "studyPlanId", "bookVersionId", "dailyNewSenseTarget"], "study_plan.create");
      return { ...base, kind, studyPlanId: requireUuid(object.studyPlanId, "studyPlanId"), bookVersionId: requireUuid(object.bookVersionId, "bookVersionId"), dailyNewSenseTarget: requireInteger(object.dailyNewSenseTarget, "dailyNewSenseTarget", 1, 100) };
    case "study_plan.update": {
      const mutation = requireString(object.mutation, "mutation", 64);
      const common = { ...base, kind, studyPlanId: requireUuid(object.studyPlanId, "studyPlanId"), expectedRevision: requireInteger(object.expectedRevision, "expectedRevision", 1) };
      if (mutation === "pacing") {
        requireExactKeys(object, ["kind", "operationId", "occurredAt", "studyPlanId", "expectedRevision", "mutation", "dailyNewSenseTarget"], "study_plan.update");
        return { ...common, mutation, dailyNewSenseTarget: requireInteger(object.dailyNewSenseTarget, "dailyNewSenseTarget", 1, 100) };
      }
      if (mutation === "status") {
        requireExactKeys(object, ["kind", "operationId", "occurredAt", "studyPlanId", "expectedRevision", "mutation", "status"], "study_plan.update");
        const status = requireString(object.status, "status", 32) as SensaSyncStudyPlanSnapshot["status"];
        if (!["active", "paused", "completed", "archived"].includes(status)) fail("invalid_operation", "status is not a supported Study Plan status.", 400);
        return { ...common, mutation, status };
      }
      if (mutation === "pacing_and_status") {
        requireExactKeys(object, ["kind", "operationId", "occurredAt", "studyPlanId", "expectedRevision", "mutation", "status", "dailyNewSenseTarget"], "study_plan.update");
        const status = requireString(object.status, "status", 32) as SensaSyncStudyPlanSnapshot["status"];
        if (!["active", "paused", "completed", "archived"].includes(status)) fail("invalid_operation", "status is not a supported Study Plan status.", 400);
        return { ...common, mutation, status, dailyNewSenseTarget: requireInteger(object.dailyNewSenseTarget, "dailyNewSenseTarget", 1, 100) };
      }
      fail("invalid_operation", "mutation must be pacing, status, or pacing_and_status.", 400);
    }
    case "learning_session.start":
      requireExactKeys(object, ["kind", "operationId", "occurredAt", "learningSessionId", "studyPlanId"], "learning_session.start");
      return { ...base, kind, learningSessionId: requireUuid(object.learningSessionId, "learningSessionId"), studyPlanId: requireUuid(object.studyPlanId, "studyPlanId") };
    case "learning_session.complete":
      requireExactKeys(object, ["kind", "operationId", "occurredAt", "learningSessionId", "expectedRevision", "status"], "learning_session.complete");
      if (object.status !== "completed" && object.status !== "abandoned") fail("invalid_operation", "Session status must be completed or abandoned.", 400);
      return { ...base, kind, learningSessionId: requireUuid(object.learningSessionId, "learningSessionId"), expectedRevision: requireInteger(object.expectedRevision, "expectedRevision", 1), status: object.status };
    case "sense_encounter.open":
      requireExactKeys(object, ["kind", "operationId", "occurredAt", "senseEncounterId", "learningSessionId", "studyPlanId", "senseId", "senseVersionId", "contentReleaseId", "bookVersionId", "sessionOrdinal", "encounterKind", "selectionMode", "timeZone", "kernelVersions"].filter((key) => object[key] !== undefined), "sense_encounter.open");
      if (object.encounterKind !== "introduction" && object.encounterKind !== "review") fail("invalid_operation", "encounterKind must be introduction or review.", 400);
      if (object.selectionMode !== undefined
        && object.selectionMode !== "mixed"
        && object.selectionMode !== "due_only") {
        fail("invalid_operation", "selectionMode must be mixed or due_only.", 400);
      }
      {
        const timeZone = requireString(object.timeZone, "timeZone", 128);
        const validation = validateIanaTimeZone(timeZone);
        if (!validation.ok) fail("invalid_operation", "timeZone must be a valid IANA timezone.", 400);
        return { ...base, kind, senseEncounterId: requireUuid(object.senseEncounterId, "senseEncounterId"), learningSessionId: requireUuid(object.learningSessionId, "learningSessionId"), studyPlanId: requireUuid(object.studyPlanId, "studyPlanId"), senseId: requireUuid(object.senseId, "senseId"), senseVersionId: requireUuid(object.senseVersionId, "senseVersionId"), contentReleaseId: requireUuid(object.contentReleaseId, "contentReleaseId"), bookVersionId: requireUuid(object.bookVersionId, "bookVersionId"), sessionOrdinal: requireInteger(object.sessionOrdinal, "sessionOrdinal", 1), encounterKind: object.encounterKind, ...(object.selectionMode === undefined ? {} : { selectionMode: object.selectionMode }), timeZone: validation.timeZone, kernelVersions: parseKernelVersions(object.kernelVersions) };
      }
    case "learning_attempt.record":
      requireExactKeys(object, ["kind", "operationId", "occurredAt", "learningAttemptId", "senseEncounterId", "learningActionId", "ordinal", "responseSchemaVersion", "responsePayload", "durationMs"], "learning_attempt.record");
      if (object.durationMs !== null && object.durationMs !== undefined) requireInteger(object.durationMs, "durationMs", 0, 86_400_000);
      if (object.responseSchemaVersion !== sensaLearningResponseSchemaVersion) fail("upgrade_required", "responseSchemaVersion must be sensa-learning-response-v1.", 409);
      return { ...base, kind, learningAttemptId: requireUuid(object.learningAttemptId, "learningAttemptId"), senseEncounterId: requireUuid(object.senseEncounterId, "senseEncounterId"), learningActionId: requireUuid(object.learningActionId, "learningActionId"), ordinal: requireInteger(object.ordinal, "ordinal", 1), responseSchemaVersion: requireString(object.responseSchemaVersion, "responseSchemaVersion", 128), responsePayload: parseCanonicalObjectPayload(object.responsePayload, "responsePayload"), durationMs: object.durationMs === undefined || object.durationMs === null ? null : object.durationMs as number };
    case "sense_encounter.complete":
      requireExactKeys(object, ["kind", "operationId", "occurredAt", "senseEncounterId", "expectedRevision", "clientEvidenceDigest", "clientSemanticStateDigest", "clientMemoryStateDigest", "predictedOutcomeKind"].filter((key) => object[key] !== undefined), "sense_encounter.complete");
      if (object.predictedOutcomeKind !== undefined && !["introduced", "retrieval_failed", "supported_retrieval", "independent_retrieval", "transfer_confirmed"].includes(object.predictedOutcomeKind as string)) fail("invalid_operation", "predictedOutcomeKind is not a supported Memory Outcome kind.", 400);
      return { ...base, kind, senseEncounterId: requireUuid(object.senseEncounterId, "senseEncounterId"), expectedRevision: requireInteger(object.expectedRevision, "expectedRevision", 1), ...(object.clientEvidenceDigest === undefined ? {} : { clientEvidenceDigest: requireSha256(object.clientEvidenceDigest, "clientEvidenceDigest") }), ...(object.clientSemanticStateDigest === undefined ? {} : { clientSemanticStateDigest: requireSha256(object.clientSemanticStateDigest, "clientSemanticStateDigest") }), ...(object.clientMemoryStateDigest === undefined ? {} : { clientMemoryStateDigest: requireSha256(object.clientMemoryStateDigest, "clientMemoryStateDigest") }), ...(object.predictedOutcomeKind === undefined ? {} : { predictedOutcomeKind: requireString(object.predictedOutcomeKind, "predictedOutcomeKind", 64) as never }) };
    case "sense_encounter.interrupt":
      requireExactKeys(object, ["kind", "operationId", "occurredAt", "senseEncounterId", "expectedRevision", "status"], "sense_encounter.interrupt");
      if (object.status !== "interrupted" && object.status !== "cancelled") fail("invalid_operation", "Encounter status must be interrupted or cancelled.", 400);
      return { ...base, kind, senseEncounterId: requireUuid(object.senseEncounterId, "senseEncounterId"), expectedRevision: requireInteger(object.expectedRevision, "expectedRevision", 1), status: object.status };
  }
}

function parseV2Operation(value: unknown): SensaSyncV2Operation {
  const parsed = parseV2OperationUnchecked(value);
  const schemaResult = sensaSyncV2OperationSchema.safeParse(parsed);
  if (!schemaResult.success) {
    fail("invalid_operation", `Operation does not match the Sensa Sync v2 contract: ${schemaResult.error.issues[0]?.message ?? "invalid shape"}.`, 400);
  }
  return schemaResult.data;
}

function parseV2OperationUnchecked(value: unknown): SensaSyncV2Operation {
  const object = requireObject(value, "operation");
  const kind = requireString(object.kind, "operation.kind", 128);
  if (kind !== "learner_declared_mastery.set") return parseOperation(value);
  requireExactKeys(object, ["kind", "operationId", "occurredAt", "entityId", "senseId", "isMastered", "expectedRevision", "encounter"].filter((key) => object[key] !== undefined), "learner_declared_mastery.set");
  if (typeof object.isMastered !== "boolean") fail("invalid_operation", "isMastered must be a boolean.", 400);
  const encounter = object.encounter === undefined
    ? undefined
    : (() => {
      const value = requireObject(object.encounter, "encounter");
      requireExactKeys(value, ["senseEncounterId", "expectedRevision"], "encounter");
      return {
        senseEncounterId: requireUuid(value.senseEncounterId, "encounter.senseEncounterId"),
        expectedRevision: requireInteger(value.expectedRevision, "encounter.expectedRevision", 1),
      };
    })();
  return {
    kind,
    operationId: requireString(object.operationId, "operation.operationId", 256),
    occurredAt: requireTimestamp(object.occurredAt, "operation.occurredAt"),
    entityId: requireUuid(object.entityId, "entityId"),
    senseId: requireUuid(object.senseId, "senseId"),
    isMastered: object.isMastered,
    expectedRevision: requireInteger(object.expectedRevision, "expectedRevision", 0),
    ...(encounter === undefined ? {} : { encounter }),
  };
}

export function parseSensaSyncBootstrapInput(scope: SensaSyncScope, value: unknown): SensaSyncBootstrapInput {
  const object = requireObject(value, "request body");
  requireExactKeys(object, ["wireVersion", "replicaId"], "bootstrap request");
  requireWireVersion(object.wireVersion);
  if (requireUuid(object.replicaId, "replicaId") !== scope.replicaId) fail("replica_scope_mismatch", "replicaId must match the authenticated sync scope.", 409);
  return { scope, wireVersion: sensaSyncWireVersion };
}

export function parseSensaSyncPushInput(scope: SensaSyncScope, value: unknown): SensaSyncPushInput {
  const object = requireObject(value, "request body");
  requireExactKeys(object, ["wireVersion", "replicaId", "cursors", "operations"], "push request");
  requireWireVersion(object.wireVersion);
  if (requireUuid(object.replicaId, "replicaId") !== scope.replicaId) fail("replica_scope_mismatch", "replicaId must match the authenticated sync scope.", 409);
  const cursors = parseCursorPair(object.cursors, scope);
  if (!Array.isArray(object.operations) || object.operations.length > 100) fail("invalid_operation", "operations must contain between 0 and 100 entries.", 400);
  return { scope, wireVersion: sensaSyncWireVersion, cursors, operations: object.operations.map(parseOperation) };
}

export function parseSensaSyncPullInput(scope: SensaSyncScope, value: unknown): SensaSyncPullInput {
  const object = requireObject(value, "request body");
  requireExactKeys(object, ["wireVersion", "replicaId", "cursors", "limit"], "pull request");
  requireWireVersion(object.wireVersion);
  if (requireUuid(object.replicaId, "replicaId") !== scope.replicaId) fail("replica_scope_mismatch", "replicaId must match the authenticated sync scope.", 409);
  const cursors = parseCursorPair(object.cursors, scope);
  return { scope, wireVersion: sensaSyncWireVersion, cursors, limit: createSensaSyncPullLimit(requireInteger(object.limit, "limit", 1, sensaSyncMaximumPullLimit)) };
}

export function parseSensaSyncV2BootstrapInput(scope: SensaSyncScope, value: unknown): SensaSyncV2BootstrapInput {
  const object = requireObject(value, "request body");
  requireExactKeys(object, ["wireVersion", "replicaId"], "bootstrap request");
  requireV2WireVersion(object.wireVersion);
  if (requireUuid(object.replicaId, "replicaId") !== scope.replicaId) fail("replica_scope_mismatch", "replicaId must match the authenticated sync scope.", 409);
  return { scope, wireVersion: sensaSyncV2WireVersion };
}

export function parseSensaSyncV2PushInput(scope: SensaSyncScope, value: unknown): SensaSyncV2PushInput {
  const object = requireObject(value, "request body");
  requireExactKeys(object, ["wireVersion", "replicaId", "cursors", "operations"], "push request");
  requireV2WireVersion(object.wireVersion);
  if (requireUuid(object.replicaId, "replicaId") !== scope.replicaId) fail("replica_scope_mismatch", "replicaId must match the authenticated sync scope.", 409);
  const cursors = parseV2CursorPair(object.cursors, scope);
  if (!Array.isArray(object.operations) || object.operations.length > 100) fail("invalid_operation", "operations must contain between 0 and 100 entries.", 400);
  return { scope, wireVersion: sensaSyncV2WireVersion, cursors, operations: object.operations.map(parseV2Operation) };
}

export function parseSensaSyncV2PullInput(scope: SensaSyncScope, value: unknown): SensaSyncV2PullInput {
  const object = requireObject(value, "request body");
  requireExactKeys(object, ["wireVersion", "replicaId", "cursors", "limit"], "pull request");
  requireV2WireVersion(object.wireVersion);
  if (requireUuid(object.replicaId, "replicaId") !== scope.replicaId) fail("replica_scope_mismatch", "replicaId must match the authenticated sync scope.", 409);
  const cursors = parseV2CursorPair(object.cursors, scope);
  return { scope, wireVersion: sensaSyncV2WireVersion, cursors, limit: createSensaSyncPullLimit(requireInteger(object.limit, "limit", 1, sensaSyncMaximumPullLimit)) };
}


import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../database/index.js";
import { canonicalJsonDigest } from "@sensa/learning-kernel";
import type {
  SensaSyncErrorCode,
  SensaSyncScope,
  SensaSyncTimestamp,
} from "@sensa/contracts/sensa";

export type Row = QueryResultRow & Record<string, unknown>;
type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

export type SensaSyncErrorStatus =
  | SensaSyncErrorCode
  | "invalid_request"
  | "state_corrupt";

export class SensaSyncError extends Error {
  readonly code: SensaSyncErrorStatus;
  readonly statusCode: number;
  readonly operationId: string | null;
  readonly retryable: boolean;

  constructor(
    code: SensaSyncErrorStatus,
    message: string,
    statusCode = 409,
    operationId: string | null = null,
    retryable = false,
  ) {
    super(message);
    this.name = "SensaSyncError";
    this.code = code;
    this.statusCode = statusCode;
    this.operationId = operationId;
    this.retryable = retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const isoMillisecondsPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
export function fail(
  code: SensaSyncErrorStatus,
  message: string,
  statusCode = 409,
  operationId: string | null = null,
  retryable = false,
): never {
  throw new SensaSyncError(code, message, statusCode, operationId, retryable);
}

export function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("invalid_request", `${name} must be a JSON object.`, 400);
  }
  return value as Record<string, unknown>;
}

export function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], name: string): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) fail("invalid_request", `${name} contains unsupported field ${key}.`, 400);
  }
}

export function requireString(value: unknown, name: string, maximum = 512): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail("invalid_request", `${name} must be a non-empty string.`, 400);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) fail("invalid_request", `${name} is too long.`, 400);
  return normalized;
}

export function requireUuid(value: unknown, name: string): string {
  const normalized = requireString(value, name, 128);
  if (!uuidPattern.test(normalized)) fail("invalid_request", `${name} must be a UUID.`, 400);
  return normalized.toLowerCase();
}

export function requireInteger(value: unknown, name: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("invalid_request", `${name} must be an integer from ${minimum} to ${maximum}.`, 400);
  }
  return value;
}

export function requireTimestamp(value: unknown, name: string): SensaSyncTimestamp {
  if (typeof value !== "string") fail("invalid_request", `${name} must be an ISO timestamp.`, 400);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail("invalid_request", `${name} must be an ISO timestamp.`, 400);
  const normalized = parsed.toISOString() as SensaSyncTimestamp;
  if (!isoMillisecondsPattern.test(normalized)) fail("invalid_request", `${name} must have millisecond precision.`, 400);
  return normalized;
}

export function requireSha256(value: unknown, name: string): string {
  const normalized = requireString(value, name, 64);
  if (!/^[0-9a-f]{64}$/u.test(normalized)) fail("invalid_operation", `${name} must be lowercase SHA-256 hex.`, 400);
  return normalized;
}

export function asDate(value: unknown, name: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(date.getTime())) fail("state_corrupt", `${name} is not a valid persisted timestamp.`, 500);
  return date;
}

export function asNullableDate(value: unknown, name: string): Date | null {
  return value === null || value === undefined ? null : asDate(value, name);
}

export function timestamp(value: unknown, name: string): SensaSyncTimestamp {
  return asDate(value, name).toISOString() as SensaSyncTimestamp;
}

export function asSafeInteger(value: unknown, name: string, minimum = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) fail("state_corrupt", `${name} is invalid.`, 500);
  return parsed;
}

export function asEnum<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) fail("state_corrupt", `${name} is invalid.`, 500);
  return value as T;
}

export function stableJson(value: unknown): string {
  const visit = (current: unknown): JsonValue => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) fail("invalid_request", "Payload contains a non-finite number.", 400);
      return current;
    }
    if (Array.isArray(current)) return current.map(visit);
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const result: Record<string, JsonValue> = {};
      for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) fail("invalid_request", "Payload contains undefined values.", 400);
        result[key] = visit(record[key]);
      }
      return result;
    }
    fail("invalid_request", "Payload contains an unsupported JSON value.", 400);
  };
  return JSON.stringify(visit(value));
}

export function digest(value: unknown): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

export function canonicalPayload(value: unknown, name: string): Record<string, unknown> {
  const object = requireObject(value, name);
  stableJson(object);
  return object;
}

export function parseCanonicalObjectPayload(value: unknown, name: string): { object: Record<string, unknown>; digest: string } {
  const wrapper = requireObject(value, name);
  const keys = Object.keys(wrapper);
  if (keys.length !== 2 || !keys.includes("object") || !keys.includes("digest")) {
    fail("invalid_operation", `${name} must contain exactly object and digest fields.`, 400);
  }
  if (typeof wrapper.object !== "object" || wrapper.object === null || Array.isArray(wrapper.object)) {
    fail("invalid_operation", `${name}.object must be a JSON object.`, 400);
  }
  const object = wrapper.object as Record<string, unknown>;
  let expectedDigest: string;
  try {
    expectedDigest = canonicalJsonDigest(object);
  } catch {
    fail("invalid_operation", `${name}.object must contain only canonical JSON values.`, 400);
  }
  if (typeof wrapper.digest !== "string" || !/^[0-9a-f]{64}$/u.test(wrapper.digest)) {
    fail("invalid_operation", `${name}.digest must be lowercase SHA-256 hex.`, 400);
  }
  const actualDigest = wrapper.digest;
  if (actualDigest !== expectedDigest) {
    fail("invalid_operation", `${name}.digest does not match the canonical digest of ${name}.object.`, 400);
  }
  return { object, digest: actualDigest };
}

export async function query<T extends QueryResultRow>(executor: DatabaseExecutor, text: string, params: readonly unknown[] = []): Promise<ReadonlyArray<T & Record<string, unknown>>> {
  return (await executor.query<T>(text, params as never)).rows as ReadonlyArray<T & Record<string, unknown>>;
}

export async function verifyReplicaScope(
  executor: DatabaseExecutor,
  scope: SensaSyncScope,
): Promise<void> {
  const rows = await query<Row>(executor, `
    SELECT workspace_id::TEXT AS workspace_id, user_id AS learner_user_id
      FROM sync.workspace_replicas
     WHERE replica_id = $1
     LIMIT 1
  `, [scope.replicaId]);
  const row = rows[0];
  if (row === undefined) {
    fail("replica_scope_mismatch", "replicaId is not registered for this learner and Workspace.", 409);
  }
  if (row.workspace_id !== scope.workspaceId || row.learner_user_id !== scope.learnerUserId) {
    fail("replica_scope_mismatch", "replicaId must belong to the authenticated learner and Workspace.", 409);
  }
}

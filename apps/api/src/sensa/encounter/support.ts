import type { QueryResultRow } from "pg";

import type { DatabaseExecutor } from "../../database/index.js";
import { getDatabaseErrorFields } from "../../database/transient.js";
import { HttpError } from "../../shared/errors.js";
import { canonicalJsonDigest } from "@sensa/learning-kernel";
import {
  createEncounterError,
  SensaEncounterError,
} from "@sensa/contracts/sensa";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type EncounterQueryRow = QueryResultRow & Record<string, unknown>;

export function encounterError(
  code: ConstructorParameters<typeof SensaEncounterError>[0],
  message: string,
  statusCode = 409,
): SensaEncounterError {
  return createEncounterError(code, message, statusCode);
}

export function requireInputString(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw encounterError("invalid_input", `${name} must be a non-empty string`, 400);
  }
  return value;
}

export function requireUuid(value: string, name: string): string {
  requireInputString(value, name);
  if (!uuidPattern.test(value)) {
    throw encounterError("invalid_input", `${name} must be a UUID`, 400);
  }
  return value.toLowerCase();
}

export function requireDate(value: Date, name: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw encounterError("invalid_input", `${name} must be a valid timestamp`, 400);
  }
  return new Date(value.getTime());
}

export function toDate(
  value: Date | string | null,
  name: string,
): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw encounterError("state_corrupt", `${name} is not a valid timestamp`, 500);
  }
  return date;
}

export function toInteger(
  value: number | string,
  name: string,
  minimum = 0,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw encounterError("state_corrupt", `${name} is not a valid integer`, 500);
  }
  return parsed;
}

export function jsonObject(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw encounterError("state_corrupt", `${name} must be a JSON object`, 500);
  }
  return value as Record<string, unknown>;
}

export function canonicalInputPayload(
  input: Readonly<{ object: unknown; digest: string }>,
  name: string,
): Record<string, unknown> {
  const object = jsonObject(input.object, name);
  let digest: string;
  try {
    digest = canonicalJsonDigest(object);
  } catch {
    throw encounterError("response_invalid", `${name} is not canonical JSON`, 400);
  }
  if (!/^[0-9a-f]{64}$/u.test(input.digest) || input.digest !== digest) {
    throw encounterError(
      "response_invalid",
      `${name} digest does not match its canonical payload`,
      400,
    );
  }
  return object;
}

export async function encounterQuery<RowType extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: readonly unknown[] = [],
): Promise<ReadonlyArray<RowType & Record<string, unknown>>> {
  return (await executor.query<RowType>(text, params as never)).rows as
    ReadonlyArray<RowType & Record<string, unknown>>;
}

export function mapEncounterDatabaseError(caught: unknown): never {
  if (caught instanceof SensaEncounterError) throw caught;
  if (caught instanceof HttpError) throw caught;
  const { sqlState } = getDatabaseErrorFields(caught);
  if (sqlState === "40001" || sqlState === "40P01") {
    throw encounterError(
      "schedule_conflict",
      "The Encounter changed concurrently. Retry the same request.",
      409,
    );
  }
  if (sqlState === "23505") {
    throw encounterError(
      "attempt_identity_conflict",
      "The Encounter fact conflicts with an existing immutable fact.",
      409,
    );
  }
  if (sqlState === "23503") {
    throw encounterError(
      "content_unavailable",
      "A pinned Encounter dependency is unavailable.",
      409,
    );
  }
  if (sqlState === "23514" || sqlState === "22P02") {
    throw encounterError(
      "rule_violation",
      "The Encounter request violates a frozen runtime rule.",
      409,
    );
  }
  throw caught;
}

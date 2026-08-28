import { HttpError } from "../shared/errors.js";
import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());
const nonEmptyStringSchema = z.string().trim().min(1);
const uuidSchema = z.string().uuid();

export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function expectRecord(value: unknown): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return parsed.data;
}

export function expectNonEmptyString(value: unknown, fieldName: string): string {
  const parsed = nonEmptyStringSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, `${fieldName} must be a non-empty string`);
  }
  return parsed.data;
}

export function expectUuidString(value: unknown, fieldName: string): string {
  const normalized = expectNonEmptyString(value, fieldName);
  if (!uuidSchema.safeParse(normalized).success) {
    throw new HttpError(400, `${fieldName} must be a UUID`);
  }
  return normalized.toLowerCase();
}

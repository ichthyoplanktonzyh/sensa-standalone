import { z } from "zod";

const apiEnvironmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  DATABASE_URL: z.string().trim().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_POOL_ACQUIRE_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
  DATABASE_POOL_MAX_LIFETIME_SECONDS: z.coerce.number().int().min(30).max(3_600).default(300),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(15_000),
  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().min(50).max(30_000).default(3_000),
  DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(10_000),
  AUTH_MODE: z.enum(["none", "cognito"]).default("cognito"),
  ALLOW_INSECURE_LOCAL_AUTH: z.enum(["true", "false"]).default("false"),
  ALLOWED_ORIGINS: z.string().default(""),
  SENSA_LOCAL_WORKSPACE_ID: z.string().trim().min(1).optional(),
  SENSA_LOCAL_LEARNER_ID: z.string().trim().min(1).optional(),
  SENSA_LOCAL_EMAIL: z.string().trim().email().optional(),
  SENSA_LOCAL_LOCALE: z.string().trim().min(1).default("zh-Hans"),
  SENSA_MEDIA_ROOT: z.string().trim().min(1).optional(),
  SENSA_LOCAL_CONTENT_MEDIA_ROOT: z.string().trim().min(1).optional(),
}).strip();

export type SensaApiEnvironment = z.infer<typeof apiEnvironmentSchema>;

export function readSensaApiEnvironment(source: NodeJS.ProcessEnv = process.env): SensaApiEnvironment {
  const parsed = apiEnvironmentSchema.safeParse(source);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Sensa API environment is invalid: ${issue?.path.join(".") ?? "unknown"}`);
  }
  return parsed.data;
}

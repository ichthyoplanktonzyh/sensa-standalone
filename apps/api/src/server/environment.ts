import { z } from "zod";

const apiEnvironmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  DATABASE_URL: z.string().trim().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
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

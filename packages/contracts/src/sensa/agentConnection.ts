import { z } from "zod";

export const sensaAgentConnectionContractVersion = "sensa-agent-connection-v1" as const;

const uuid = z.string().uuid();
const label = z.string().trim().min(1).max(100);
const timestamp = z.string().datetime({ offset: true });

export const sensaAgentClientKindSchema = z.enum([
  "codex",
  "cursor",
  "claude_desktop",
  "windsurf",
  "cli",
]);

/** A Web-authenticated request for a short-lived, one-time installer code. */
export const sensaAgentConnectionSetupCreateSchema = z
  .object({
    contractVersion: z.literal(sensaAgentConnectionContractVersion),
    setupId: uuid,
    connectionId: uuid,
    clientKind: sensaAgentClientKindSchema,
    label,
    replacesConnectionId: uuid.nullable(),
  })
  .strict();

export const sensaAgentConnectionSetupSchema = z
  .object({
    contractVersion: z.literal(sensaAgentConnectionContractVersion),
    setupId: uuid,
    connectionId: uuid,
    clientKind: sensaAgentClientKindSchema,
    label,
    setupCode: z.string().startsWith("sensa_setup_").min(32),
    replacesConnectionId: uuid.nullable(),
    createdAt: timestamp,
    expiresAt: timestamp,
  })
  .strict();

/** The installer exchanges the one-time code directly; Web never receives this token. */
export const sensaAgentConnectionExchangeSchema = z
  .object({
    contractVersion: z.literal(sensaAgentConnectionContractVersion),
    setupId: uuid,
    setupCode: z.string().startsWith("sensa_setup_").min(32),
  })
  .strict();

export const sensaAgentConnectionCredentialSchema = z
  .object({
    contractVersion: z.literal(sensaAgentConnectionContractVersion),
    connectionId: uuid,
    clientKind: sensaAgentClientKindSchema,
    label,
    token: z.string().startsWith("sensa_agent_").min(32),
    createdAt: timestamp,
    expiresAt: timestamp,
  })
  .strict();

export const sensaAgentConnectionStateSchema = z.enum(["active", "expired", "revoked"]);

export const sensaAgentConnectionViewSchema = z
  .object({
    contractVersion: z.literal(sensaAgentConnectionContractVersion),
    connectionId: uuid,
    clientKind: sensaAgentClientKindSchema,
    label,
    state: sensaAgentConnectionStateSchema,
    createdAt: timestamp,
    expiresAt: timestamp,
    lastUsedAt: timestamp.nullable(),
    revokedAt: timestamp.nullable(),
  })
  .strict();

export const sensaAgentConnectionListSchema = z
  .object({ connections: z.array(sensaAgentConnectionViewSchema).max(100) })
  .strict();

export const sensaAgentConnectionRevokeSchema = z
  .object({
    contractVersion: z.literal(sensaAgentConnectionContractVersion),
    connectionId: uuid,
  })
  .strict();

export const sensaAgentConnectionEventTypeSchema = z.enum([
  "setup_created",
  "activated",
  "replaced",
  "revoked",
]);

export const sensaAgentConnectionEventSchema = z
  .object({
    contractVersion: z.literal(sensaAgentConnectionContractVersion),
    eventId: uuid,
    connectionId: uuid,
    clientKind: sensaAgentClientKindSchema,
    label,
    eventType: sensaAgentConnectionEventTypeSchema,
    createdAt: timestamp,
  })
  .strict();

export const sensaAgentConnectionEventListSchema = z
  .object({ events: z.array(sensaAgentConnectionEventSchema).max(100) })
  .strict();

export type SensaAgentClientKind = z.infer<typeof sensaAgentClientKindSchema>;
export type SensaAgentConnectionSetupCreate = z.infer<typeof sensaAgentConnectionSetupCreateSchema>;
export type SensaAgentConnectionSetup = z.infer<typeof sensaAgentConnectionSetupSchema>;
export type SensaAgentConnectionExchange = z.infer<typeof sensaAgentConnectionExchangeSchema>;
export type SensaAgentConnectionCredential = z.infer<typeof sensaAgentConnectionCredentialSchema>;
export type SensaAgentConnectionView = z.infer<typeof sensaAgentConnectionViewSchema>;
export type SensaAgentConnectionRevoke = z.infer<typeof sensaAgentConnectionRevokeSchema>;
export type SensaAgentConnectionEvent = z.infer<typeof sensaAgentConnectionEventSchema>;

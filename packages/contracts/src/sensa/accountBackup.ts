import { z } from "zod";

/**
 * Architecture seam only. No route currently publishes or restores these
 * objects; the contract prevents a future cloud backup adapter from silently
 * turning account sync into a second writable semantic database.
 */
export const sensaAccountBackupContractVersion = "sensa-account-backup-v1" as const;

const uuid = z.string().uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const timestamp = z.string().datetime({ offset: true });

export const sensaAccountBackupRecoveryModeSchema = z.enum([
  "account_assisted",
  "zero_knowledge",
]);

/** One immutable, complete and independently verifiable recovery generation. */
export const sensaAccountBackupManifestSchema = z
  .object({
    contractVersion: z.literal(sensaAccountBackupContractVersion),
    backupId: uuid,
    previousBackupId: uuid.nullable(),
    libraryId: uuid,
    learnerId: uuid,
    librarySchemaVersion: z.number().int().positive(),
    checkpoint: z.string().trim().min(1).max(500),
    createdAt: timestamp,
    recoveryMode: sensaAccountBackupRecoveryModeSchema,
    payloadDigest: digest,
    payloadBytes: z.number().int().positive(),
  })
  .strict();

export const sensaAccountBackupRecoveryPointSchema = z
  .object({
    manifest: sensaAccountBackupManifestSchema,
    storedAt: timestamp,
    verifiedAt: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.storedAt) < Date.parse(value.manifest.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "backup storage cannot precede snapshot creation",
        path: ["storedAt"],
      });
    }
    if (Date.parse(value.verifiedAt) < Date.parse(value.storedAt)) {
      context.addIssue({
        code: "custom",
        message: "backup verification cannot precede storage",
        path: ["verifiedAt"],
      });
    }
  });

export type SensaAccountBackupRecoveryMode = z.infer<typeof sensaAccountBackupRecoveryModeSchema>;
export type SensaAccountBackupManifest = z.infer<typeof sensaAccountBackupManifestSchema>;
export type SensaAccountBackupRecoveryPoint = z.infer<typeof sensaAccountBackupRecoveryPointSchema>;

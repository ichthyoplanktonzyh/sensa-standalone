import { createHash } from "node:crypto";

import type { Hono } from "hono";
import {
  canonicalConsumerJson,
  sensaIntakeDeliveryAcknowledgementSchema,
  sensaIntakeDeliveryChannelRequestSchema,
  sensaIntakeDeliveryContractVersion,
  sensaIntakeDeliveryPullRequestSchema,
  sensaIntakeDeliverySubmissionSchema,
  type SensaIntakeDeliveryReceipt,
} from "@sensa/contracts/sensa";

import type { DatabaseExecutor } from "../../database/core.js";
import { ConsumerError } from "../access/auth.js";

type Access = <T>(
  request: Request,
  work: (
    db: DatabaseExecutor,
    account: { accountId: string; installationId?: string; now?: Date },
  ) => Promise<T>,
) => Promise<T>;

const digest = (value: unknown): string => createHash("sha256")
  .update(canonicalConsumerJson(value))
  .digest("hex");

const instant = (value: unknown): string => {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new ConsumerError(503, "intake_delivery_corrupt");
  return parsed.toISOString();
};

type DeliveryRow = {
  library_id: string;
  operation_id: string;
  envelope: unknown;
  envelope_digest: string;
  receipt: unknown | null;
  created_at: Date | string;
};

function deliveryReceipt(row: DeliveryRow): SensaIntakeDeliveryReceipt {
  const submission = sensaIntakeDeliverySubmissionSchema.parse(row.envelope);
  const queuedAt = instant(row.created_at);
  if (row.receipt === null) {
    return {
      contractVersion: sensaIntakeDeliveryContractVersion,
      deliveryId: row.operation_id,
      operationId: submission.intake.operationId,
      deliveryState: "queued",
      queuedAt,
    };
  }
  const acknowledgement = sensaIntakeDeliveryAcknowledgementSchema.parse(row.receipt);
  return {
    contractVersion: sensaIntakeDeliveryContractVersion,
    deliveryId: row.operation_id,
    operationId: submission.intake.operationId,
    deliveryState: "applied",
    queuedAt,
    appliedAt: acknowledgement.appliedAt,
    result: acknowledgement.result,
  };
}

async function enabledChannel(db: DatabaseExecutor, accountId: string): Promise<string> {
  const rows = (await db.query(
    "SELECT library_id FROM sensa_consumer.intake_channels WHERE account_id=$1 AND enabled=true FOR UPDATE",
    [accountId],
  )).rows;
  if (rows.length === 0) throw new ConsumerError(409, "intake_destination_unavailable");
  if (rows.length !== 1) throw new ConsumerError(409, "intake_destination_conflict");
  return String(rows[0]!.library_id);
}

/**
 * Remote delivery is a durable mailbox, not a cloud semantic writer. It never
 * evaluates Context adequacy or materializes a Personal Meaning; a trusted
 * local library does that and acknowledges the resulting fast/inbox route.
 */
export function registerIntakeDelivery(app: Hono, access: Access): void {
  app.use("/sensa/intake/*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });

  app.post("/sensa/intake/channel", async (context) => {
    const input = sensaIntakeDeliveryChannelRequestSchema.parse(await context.req.json());
    return context.json(await access(context.req.raw, async (db, account) => {
      if (account.installationId) throw new ConsumerError(403, "web_authorization_required");
      const other = (await db.query(
        "SELECT library_id FROM sensa_consumer.intake_channels WHERE account_id=$1 AND enabled=true AND library_id<>$2 FOR UPDATE",
        [account.accountId, input.libraryId],
      )).rows[0];
      if (other) throw new ConsumerError(409, "intake_destination_conflict");
      await db.query(
        `INSERT INTO sensa_consumer.intake_channels(account_id,library_id,config,enabled)
         VALUES($1,$2,$3::jsonb,true)
         ON CONFLICT(account_id,library_id) DO UPDATE SET enabled=true,config=excluded.config`,
        [account.accountId, input.libraryId, JSON.stringify({ contractVersion: input.contractVersion })],
      );
      return { registered: true as const, libraryId: input.libraryId };
    }));
  });

  app.post("/sensa/intake/deliveries", async (context) => {
    const submission = sensaIntakeDeliverySubmissionSchema.parse(await context.req.json());
    return context.json(await access(context.req.raw, async (db, account) => {
      const libraryId = await enabledChannel(db, account.accountId);
      const requestDigest = digest(submission);
      const existing = (await db.query<DeliveryRow>(
        `SELECT library_id,operation_id,envelope,envelope_digest,receipt,created_at
         FROM sensa_consumer.intake_envelopes
         WHERE account_id=$1 AND library_id=$2 AND operation_id=$3 FOR UPDATE`,
        [account.accountId, libraryId, submission.intake.operationId],
      )).rows[0];
      if (existing) {
        if (existing.envelope_digest !== requestDigest) {
          throw new ConsumerError(409, "operation_conflict");
        }
        return deliveryReceipt(existing);
      }
      const now = account.now ?? new Date();
      const row = (await db.query<DeliveryRow>(
        `INSERT INTO sensa_consumer.intake_envelopes
          (account_id,library_id,operation_id,client_id,envelope,envelope_digest,created_at)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)
         RETURNING library_id,operation_id,envelope,envelope_digest,receipt,created_at`,
        [
          account.accountId,
          libraryId,
          submission.intake.operationId,
          submission.client.clientId,
          JSON.stringify(submission),
          requestDigest,
          now,
        ],
      )).rows[0]!;
      return deliveryReceipt(row);
    }));
  });

  app.post("/sensa/intake/deliveries/pull", async (context) => {
    const input = sensaIntakeDeliveryPullRequestSchema.parse(await context.req.json());
    return context.json(await access(context.req.raw, async (db, account) => {
      if (account.installationId) throw new ConsumerError(403, "web_authorization_required");
      const selected = await enabledChannel(db, account.accountId);
      if (selected !== input.libraryId) throw new ConsumerError(409, "library_mismatch");
      const rows = (await db.query<DeliveryRow>(
        `SELECT library_id,operation_id,envelope,envelope_digest,receipt,created_at
         FROM sensa_consumer.intake_envelopes
         WHERE account_id=$1 AND library_id=$2 AND receipt IS NULL
         ORDER BY created_at,operation_id LIMIT $3`,
        [account.accountId, selected, input.limit],
      )).rows;
      return {
        deliveries: rows.map((row) => ({
          deliveryId: row.operation_id,
          libraryId: row.library_id,
          queuedAt: instant(row.created_at),
          submission: sensaIntakeDeliverySubmissionSchema.parse(row.envelope),
        })),
      };
    }));
  });

  app.post("/sensa/intake/deliveries/ack", async (context) => {
    const acknowledgement = sensaIntakeDeliveryAcknowledgementSchema.parse(await context.req.json());
    return context.json(await access(context.req.raw, async (db, account) => {
      if (account.installationId) throw new ConsumerError(403, "web_authorization_required");
      const selected = await enabledChannel(db, account.accountId);
      if (selected !== acknowledgement.libraryId) throw new ConsumerError(409, "library_mismatch");
      const row = (await db.query<DeliveryRow>(
        `SELECT library_id,operation_id,envelope,envelope_digest,receipt,created_at
         FROM sensa_consumer.intake_envelopes
         WHERE account_id=$1 AND library_id=$2 AND operation_id=$3 FOR UPDATE`,
        [account.accountId, selected, acknowledgement.deliveryId],
      )).rows[0];
      if (!row) throw new ConsumerError(404, "intake_delivery_not_found");
      const submission = sensaIntakeDeliverySubmissionSchema.parse(row.envelope);
      if (submission.intake.operationId !== acknowledgement.deliveryId) {
        throw new ConsumerError(409, "operation_conflict");
      }
      if (row.receipt !== null) {
        if (canonicalConsumerJson(row.receipt) !== canonicalConsumerJson(acknowledgement)) {
          throw new ConsumerError(409, "operation_conflict");
        }
        return deliveryReceipt(row);
      }
      await db.query(
        `UPDATE sensa_consumer.intake_envelopes SET receipt=$4::jsonb
         WHERE account_id=$1 AND library_id=$2 AND operation_id=$3`,
        [account.accountId, selected, acknowledgement.deliveryId, JSON.stringify(acknowledgement)],
      );
      return deliveryReceipt({ ...row, receipt: acknowledgement });
    }));
  });

  app.get("/sensa/intake/deliveries/:deliveryId", async (context) => {
    const deliveryId = zUuid(context.req.param("deliveryId"));
    return context.json(await access(context.req.raw, async (db, account) => {
      const libraryId = await enabledChannel(db, account.accountId);
      const row = (await db.query<DeliveryRow>(
        `SELECT library_id,operation_id,envelope,envelope_digest,receipt,created_at
         FROM sensa_consumer.intake_envelopes
         WHERE account_id=$1 AND library_id=$2 AND operation_id=$3`,
        [account.accountId, libraryId, deliveryId],
      )).rows[0];
      if (!row) throw new ConsumerError(404, "intake_delivery_not_found");
      return deliveryReceipt(row);
    }));
  });
}

function zUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new ConsumerError(400, "invalid_request");
  }
  return value;
}

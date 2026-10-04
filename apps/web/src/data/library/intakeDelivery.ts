import {
  sensaIntakeDeliveryChannelRequestSchema,
  sensaIntakeDeliveryContractVersion,
  sensaIntakeDeliveryPullResultSchema,
  sensaIntakeDeliveryReceiptSchema,
  type SensaIntakeDeliveryAcknowledgement,
  type SensaIntakeDeliveryReceipt,
  type SensaQueuedIntakeDelivery,
} from "@sensa/contracts/sensa";

import { auth } from "../account/auth";

async function endpoint(): Promise<{ base: string; token: string; subject: string }> {
  const session = (await auth?.getSession())?.data.session;
  if (!session) throw new Error("authentication_required");
  const configured = import.meta.env.VITE_SENSA_API_URL as string | undefined;
  if (!configured) throw new Error("intake_delivery_unavailable");
  return {
    base: configured.replace(/\/+$/u, "") + "/sensa/intake",
    token: session.access_token,
    subject: session.user.id,
  };
}

async function send(path: string, body: unknown, expectedSubject?:string): Promise<unknown> {
  const target = await endpoint();
  if(expectedSubject&&target.subject!==expectedSubject)throw new Error('account_changed');
  const response = await fetch(target.base + path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
  });
  const current = (await auth?.getSession())?.data.session;
  if (!current || current.user.id !== target.subject) throw new Error("account_changed");
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.code ?? "intake_delivery_unavailable");
  return value;
}

export async function registerIntakeDeliveryChannel(libraryId: string, expectedSubject?:string): Promise<void> {
  const request = sensaIntakeDeliveryChannelRequestSchema.parse({
    contractVersion: sensaIntakeDeliveryContractVersion,
    libraryId,
  });
  await send("/channel", request, expectedSubject);
}

export async function pullIntakeDeliveries(libraryId: string): Promise<SensaQueuedIntakeDelivery[]> {
  const result = sensaIntakeDeliveryPullResultSchema.parse(await send("/deliveries/pull", {
    contractVersion: sensaIntakeDeliveryContractVersion,
    libraryId,
    limit: 20,
  }));
  return result.deliveries;
}

export async function acknowledgeIntakeDelivery(
  acknowledgement: SensaIntakeDeliveryAcknowledgement,
): Promise<SensaIntakeDeliveryReceipt> {
  return sensaIntakeDeliveryReceiptSchema.parse(await send(
    "/deliveries/ack",
    acknowledgement,
  ));
}

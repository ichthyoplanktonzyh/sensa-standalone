import type {
  SensaLearningSessionSnapshot,
  SensaPinnedContentManifest,
  SensaPinnedContentSingleItem,
  SensaPlanNextResult,
  SensaSyncCursorPair,
  SensaSyncV2BootstrapResult,
  SensaSyncV2Operation,
  SensaSyncV2PullResult,
  SensaSyncV2PushResult,
} from "@sensa/contracts/sensa";
import {
  sensaApiMeSchema,
  sensaEncounterStepSchema,
  sensaErrorShapeSchema,
  sensaInterruptedEncounterSchema,
  sensaLearningSessionStartResultSchema,
  sensaMediaDownloadSchema,
  sensaPinnedContentItemSchema,
  sensaPinnedContentManifestSchema,
  sensaPlanNextResultSchema,
  sensaScopeSchema,
  sensaSyncV2BootstrapResultSchema,
  sensaSyncV2PullResultSchema,
  sensaSyncV2PushResultSchema,
  sensaUuidRouteParamSchema,
} from "@sensa/contracts/sensa";
import { z } from "zod";
import { sensaWebEnv } from "./env";

export type SensaMe = z.output<typeof sensaApiMeSchema>;
export type SensaScope = z.output<typeof sensaScopeSchema>;
export type SensaApiErrorShape = z.output<typeof sensaErrorShapeSchema>;
export type SensaEncounterStep = z.output<typeof sensaEncounterStepSchema>;
export type SensaMediaDownload = z.output<typeof sensaMediaDownloadSchema>;

/** The server answered, and the answer was a refusal we can name. */
export class SensaApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;

  constructor(message: string, status: number, shape: SensaApiErrorShape) {
    super(message);
    this.name = "SensaApiError";
    this.status = status;
    this.code = shape.code ?? null;
    this.requestId = shape.requestId ?? null;
  }
}

/**
 * The server answered with a shape this build cannot read. This is never
 * retryable and never recoverable by the learner: it means the two sides
 * disagree about the contract, so it is reported rather than swallowed.
 */
export class SensaContractError extends Error {
  readonly path: string;
  readonly detail: string;

  constructor(path: string, detail: string) {
    super(`响应不符合当前合同（${path}）：${detail}`);
    this.name = "SensaContractError";
    this.path = path;
    this.detail = detail;
  }
}

function apiOrigin(): string {
  return (sensaWebEnv.VITE_SENSA_API_URL ?? "http://127.0.0.1:8080").replace(/\/$/u, "");
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text } satisfies SensaApiErrorShape;
  }
}

function errorShape(value: unknown): SensaApiErrorShape {
  const parsed = sensaErrorShapeSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/**
 * The single network boundary. Everything that enters the app passes its
 * schema here exactly once; nothing downstream re-validates it, which is what
 * keeps a cold start from spending its time in Zod instead of on screen.
 */
async function requestJson<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch (caught) {
    throw new SensaApiError(
      caught instanceof Error ? `无法连接学习服务：${caught.message}` : "无法连接学习服务。",
      0,
      {},
    );
  }
  const body = await readBody(response);
  if (!response.ok) {
    const shape = errorShape(body);
    throw new SensaApiError(shape.error ?? `请求失败（${response.status}）`, response.status, shape);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const at = issue === undefined ? "" : issue.path.join(".");
    throw new SensaContractError(`${path}${at === "" ? "" : ` → ${at}`}`, issue?.message ?? "未知形状");
  }
  return parsed.data;
}

function post(value: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(value) };
}

function uuid(value: string, field: string): string {
  const parsed = sensaUuidRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new SensaContractError(field, "必须是 UUID");
  return parsed.data;
}

function workspacePath(scope: SensaScope): string {
  return `/workspaces/${uuid(scope.workspaceId, "workspaceId")}/sensa`;
}

export const sensaApi = {
  me(): Promise<SensaMe> {
    return requestJson("/me", sensaApiMeSchema);
  },

  syncBootstrap(scope: SensaScope): Promise<SensaSyncV2BootstrapResult> {
    return requestJson(
      `${workspacePath(scope)}/sync/bootstrap`,
      sensaSyncV2BootstrapResultSchema,
      post({ wireVersion: "sensa-sync-v2", replicaId: scope.replicaId }),
    );
  },

  syncPull(scope: SensaScope, cursors: SensaSyncCursorPair, limit = 500): Promise<SensaSyncV2PullResult> {
    return requestJson(
      `${workspacePath(scope)}/sync/pull`,
      sensaSyncV2PullResultSchema,
      post({ wireVersion: "sensa-sync-v2", replicaId: scope.replicaId, cursors, limit }),
    );
  },

  syncPush(
    scope: SensaScope,
    cursors: SensaSyncCursorPair,
    operations: readonly SensaSyncV2Operation[],
  ): Promise<SensaSyncV2PushResult> {
    return requestJson(
      `${workspacePath(scope)}/sync/push`,
      sensaSyncV2PushResultSchema,
      post({ wireVersion: "sensa-sync-v2", replicaId: scope.replicaId, cursors, operations }),
    );
  },

  /**
   * The lightweight index over the pinned Book Version: identity and labels for
   * every member, and no assets. It is the only content call made eagerly.
   */
  contentManifest(scope: SensaScope, studyPlanId: string): Promise<SensaPinnedContentManifest> {
    return requestJson(
      `${workspacePath(scope)}/study-plans/${uuid(studyPlanId, "studyPlanId")}/content/manifest`,
      sensaPinnedContentManifestSchema,
    );
  },

  /** One member's complete package, fetched only when it is about to be used. */
  contentItem(
    scope: SensaScope,
    studyPlanId: string,
    senseId: string,
  ): Promise<SensaPinnedContentSingleItem> {
    return requestJson(
      `${workspacePath(scope)}/study-plans/${uuid(studyPlanId, "studyPlanId")}/content/items/${uuid(senseId, "senseId")}`,
      sensaPinnedContentItemSchema,
    );
  },

  startOrResumeSession(
    scope: SensaScope,
    studyPlanId: string,
    learningSessionId: string,
  ): Promise<SensaLearningSessionSnapshot> {
    return requestJson(
      `${workspacePath(scope)}/learning-sessions/start-or-resume`,
      sensaLearningSessionStartResultSchema,
      post({
        learningSessionId: uuid(learningSessionId, "learningSessionId"),
        studyPlanId: uuid(studyPlanId, "studyPlanId"),
        replicaId: scope.replicaId,
      }),
    ).then((result) => result.learningSession);
  },

  planNext(
    scope: SensaScope,
    studyPlanId: string,
    learningSessionId: string,
  ): Promise<SensaPlanNextResult> {
    return requestJson(
      `${workspacePath(scope)}/learning-sessions/${uuid(learningSessionId, "learningSessionId")}/plan-next`,
      sensaPlanNextResultSchema,
      post({
        studyPlanId: uuid(studyPlanId, "studyPlanId"),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
  },

  openEncounter(scope: SensaScope, encounterId: string): Promise<SensaEncounterStep> {
    return requestJson(
      `${workspacePath(scope)}/sense-encounters/${uuid(encounterId, "encounterId")}/open`,
      sensaEncounterStepSchema,
      post({}),
    );
  },

  interruptEncounter(
    scope: SensaScope,
    encounterId: string,
    status: "interrupted" | "cancelled",
  ): Promise<z.output<typeof sensaInterruptedEncounterSchema>> {
    return requestJson(
      `${workspacePath(scope)}/sense-encounters/${uuid(encounterId, "encounterId")}/interrupt`,
      sensaInterruptedEncounterSchema,
      post({ status }),
    );
  },

  /**
   * Media is addressed through the Action that referenced it, not through the
   * Package: an asset the current Action does not reference has no URL.
   */
  mediaDownload(
    scope: SensaScope,
    encounterId: string,
    actionId: string,
    assetId: string,
  ): Promise<SensaMediaDownload> {
    return requestJson(
      `${workspacePath(scope)}/sense-encounters/${uuid(encounterId, "encounterId")}`
      + `/actions/${uuid(actionId, "actionId")}`
      + `/assets/${uuid(assetId, "learningAssetId")}/download-url`,
      sensaMediaDownloadSchema,
    );
  },
};

import { Hono } from "hono";
import type { AppEnv } from "../server/appEnv.js";
import {
  loadRequestContextFromRequest,
} from "../server/requestContext.js";
import {
  expectRecord,
  parseJsonBody,
} from "../server/requestParsing.js";
import { HttpError } from "../shared/errors.js";
import { assertUserHasWorkspaceAccess } from "../workspaces/index.js";
import {
  postgresSensaEncounterModule,
} from "../sensa/encounter/postgres.js";
import { SensaEncounterError, sensaEncounterStepSchema, sensaInterruptedEncounterSchema } from "@sensa/contracts/sensa";
import type { EncounterModule } from "@sensa/contracts/sensa";
import type { EncounterStep } from "@sensa/learning-kernel";
import { canonicalJsonDigest } from "@sensa/learning-kernel";
import { sensaEncounterAttemptBodySchema, sensaEncounterInterruptBodySchema, sensaUuidRouteParamSchema, sensaWorkspaceRouteParamSchema } from "@sensa/contracts/sensa";

export type SensaEncounterRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  encounterModule?: EncounterModule;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
}>;

function parseEncounterWorkspaceId(value: string | undefined): string {
  const parsed = sensaWorkspaceRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "workspaceId must be a UUID.", "SENSA_ENCOUNTER_WORKSPACE_ID_INVALID");
  return parsed.data;
}

async function parseEncounterBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return expectRecord(await parseJsonBody(request));
  } catch (caught) {
    if (caught instanceof HttpError) throw new HttpError(400, caught.message, "SENSA_ENCOUNTER_BODY_INVALID");
    throw caught;
  }
}

function pathUuid(value: string | undefined, field: string): string {
  const parsed = sensaUuidRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `${field} must be a UUID.`, `SENSA_ENCOUNTER_${field.toUpperCase()}_INVALID`);
  return parsed.data;
}

/**
 * The Encounter Module speaks the kernel's domain types, where instants are
 * `Date`.  The wire contract speaks JSON, where they are ISO-8601 strings.
 * Translating at this boundary keeps the kernel free of transport concerns and
 * keeps `sensaEncounterStepSchema` a truthful description of the response --
 * without it, every completed Encounter serialized to a 500 *after* the
 * transaction had already closed the Encounter and handed FSRS its Outcome.
 */
function encounterStepResponse(step: EncounterStep): unknown {
  if (step.kind === "next_action") return step;
  return {
    ...step,
    memoryOutcome: {
      ...step.memoryOutcome,
      observedCompletedAt: step.memoryOutcome.observedCompletedAt.toISOString(),
      effectiveReviewedAt: step.memoryOutcome.effectiveReviewedAt?.toISOString() ?? null,
      createdAt: step.memoryOutcome.createdAt.toISOString(),
    },
    memoryState: {
      ...step.memoryState,
      dueAt: step.memoryState.dueAt?.toISOString() ?? null,
      fsrsLastReviewedAt: step.memoryState.fsrsLastReviewedAt?.toISOString() ?? null,
      updatedAt: step.memoryState.updatedAt.toISOString(),
    },
  };
}

function mapEncounterError(caught: unknown): never {
  if (caught instanceof SensaEncounterError) {
    const code = `SENSA_ENCOUNTER_${caught.code.toUpperCase()}`;
    throw new HttpError(caught.statusCode, caught.message, code);
  }
  throw caught;
}

export function createSensaEncounterRoutes(options: SensaEncounterRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const encounterModule = options.encounterModule ?? postgresSensaEncounterModule;
  const loadContext = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertWorkspace = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;

  app.post("/workspaces/:workspaceId/sensa/sense-encounters/:encounterId/open", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const workspaceId = parseEncounterWorkspaceId(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, workspaceId);
    try {
      const result = await encounterModule.open({
        workspaceId,
        learnerUserId: requestContext.userId,
        encounterId: pathUuid(context.req.param("encounterId"), "encounterId"),
      });
      return context.json(sensaEncounterStepSchema.parse(encounterStepResponse(result)));
    } catch (caught) {
      return mapEncounterError(caught);
    }
  });

  app.post("/workspaces/:workspaceId/sensa/sense-encounters/:encounterId/attempts", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const workspaceId = parseEncounterWorkspaceId(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, workspaceId);
    const bodyResult = sensaEncounterAttemptBodySchema.safeParse(await parseEncounterBody(context.req.raw));
    if (!bodyResult.success) throw new HttpError(400, "Encounter attempt body is invalid.", "SENSA_ENCOUNTER_BODY_INVALID");
    const body = bodyResult.data;
    const responsePayload = { object: body.responsePayload, digest: canonicalJsonDigest(body.responsePayload) };
    try {
      const result = await encounterModule.submitAttempt({
        workspaceId,
        learnerUserId: requestContext.userId,
        encounterId: pathUuid(context.req.param("encounterId"), "encounterId"),
        attemptId: body.attemptId,
        learningActionId: body.actionId,
        ordinal: body.ordinal,
        sourceReplicaId: body.replicaId,
        responseSchemaVersion: body.responseSchemaVersion,
        responsePayload,
        durationMs: body.durationMs ?? null,
        occurredAt: new Date(body.occurredAt),
      });
      return context.json(sensaEncounterStepSchema.parse(encounterStepResponse(result)));
    } catch (caught) {
      return mapEncounterError(caught);
    }
  });

  app.post("/workspaces/:workspaceId/sensa/sense-encounters/:encounterId/interrupt", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const workspaceId = parseEncounterWorkspaceId(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, workspaceId);
    const bodyResult = sensaEncounterInterruptBodySchema.safeParse(await parseEncounterBody(context.req.raw));
    if (!bodyResult.success) throw new HttpError(400, "Encounter interruption body is invalid.", "SENSA_ENCOUNTER_BODY_INVALID");
    const status = bodyResult.data.status ?? "interrupted";
    try {
      const result = await encounterModule.interrupt({
        workspaceId,
        learnerUserId: requestContext.userId,
        encounterId: pathUuid(context.req.param("encounterId"), "encounterId"),
        status,
      });
      return context.json(sensaInterruptedEncounterSchema.parse(result));
    } catch (caught) {
      return mapEncounterError(caught);
    }
  });

  return app;
}

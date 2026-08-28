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
  postgresSensaPlanningModule,
} from "../sensa/planning/postgres.js";
import type { SensaPlanningModule } from "@sensa/contracts/sensa";
import { sensaLearningSessionStartResultSchema, sensaPlanNextResultSchema, sensaPlanningCreateBodySchema, sensaPlanningNextBodySchema, sensaPlanningStartBodySchema, sensaStudyPlanCreateResultSchema, sensaUuidRouteParamSchema, sensaWorkspaceRouteParamSchema } from "@sensa/contracts/sensa";
import { validateIanaTimeZone } from "../progress/timeZone.js";

export type SensaPlanningRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  planningModule?: SensaPlanningModule;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
}>;

function parseOptionalTimeZone(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new HttpError(400, "timeZone must be a valid IANA timezone.", "SENSA_PLANNING_TIMEZONE_INVALID");
  }
  const validation = validateIanaTimeZone(value);
  if (!validation.ok) {
    throw new HttpError(400, "timeZone must be a valid IANA timezone.", "SENSA_PLANNING_TIMEZONE_INVALID");
  }
  return validation.timeZone;
}

function parsePlanningWorkspaceId(value: string | undefined): string {
  const parsed = sensaWorkspaceRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "workspaceId must be a UUID.", "SENSA_PLANNING_WORKSPACE_ID_INVALID");
  return parsed.data;
}

async function parsePlanningBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return expectRecord(await parseJsonBody(request));
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(400, error.message, "SENSA_PLANNING_BODY_INVALID");
    }
    throw error;
  }
}

function expectPlanningUuid(
  value: unknown,
  fieldName: string,
  code: string,
): string {
  const parsed = sensaUuidRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `${fieldName} must be a UUID.`, code);
  return parsed.data;
}

export function createSensaPlanningRoutes(options: SensaPlanningRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const planningModule = options.planningModule ?? postgresSensaPlanningModule;
  const loadRequestContextFromRequestFn = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertUserHasWorkspaceAccessFn = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;

  app.post("/workspaces/:workspaceId/sensa/study-plans", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const workspaceId = parsePlanningWorkspaceId(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
    const bodyResult = sensaPlanningCreateBodySchema.safeParse(await parsePlanningBody(context.req.raw));
    if (!bodyResult.success) throw new HttpError(400, "Study plan body is invalid.", "SENSA_PLANNING_BODY_INVALID");
    const body = bodyResult.data;
    const result = await planningModule.createStudyPlan({
      workspaceId,
      learnerUserId: requestContext.userId,
      studyPlanId: body.studyPlanId,
      bookVersionId: body.bookVersionId,
      dailyNewSenseTarget: body.dailyNewSenseTarget,
      replicaId: body.replicaId,
      now: new Date(),
    });
    return context.json(sensaStudyPlanCreateResultSchema.parse(result), result.status === "created" ? 201 : 200);
  });

  app.post("/workspaces/:workspaceId/sensa/learning-sessions/start-or-resume", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const workspaceId = parsePlanningWorkspaceId(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
    const bodyResult = sensaPlanningStartBodySchema.safeParse(await parsePlanningBody(context.req.raw));
    if (!bodyResult.success) throw new HttpError(400, "Learning session body is invalid.", "SENSA_PLANNING_BODY_INVALID");
    const body = bodyResult.data;
    const result = await planningModule.startOrResumeLearningSession({
      workspaceId,
      learnerUserId: requestContext.userId,
      learningSessionId: body.learningSessionId,
      studyPlanId: body.studyPlanId,
      replicaId: body.replicaId,
      now: new Date(),
    });
    return context.json(sensaLearningSessionStartResultSchema.parse(result), result.status === "started" ? 201 : 200);
  });

  app.post("/workspaces/:workspaceId/sensa/learning-sessions/:learningSessionId/plan-next", async (context) => {
    const { requestContext } = await loadRequestContextFromRequestFn(
      context.req.raw,
      options.allowedOrigins,
    );
    const workspaceId = parsePlanningWorkspaceId(context.req.param("workspaceId"));
    await assertUserHasWorkspaceAccessFn(requestContext.userId, workspaceId);
    const bodyResult = sensaPlanningNextBodySchema.safeParse(await parsePlanningBody(context.req.raw));
    if (!bodyResult.success) throw new HttpError(400, "Planning request body is invalid.", "SENSA_PLANNING_BODY_INVALID");
    const body = bodyResult.data;
    const result = await planningModule.planNext({
      workspaceId,
      learnerUserId: requestContext.userId,
      learningSessionId: expectPlanningUuid(context.req.param("learningSessionId"), "learningSessionId", "SENSA_PLANNING_LEARNING_SESSION_ID_INVALID"),
      studyPlanId: body.studyPlanId,
      selectionMode: body.selectionMode ?? "mixed",
      timeZone: parseOptionalTimeZone(body.timeZone),
      now: new Date(),
    });
    return context.json(sensaPlanNextResultSchema.parse(result));
  });

  return app;
}

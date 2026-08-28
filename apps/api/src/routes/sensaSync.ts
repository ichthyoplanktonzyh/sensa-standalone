import { Hono } from "hono";
import type { AppEnv } from "../server/appEnv.js";
import {
  loadRequestContextFromRequest,
} from "../server/requestContext.js";
import { expectRecord, parseJsonBody } from "../server/requestParsing.js";
import { HttpError } from "../shared/errors.js";
import { assertUserHasWorkspaceAccess } from "../workspaces/index.js";
import {
  parseSensaSyncBootstrapInput,
  parseSensaSyncPullInput,
  parseSensaSyncPushInput,
  parseSensaSyncV2BootstrapInput,
  parseSensaSyncV2PullInput,
  parseSensaSyncV2PushInput,
  postgresSensaSyncModule,
  SensaSyncError,
} from "../sensa/sync/postgres.js";
import {
  sensaSyncV2WireVersion,
  type SensaSyncModule,
  type SensaSyncV2Module,
} from "@sensa/contracts/sensa";
import { sensaSyncBootstrapBodySchema, sensaSyncPullBodySchema, sensaSyncPushBodySchema, sensaSyncV2BootstrapResultSchema, sensaSyncV2PullResultSchema, sensaSyncV2PushResultSchema, sensaWorkspaceRouteParamSchema } from "@sensa/contracts/sensa";

export type SensaSyncRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  syncModule?: SensaSyncModule & SensaSyncV2Module;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
}>;

function workspaceId(value: string | undefined): string {
  const parsed = sensaWorkspaceRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "workspaceId must be a UUID.", "SENSA_SYNC_WORKSPACE_ID_INVALID");
  return parsed.data;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    return expectRecord(await parseJsonBody(request));
  } catch (caught) {
    if (caught instanceof HttpError) throw new HttpError(400, caught.message, "SENSA_SYNC_BODY_INVALID");
    throw caught;
  }
}

function mapError(caught: unknown): never {
  if (caught instanceof SensaSyncError) {
    const code = `SENSA_SYNC_${caught.code.toUpperCase()}`;
    throw new HttpError(caught.statusCode, caught.message, code);
  }
  throw caught;
}

function requestedWireVersion(value: Record<string, unknown>): string {
  return typeof value.wireVersion === "string" ? value.wireVersion : "";
}

export function createSensaSyncRoutes(options: SensaSyncRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const syncModule = options.syncModule ?? postgresSensaSyncModule;
  const loadContext = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertWorkspace = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;

  app.post("/workspaces/:workspaceId/sensa/sync/bootstrap", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const id = workspaceId(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, id);
    try {
      const value = await body(context.req.raw);
      if (requestedWireVersion(value) === sensaSyncV2WireVersion) {
        const parsed = sensaSyncBootstrapBodySchema.safeParse(value);
        if (!parsed.success) throw new HttpError(400, "Sensa Sync bootstrap body is invalid.", "SENSA_SYNC_BODY_INVALID");
        const result = await (syncModule as SensaSyncV2Module).bootstrap(parseSensaSyncV2BootstrapInput({ workspaceId: id, learnerUserId: requestContext.userId, replicaId: parsed.data.replicaId }, parsed.data));
        return context.json(sensaSyncV2BootstrapResultSchema.parse(result));
      }
      return context.json(await syncModule.bootstrap(parseSensaSyncBootstrapInput({ workspaceId: id, learnerUserId: requestContext.userId, replicaId: String(value.replicaId ?? "") }, value)));
    } catch (caught) {
      return mapError(caught);
    }
  });

  app.post("/workspaces/:workspaceId/sensa/sync/push", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const id = workspaceId(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, id);
    try {
      const value = await body(context.req.raw);
      if (requestedWireVersion(value) === sensaSyncV2WireVersion) {
        const parsed = sensaSyncPushBodySchema.safeParse(value);
        if (!parsed.success) throw new HttpError(400, "Sensa Sync push body is invalid.", "SENSA_SYNC_BODY_INVALID");
        const result = await (syncModule as SensaSyncV2Module).push(parseSensaSyncV2PushInput({ workspaceId: id, learnerUserId: requestContext.userId, replicaId: parsed.data.replicaId }, parsed.data));
        return context.json(sensaSyncV2PushResultSchema.parse(result));
      }
      return context.json(await syncModule.push(parseSensaSyncPushInput({ workspaceId: id, learnerUserId: requestContext.userId, replicaId: String(value.replicaId ?? "") }, value)));
    } catch (caught) {
      return mapError(caught);
    }
  });

  app.post("/workspaces/:workspaceId/sensa/sync/pull", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const id = workspaceId(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, id);
    try {
      const value = await body(context.req.raw);
      if (requestedWireVersion(value) === sensaSyncV2WireVersion) {
        const parsed = sensaSyncPullBodySchema.safeParse(value);
        if (!parsed.success) throw new HttpError(400, "Sensa Sync pull body is invalid.", "SENSA_SYNC_BODY_INVALID");
        const result = await (syncModule as SensaSyncV2Module).pull(parseSensaSyncV2PullInput({ workspaceId: id, learnerUserId: requestContext.userId, replicaId: parsed.data.replicaId }, parsed.data));
        return context.json(sensaSyncV2PullResultSchema.parse(result));
      }
      return context.json(await syncModule.pull(parseSensaSyncPullInput({ workspaceId: id, learnerUserId: requestContext.userId, replicaId: String(value.replicaId ?? "") }, value)));
    } catch (caught) {
      return mapError(caught);
    }
  });

  return app;
}

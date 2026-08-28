import { Hono } from "hono";
import type { AppEnv } from "../server/appEnv.js";
import {
  loadRequestContextFromRequest,
} from "../server/requestContext.js";
import { HttpError } from "../shared/errors.js";
import { assertUserHasWorkspaceAccess } from "../workspaces/index.js";
import {
  postgresSensaPinnedContentModule,
} from "../sensa/catalog/pinnedContent.js";
import type {
  SensaPinnedContentItemInput,
  SensaPinnedContentManifestInput,
  SensaPinnedContentModule,
  SensaPinnedContentPageInput,
} from "@sensa/contracts/sensa";
import {
  sensaPinnedContentItemSchema,
  sensaPinnedContentManifestSchema,
  sensaPinnedContentPageSchema,
  sensaPinnedContentQuerySchema,
  sensaUuidRouteParamSchema,
  sensaWorkspaceRouteParamSchema,
} from "@sensa/contracts/sensa";

export type SensaPinnedContentRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  pinnedContentModule?: SensaPinnedContentModule;
  loadRequestContextFromRequestFn?: typeof loadRequestContextFromRequest;
  assertUserHasWorkspaceAccessFn?: typeof assertUserHasWorkspaceAccess;
}>;


function parseWorkspace(value: string | undefined): string {
  const parsed = sensaWorkspaceRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "workspaceId must be a UUID.", "SENSA_PINNED_CONTENT_WORKSPACE_ID_INVALID");
  return parsed.data;
}

function parseUuid(value: string | undefined, fieldName: string): string {
  const parsed = sensaUuidRouteParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(400, `${fieldName} must be a UUID.`, `SENSA_PINNED_CONTENT_${fieldName.toUpperCase()}_INVALID`);
  }
  return parsed.data;
}

export function createSensaPinnedContentRoutes(
  options: SensaPinnedContentRoutesOptions,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const pinnedContentModule = options.pinnedContentModule ?? postgresSensaPinnedContentModule;
  const loadContext = options.loadRequestContextFromRequestFn ?? loadRequestContextFromRequest;
  const assertWorkspace = options.assertUserHasWorkspaceAccessFn ?? assertUserHasWorkspaceAccess;

  app.get("/workspaces/:workspaceId/sensa/study-plans/:studyPlanId/content/manifest", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspace(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, workspaceId);
    const input: SensaPinnedContentManifestInput = {
      workspaceId,
      learnerUserId: requestContext.userId,
      studyPlanId: parseUuid(context.req.param("studyPlanId"), "studyPlanId"),
    };
    const result = await pinnedContentModule.getManifest(input);
    return context.json(sensaPinnedContentManifestSchema.parse(result));
  });

  app.get("/workspaces/:workspaceId/sensa/study-plans/:studyPlanId/content/items", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspace(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, workspaceId);
    const query = sensaPinnedContentQuerySchema.safeParse({
      cursor: context.req.query("cursor"),
      limit: context.req.query("limit"),
    });
    if (!query.success) throw new HttpError(400, "Pinned content query parameters are invalid.", "SENSA_PINNED_CONTENT_QUERY_INVALID");
    const input: SensaPinnedContentPageInput = {
      workspaceId,
      learnerUserId: requestContext.userId,
      studyPlanId: parseUuid(context.req.param("studyPlanId"), "studyPlanId"),
      cursor: query.data.cursor ?? null,
      pageSize: query.data.limit ?? 10,
    };
    const result = await pinnedContentModule.getPage(input);
    return context.json(sensaPinnedContentPageSchema.parse(result));
  });

  // On-demand counterpart to the manifest: a client holds the index and pulls
  // one member's package when it actually needs to render or teach it.
  app.get("/workspaces/:workspaceId/sensa/study-plans/:studyPlanId/content/items/:senseId", async (context) => {
    const { requestContext } = await loadContext(context.req.raw, options.allowedOrigins);
    const workspaceId = parseWorkspace(context.req.param("workspaceId"));
    await assertWorkspace(requestContext.userId, workspaceId);
    const input: SensaPinnedContentItemInput = {
      workspaceId,
      learnerUserId: requestContext.userId,
      studyPlanId: parseUuid(context.req.param("studyPlanId"), "studyPlanId"),
      senseId: parseUuid(context.req.param("senseId"), "senseId"),
    };
    const result = await pinnedContentModule.getItem(input);
    return context.json(sensaPinnedContentItemSchema.parse(result));
  });

  return app;
}

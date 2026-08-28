import { Hono } from "hono";
import type { AppEnv } from "../server/appEnv.js";
import { loadRequestContextFromRequest } from "../server/requestContext.js";
import { HttpError } from "../shared/errors.js";
import { assertUserHasWorkspaceAccess } from "../workspaces/index.js";
import { postgresSensaMediaModule } from "../sensa/media/postgres.js";
import type { SensaMediaModule } from "../sensa/media/contracts.js";
import {
  createLocalMediaCapability,
  isSensaLocalMediaEnabled,
  loadLocalMediaResponse,
} from "../sensa/media/local.js";
import { sensaMediaCapabilitySchema, sensaMediaDownloadSchema, sensaUuidRouteParamSchema, sensaWorkspaceRouteParamSchema } from "@sensa/contracts/sensa";
import { readSensaApiEnvironment } from "../server/environment.js";

export type SensaMediaRoutesOptions = Readonly<{
  allowedOrigins: ReadonlyArray<string>;
  mediaModule?: SensaMediaModule;
}>;

function parseWorkspace(value: string | undefined): string {
  const parsed = sensaWorkspaceRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, "workspaceId must be a UUID.", "SENSA_MEDIA_WORKSPACE_ID_INVALID");
  return parsed.data;
}

function parseUuid(value: string | undefined, fieldName: string): string {
  const parsed = sensaUuidRouteParamSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `${fieldName} must be a UUID.`, `SENSA_MEDIA_${fieldName.toUpperCase()}_INVALID`);
  return parsed.data;
}

export function createSensaMediaRoutes(options: SensaMediaRoutesOptions): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const mediaModule = options.mediaModule ?? postgresSensaMediaModule;

  app.get(
    "/workspaces/:workspaceId/sensa/sense-encounters/:senseEncounterId/actions/:learningActionId/assets/:learningAssetId/download-url",
    async (context) => {
      const { requestContext } = await loadRequestContextFromRequest(context.req.raw, options.allowedOrigins);
      const workspaceId = parseWorkspace(context.req.param("workspaceId"));
      await assertUserHasWorkspaceAccess(requestContext.userId, workspaceId);
      const source = await mediaModule.loadDownloadSource({
        workspaceId,
        learnerUserId: requestContext.userId,
        senseEncounterId: parseUuid(context.req.param("senseEncounterId"), "senseEncounterId"),
        learningActionId: parseUuid(context.req.param("learningActionId"), "learningActionId"),
        learningAssetId: parseUuid(context.req.param("learningAssetId"), "learningAssetId"),
      });

      if (readSensaApiEnvironment().AUTH_MODE === "none") {
        if (!isSensaLocalMediaEnabled()) {
          throw new HttpError(404, "The requested Sensa audio is not available.", "SENSA_MEDIA_AUDIO_NOT_FOUND");
        }
        return context.json(sensaMediaDownloadSchema.parse({
          media: source.media,
          download: createLocalMediaCapability({ requestUrl: context.req.url, media: source.media }),
        }));
      }

      throw new HttpError(
        501,
        "R2 media download adapter is not configured in this standalone build.",
        "SENSA_MEDIA_R2_ADAPTER_NOT_CONFIGURED",
      );
    },
  );

  app.get("/sensa/media/local/:capability", async (context) => {
    const capability = sensaMediaCapabilitySchema.safeParse(context.req.param("capability"));
    if (!capability.success) throw new HttpError(400, "Media capability is invalid.", "SENSA_MEDIA_CAPABILITY_INVALID");
    return loadLocalMediaResponse(
    capability.data,
    {
      requestUrl: context.req.url,
      range: context.req.header("range") ?? null,
    },
  );
  });

  return app;
}

import { createConsumerRoutes } from './sensa/access/consumer.js';
import { cors } from "hono/cors";
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { QueryResultRow } from "pg";
import type { SensaApiIdentity } from "@sensa/contracts";
import { sensaApiMeSchema } from "@sensa/contracts/sensa";
import type { AppEnv } from "./server/appEnv.js";
import { queryWithUserScope } from "./database/index.js";
import { HttpError, createPublicHttpErrorDetails, createPublicHttpErrorMessage } from "./shared/errors.js";
import { createSensaCatalogRoutes } from "./routes/sensaCatalog.js";
import { createSensaPinnedContentRoutes } from "./routes/sensaPinnedContent.js";
import { readSensaApiEnvironment } from "./server/environment.js";
import { loadRequestContextFromRequest } from "./server/requestContext.js";

export const sensaApiIdentity: SensaApiIdentity = Object.freeze({
  name: "sensa-standalone",
  version: "0.1.0",
  contractVersion: "sensa-api-v1",
  learningModel: "sense-first-semantic-learning-loop",
});

const defaultAllowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const sensaRoutes = [
  "GET /sensa/books",
  "GET /sensa/book-versions/:bookVersionId/manifest",
  "GET /sensa/content-releases/:contentReleaseId/items",
  "GET /workspaces/:workspaceId/sensa/study-plans/:studyPlanId/content/manifest",
  "GET /workspaces/:workspaceId/sensa/study-plans/:studyPlanId/content/items",
] as const;

function createSensaRouteGroup(allowedOrigins: ReadonlyArray<string>): Hono<AppEnv> {
  const group = new Hono<AppEnv>();
  group.route("", createSensaCatalogRoutes());
  group.route("", createSensaPinnedContentRoutes({ allowedOrigins }));
  return group;
}

function discoveryPayload(): Readonly<Record<string, unknown>> {
  return {
    ...sensaApiIdentity,
    status: "sensa-online-services",
    routes: {
      health: "/health",
      me: "/me",
      sensa: [...sensaRoutes],
    },
    auth: {
      local: "AUTH_MODE=none + ALLOW_INSECURE_LOCAL_AUTH=true on loopback only",
      production: "replaceable Cognito principal adapter seam",
    },
  };
}

type AccountCreatedAtRow = QueryResultRow & Readonly<{ created_at: Date | string }>;

async function loadAccountCreatedAt(userId: string): Promise<string> {
  const result = await queryWithUserScope<AccountCreatedAtRow>(
    { userId },
    "SELECT created_at FROM core.accounts WHERE account_id = $1 LIMIT 1",
    [userId],
  );
  const value = result.rows[0]?.created_at;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>({ strict: false });
  const environment = readSensaApiEnvironment();
  const allowedOrigins = environment.ALLOWED_ORIGINS
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const corsOrigins = allowedOrigins.length === 0 ? defaultAllowedOrigins : allowedOrigins;

  app.use("*", async (context, next) => {
    const requestId = crypto.randomUUID();
    context.set("requestId", requestId);
    context.set("clientAppVersion", context.req.header("x-client-version") ?? null);
    context.set("clientPlatform", context.req.header("x-client-platform") ?? null);
    context.header("X-Request-Id", requestId);
    await next();
  });
  app.use("*", cors({
    origin: corsOrigins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["content-type", "authorization", "x-client-platform", "x-client-version", "x-installation-id"],
    exposeHeaders: ["x-request-id"],
    credentials: true,
  }));

  app.get("/health", (context) => context.json({
    ok: true,
    service: sensaApiIdentity.name,
    version: sensaApiIdentity.version,
  }));
  app.get("/v1/health", (context) => context.json({
    ok: true,
    service: sensaApiIdentity.name,
    version: sensaApiIdentity.version,
  }));
  app.get("/v1", (context) => context.json(discoveryPayload()));
  app.get("/v1/", (context) => context.json(discoveryPayload()));

  const me = async (context: Context<AppEnv>) => {
    const { requestContext } = await loadRequestContextFromRequest(context.req.raw, corsOrigins);
    const createdAt = await loadAccountCreatedAt(requestContext.userId);
    return context.json(sensaApiMeSchema.parse({
      userId: requestContext.userId,
      learnerUserId: requestContext.userId,
      subjectUserId: requestContext.subjectUserId,
      email: requestContext.email,
      locale: requestContext.locale,
      transport: requestContext.transport,
      selectedWorkspaceId: requestContext.selectedWorkspaceId,
      authTransport: "bearer",
      csrfToken: null,
      profile: {
        email: requestContext.email,
        locale: requestContext.locale,
        createdAt,
      },
      preferences: {
        reviewReactionAnimationsEnabled: false,
      },
    }));
  };
  app.get("/me", me);
  app.get("/v1/me", me);

  app.route("", createConsumerRoutes());
  app.route("", createSensaRouteGroup(corsOrigins));
  app.route("/v1", createSensaRouteGroup(corsOrigins));

  app.notFound((context) => context.json({
    error: "Not found",
    requestId: context.get("requestId"),
    code: "NOT_FOUND",
  }, 404));

  app.onError((error, context) => {
    const requestId = context.get("requestId");
    if (error instanceof HttpError) {
      context.status(error.statusCode as ContentfulStatusCode);
      return context.json({
        error: createPublicHttpErrorMessage(error),
        requestId,
        code: error.code,
        ...(createPublicHttpErrorDetails(error.details) === null
          ? {}
          : { details: createPublicHttpErrorDetails(error.details) }),
      });
    }
    console.error(JSON.stringify({
      domain: "sensa-api",
      action: "request_failed",
      requestId,
      path: context.req.path,
      method: context.req.method,
      message: error instanceof Error ? error.message : String(error),
    }));
    context.status(500);
    return context.json({
      error: "Request failed. Try again.",
      requestId,
      code: "INTERNAL_ERROR",
    });
  });

  return app;
}

export const app = createApp();

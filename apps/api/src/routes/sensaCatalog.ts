import { Hono } from "hono";
import type { AppEnv } from "../server/appEnv.js";
import { HttpError } from "../shared/errors.js";
import {
  postgresSensaCatalogModule,
} from "../sensa/catalog/postgres.js";
import type {
  SensaCatalogModule,
  SensaPublicBookListInput,
  SensaPublicBookManifestInput,
  SensaPublicContentReleasePageInput,
} from "@sensa/contracts/sensa";
import { sensaCatalogBooksQuerySchema, sensaCatalogContentQuerySchema, sensaPublicBookListPageSchema, sensaPublicBookManifestSchema, sensaPublicContentReleasePageSchema, sensaUuidRouteParamSchema } from "@sensa/contracts/sensa";

export type SensaCatalogRoutesOptions = Readonly<{
  catalogModule?: SensaCatalogModule;
}>;

function parseUuidParam(value: string | undefined, fieldName: string): string {
  if (value === undefined) {
    throw new HttpError(
      400,
      `${fieldName} is required.`,
      "SENSA_CATALOG_PARAMETER_REQUIRED",
    );
  }
  const parsed = sensaUuidRouteParamSchema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      `${fieldName} must be a UUID.`,
      "SENSA_CATALOG_PARAMETER_INVALID",
    );
  }
  return parsed.data;
}

export function createSensaCatalogRoutes(options: SensaCatalogRoutesOptions = {}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const catalogModule = options.catalogModule ?? postgresSensaCatalogModule;

  app.get("/sensa/books", async (context) => {
    const query = sensaCatalogBooksQuerySchema.safeParse({
      targetLanguage: context.req.query("targetLanguage"),
      learnerLocale: context.req.query("learnerLocale"),
      cursor: context.req.query("cursor"),
      limit: context.req.query("limit"),
    });
    if (!query.success) throw new HttpError(400, "Catalog query parameters are invalid.", "SENSA_CATALOG_QUERY_INVALID");
    const input: SensaPublicBookListInput = {
      targetLanguage: query.data.targetLanguage,
      learnerLocale: query.data.learnerLocale,
      cursor: query.data.cursor ?? null,
      pageSize: query.data.limit ?? 50,
    };
    const result = await catalogModule.listPublicBooks(input);
    return context.json(sensaPublicBookListPageSchema.parse(result));
  });

  app.get("/sensa/book-versions/:bookVersionId/manifest", async (context) => {
    const input: SensaPublicBookManifestInput = {
      bookVersionId: parseUuidParam(context.req.param("bookVersionId"), "bookVersionId"),
    };
    const result = await catalogModule.getPublicBookManifest(input);
    return context.json(sensaPublicBookManifestSchema.parse(result));
  });

  app.get("/sensa/content-releases/:contentReleaseId/items", async (context) => {
    const query = sensaCatalogContentQuerySchema.safeParse({
      bookVersionId: context.req.query("bookVersionId"),
      cursor: context.req.query("cursor"),
      limit: context.req.query("limit"),
    });
    if (!query.success) throw new HttpError(400, "Catalog content query parameters are invalid.", "SENSA_CATALOG_QUERY_INVALID");
    const input: SensaPublicContentReleasePageInput = {
      contentReleaseId: parseUuidParam(context.req.param("contentReleaseId"), "contentReleaseId"),
      bookVersionId: query.data.bookVersionId,
      cursor: query.data.cursor ?? null,
      pageSize: query.data.limit ?? 10,
    };
    const result = await catalogModule.getPublicContentReleasePage(input);
    return context.json(sensaPublicContentReleasePageSchema.parse(result));
  });

  return app;
}

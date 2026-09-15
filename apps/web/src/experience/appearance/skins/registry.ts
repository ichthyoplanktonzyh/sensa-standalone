import { clearSkin } from "./clear";
import { quietSkin } from "./quiet";

/** Curated, build-time registry. It is deliberately not a runtime plugin loader. */
export const skinCatalog = [quietSkin, clearSkin] as const;

export type SkinId = (typeof skinCatalog)[number]["id"];

export const skinById = new Map<SkinId, (typeof skinCatalog)[number]>(
  skinCatalog.map((skin) => [skin.id, skin]),
);

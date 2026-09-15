/** Curated presentation assets; no runtime URL or third-party loader is allowed. */
export const skinAssetContractVersion = "sensa-skin-assets-v1" as const;

export const skinIconRoleCatalog = [
  "navigation-home",
  "navigation-world",
  "navigation-learning",
  "navigation-practice",
  "navigation-settings",
] as const;

export const skinAssetRoleCatalog = ["brand-mark", ...skinIconRoleCatalog] as const;
export const skinAssetSetCatalog = ["quiet-editorial", "clear-utility"] as const;

export type SkinIconRole = (typeof skinIconRoleCatalog)[number];
export type SkinAssetRole = (typeof skinAssetRoleCatalog)[number];
export type SkinAssetSet = (typeof skinAssetSetCatalog)[number];

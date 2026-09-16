/** Curated Skin-specific assets; fixed product-brand artwork has a separate owner. */
export const skinAssetContractVersion = "sensa-skin-assets-v2" as const;

export const skinIconRoleCatalog = [
  "navigation-home",
  "navigation-world",
  "navigation-learning",
  "navigation-practice",
  "navigation-settings",
] as const;

export const skinAssetRoleCatalog = [...skinIconRoleCatalog] as const;
export const skinAssetSetCatalog = ["quiet-editorial", "clear-utility"] as const;

export type SkinIconRole = (typeof skinIconRoleCatalog)[number];
export type SkinAssetRole = (typeof skinAssetRoleCatalog)[number];
export type SkinAssetSet = (typeof skinAssetSetCatalog)[number];

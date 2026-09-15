/**
 * Page-level presentation seam. Product code supplies the same semantic
 * regions in the same logical order; curated skin adapters only arrange them.
 */
export const pageLayoutContractVersion = "sensa-page-layout-v1" as const;

export const pageLayoutFamilyContract = {
  "application-shell": {
    requiredRegions: ["viewport"],
    optionalRegions: ["brand", "navigation", "utilities"],
    logicalOrder: ["brand", "navigation", "utilities", "viewport"],
  },
  "learning-runtime": {
    requiredRegions: ["header", "tools", "progress", "primary"],
    optionalRegions: ["supporting", "feedback", "controls"],
    logicalOrder: ["header", "tools", "progress", "primary", "supporting", "feedback", "controls"],
  },
} as const;

export const pageLayoutModeCatalog = ["viewport", "specimen"] as const;

export const pageLayoutTokenCatalog = [
  "shell-canvas",
  "shell-chrome-background",
  "shell-chrome-border",
  "shell-chrome-shadow",
  "shell-sidebar-width",
  "shell-bar-size",
  "shell-mobile-navigation-size",
  "shell-chrome-inset",
  "shell-navigation-gap",
  "runtime-canvas",
  "runtime-header-background",
  "runtime-header-border",
  "runtime-header-min-size",
  "runtime-primary-max-width",
  "runtime-primary-inline-inset",
  "runtime-primary-block-inset",
  "runtime-region-gap",
  "runtime-supporting-width",
  "runtime-controls-background",
  "runtime-controls-border",
  "runtime-progress-track",
  "runtime-progress-size",
  "runtime-sidebar-shadow",
] as const;

export type PageLayoutFamily = keyof typeof pageLayoutFamilyContract;
export type PageLayoutMode = (typeof pageLayoutModeCatalog)[number];
export type PageLayoutToken = (typeof pageLayoutTokenCatalog)[number];

type FamilyContract<Family extends PageLayoutFamily> = (typeof pageLayoutFamilyContract)[Family];
export type RequiredPageRegion<Family extends PageLayoutFamily> =
  FamilyContract<Family>["requiredRegions"][number];
export type OptionalPageRegion<Family extends PageLayoutFamily> =
  FamilyContract<Family>["optionalRegions"][number];
export type PageRegion<Family extends PageLayoutFamily> =
  | RequiredPageRegion<Family>
  | OptionalPageRegion<Family>;

export function pageLayoutAttributes(family: PageLayoutFamily, mode: PageLayoutMode) {
  return {
    "data-sensa-page-layout": family,
    "data-sensa-layout-mode": mode,
  } as const;
}

export function pageRegionAttributes<Family extends PageLayoutFamily>(
  family: Family,
  region: PageRegion<Family>,
) {
  return {
    "data-sensa-page-family": family,
    "data-sensa-page-region": region,
  } as const;
}

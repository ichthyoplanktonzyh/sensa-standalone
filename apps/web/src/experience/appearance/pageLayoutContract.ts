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
  "workspace-page": {
    requiredRegions: ["header", "primary"],
    optionalRegions: [],
    logicalOrder: ["header", "primary"],
  },
  "collection-browser": {
    requiredRegions: ["header", "controls", "collection"],
    optionalRegions: ["navigation"],
    logicalOrder: ["header", "navigation", "controls", "collection"],
  },
  "detail-workspace": {
    requiredRegions: ["header", "primary"],
    optionalRegions: [],
    logicalOrder: ["header", "primary"],
  },
} as const;

export const pageLayoutModeCatalog = ["viewport", "specimen"] as const;
export const workspacePageMeasureCatalog = ["narrow", "standard", "wide"] as const;
export const collectionBrowserMeasureCatalog = ["narrow", "wide"] as const;
export const collectionBrowserHeaderCatalog = ["flow", "bar"] as const;
export const detailWorkspaceMeasureCatalog = ["narrow", "wide"] as const;
export const detailWorkspaceHeaderCatalog = ["flow", "bar"] as const;
export const detailWorkspacePresentationCatalog = ["page", "panel"] as const;

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
  "workspace-canvas",
  "workspace-content-narrow",
  "workspace-content-standard",
  "workspace-content-wide",
  "workspace-inline-inset-narrow",
  "workspace-inline-inset-standard",
  "workspace-inline-inset-wide",
  "workspace-block-start-narrow",
  "workspace-block-start-standard",
  "workspace-block-start-wide",
  "workspace-block-end-narrow",
  "workspace-block-end-standard",
  "workspace-block-end-wide",
  "workspace-header-gap-narrow",
  "workspace-header-gap-standard",
  "workspace-header-gap-wide",
  "collection-canvas",
  "collection-content-narrow",
  "collection-content-wide",
  "collection-inline-inset-narrow",
  "collection-inline-inset-wide",
  "collection-block-start",
  "collection-block-end",
  "collection-region-gap",
  "collection-header-background",
  "collection-header-border",
  "collection-header-min-size",
  "collection-header-shadow",
  "collection-bar-inline-inset",
  "detail-canvas",
  "detail-panel-background",
  "detail-content-narrow",
  "detail-content-wide",
  "detail-inline-inset-narrow",
  "detail-inline-inset-wide",
  "detail-block-start",
  "detail-block-end",
  "detail-region-gap",
  "detail-header-background",
  "detail-header-border",
  "detail-header-min-size",
  "detail-panel-width",
  "detail-panel-shadow",
] as const;

export type PageLayoutFamily = keyof typeof pageLayoutFamilyContract;
export type PageLayoutMode = (typeof pageLayoutModeCatalog)[number];
export type WorkspacePageMeasure = (typeof workspacePageMeasureCatalog)[number];
export type CollectionBrowserMeasure = (typeof collectionBrowserMeasureCatalog)[number];
export type CollectionBrowserHeader = (typeof collectionBrowserHeaderCatalog)[number];
export type DetailWorkspaceMeasure = (typeof detailWorkspaceMeasureCatalog)[number];
export type DetailWorkspaceHeader = (typeof detailWorkspaceHeaderCatalog)[number];
export type DetailWorkspacePresentation = (typeof detailWorkspacePresentationCatalog)[number];
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

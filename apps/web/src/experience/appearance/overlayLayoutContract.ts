/** Stable overlay anatomy; product behavior remains outside Skin adapters. */
export const overlayLayoutContractVersion = "sensa-overlay-layout-v1" as const;

export const overlayLayoutFamilyContract = {
  dialog: {
    requiredRegions: ["primary"],
    optionalRegions: ["header", "controls"],
    logicalOrder: ["header", "primary", "controls"],
  },
  sheet: {
    requiredRegions: ["primary"],
    optionalRegions: ["header", "controls"],
    logicalOrder: ["header", "primary", "controls"],
  },
  popover: {
    requiredRegions: ["primary"],
    optionalRegions: ["header", "controls"],
    logicalOrder: ["header", "primary", "controls"],
  },
} as const;

export const overlayLayoutModeCatalog = ["viewport", "container", "specimen"] as const;
export const overlayLayoutMeasureCatalog = ["compact", "standard", "wide"] as const;
export const overlayLayoutTokenCatalog = [
  "viewport-inset",
  "panel-compact",
  "panel-standard",
  "panel-wide",
  "panel-max-block-size",
  "sheet-max-block-size",
  "header-inset",
  "primary-inset",
  "controls-inset",
] as const;

export type OverlayLayoutFamily = keyof typeof overlayLayoutFamilyContract;
export type OverlayLayoutMode = (typeof overlayLayoutModeCatalog)[number];
export type OverlayLayoutMeasure = (typeof overlayLayoutMeasureCatalog)[number];
export type OverlayLayoutToken = (typeof overlayLayoutTokenCatalog)[number];
type OverlayFamilyContract<Family extends OverlayLayoutFamily> = (typeof overlayLayoutFamilyContract)[Family];
export type OverlayRegion<Family extends OverlayLayoutFamily> =
  | OverlayFamilyContract<Family>["requiredRegions"][number]
  | OverlayFamilyContract<Family>["optionalRegions"][number];

export function overlayLayoutAttributes(family: OverlayLayoutFamily, mode: OverlayLayoutMode) {
  return {
    "data-sensa-overlay-layout": family,
    "data-sensa-overlay-mode": mode,
  } as const;
}

export function overlayRegionAttributes<Family extends OverlayLayoutFamily>(
  family: Family,
  region: OverlayRegion<Family>,
) {
  return {
    "data-sensa-overlay-family": family,
    "data-sensa-overlay-region": region,
  } as const;
}

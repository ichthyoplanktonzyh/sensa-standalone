import { componentSkinContractVersion } from "./componentContract";
import { pageLayoutContractVersion, type PageLayoutFamily } from "./pageLayoutContract";
import { overlayLayoutContractVersion, type OverlayLayoutFamily } from "./overlayLayoutContract";
import { skinAssetContractVersion, type SkinAssetSet } from "./assetContract";
import { motionContractVersion, type MotionProfile } from "./motionContract";

export const semanticDesignContractVersion = "sensa-semantic-design-v2" as const;

export const semanticColorRoleCatalog = [
  "surface-canvas",
  "surface-subtle",
  "surface-panel",
  "surface-raised",
  "surface-selected",
  "surface-media",
  "fg-primary",
  "fg-secondary",
  "fg-tertiary",
  "fg-inverse",
  "fg-on-media",
  "border-subtle",
  "border-strong",
  "action-primary",
  "action-primary-hover",
  "action-on-primary",
  "focus",
  "selection",
  "accent-soft",
  "feedback-success",
  "feedback-warning",
  "feedback-danger",
  "overlay",
  "progress",
  "decorative",
] as const;

export const semanticFoundationRoleCatalog = [
  "font-product",
  "font-language",
  ...semanticColorRoleCatalog,
  "radius-control",
  "radius-card",
  "radius-overlay",
  "shadow-raised",
  "shadow-overlay",
] as const;

export interface SensaSkinPlugin {
  readonly id: string;
  readonly version: string;
  readonly semanticContractVersion: typeof semanticDesignContractVersion;
  readonly componentContractVersion: typeof componentSkinContractVersion;
  readonly pageLayoutContractVersion: typeof pageLayoutContractVersion;
  readonly overlayLayoutContractVersion: typeof overlayLayoutContractVersion;
  readonly assetContractVersion: typeof skinAssetContractVersion;
  readonly motionContractVersion: typeof motionContractVersion;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly capabilities: {
    readonly colorModes: readonly ["light", "dark"];
    readonly textSizes: readonly ["standard", "large"];
    readonly density: "comfortable" | "compact";
    readonly motion: MotionProfile;
    readonly assetSet: SkinAssetSet;
    readonly pageLayouts: readonly PageLayoutFamily[];
    readonly overlayLayouts: readonly OverlayLayoutFamily[];
  };
}

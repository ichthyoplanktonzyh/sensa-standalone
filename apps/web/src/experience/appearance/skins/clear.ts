import { componentSkinContractVersion } from "../componentContract";
import { pageLayoutContractVersion } from "../pageLayoutContract";
import { overlayLayoutContractVersion } from "../overlayLayoutContract";
import { skinAssetContractVersion } from "../assetContract";
import { motionContractVersion } from "../motionContract";
import { semanticDesignContractVersion, type SensaSkinPlugin } from "../skinContract";

export const clearSkin = {
  id: "clear",
  version: "3.0.0",
  semanticContractVersion: semanticDesignContractVersion,
  componentContractVersion: componentSkinContractVersion,
  pageLayoutContractVersion,
  overlayLayoutContractVersion,
  assetContractVersion: skinAssetContractVersion,
  motionContractVersion,
  nameKey: "appearance.skins.clear.name",
  descriptionKey: "appearance.skins.clear.description",
  capabilities: {
    colorModes: ["light", "dark"],
    textSizes: ["standard", "large"],
    density: "compact",
    motion: "direct",
    assetSet: "clear-utility",
    pageLayouts: ["application-shell", "learning-runtime", "workspace-page", "collection-browser", "detail-workspace"],
    overlayLayouts: ["dialog", "sheet", "popover"],
  },
} as const satisfies SensaSkinPlugin;

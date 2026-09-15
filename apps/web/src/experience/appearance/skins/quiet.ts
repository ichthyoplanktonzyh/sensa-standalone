import { componentSkinContractVersion } from "../componentContract";
import { pageLayoutContractVersion } from "../pageLayoutContract";
import { overlayLayoutContractVersion } from "../overlayLayoutContract";
import { skinAssetContractVersion } from "../assetContract";
import { motionContractVersion } from "../motionContract";
import { semanticDesignContractVersion, type SensaSkinPlugin } from "../skinContract";

export const quietSkin = {
  id: "quiet",
  version: "3.1.0",
  semanticContractVersion: semanticDesignContractVersion,
  componentContractVersion: componentSkinContractVersion,
  pageLayoutContractVersion,
  overlayLayoutContractVersion,
  assetContractVersion: skinAssetContractVersion,
  motionContractVersion,
  nameKey: "appearance.skins.quiet.name",
  descriptionKey: "appearance.skins.quiet.description",
  capabilities: {
    colorModes: ["light", "dark"],
    textSizes: ["standard", "large"],
    density: "comfortable",
    motion: "gentle",
    assetSet: "quiet-editorial",
    pageLayouts: ["application-shell", "learning-runtime", "workspace-page", "collection-browser", "detail-workspace"],
    overlayLayouts: ["dialog", "sheet", "popover"],
  },
} as const satisfies SensaSkinPlugin;

import { componentSkinContractVersion } from "../componentContract";
import { pageLayoutContractVersion } from "../pageLayoutContract";
import { overlayLayoutContractVersion } from "../overlayLayoutContract";
import { semanticDesignContractVersion, type SensaSkinPlugin } from "../skinContract";

export const quietSkin = {
  id: "quiet",
  version: "2.6.0",
  semanticContractVersion: semanticDesignContractVersion,
  componentContractVersion: componentSkinContractVersion,
  pageLayoutContractVersion,
  overlayLayoutContractVersion,
  nameKey: "appearance.skins.quiet.name",
  descriptionKey: "appearance.skins.quiet.description",
  capabilities: {
    colorModes: ["light", "dark"],
    textSizes: ["standard", "large"],
    density: "comfortable",
    motion: "gentle",
    iconSet: "lucide",
    pageLayouts: ["application-shell", "learning-runtime", "workspace-page", "collection-browser", "detail-workspace"],
    overlayLayouts: ["dialog", "sheet", "popover"],
  },
} as const satisfies SensaSkinPlugin;

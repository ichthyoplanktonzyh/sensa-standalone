import { componentSkinContractVersion } from "../componentContract";
import { pageLayoutContractVersion } from "../pageLayoutContract";
import { semanticDesignContractVersion, type SensaSkinPlugin } from "../skinContract";

export const clearSkin = {
  id: "clear",
  version: "2.2.0",
  semanticContractVersion: semanticDesignContractVersion,
  componentContractVersion: componentSkinContractVersion,
  pageLayoutContractVersion,
  nameKey: "appearance.skins.clear.name",
  descriptionKey: "appearance.skins.clear.description",
  capabilities: {
    colorModes: ["light", "dark"],
    textSizes: ["standard", "large"],
    density: "compact",
    motion: "direct",
    iconSet: "lucide",
    pageLayouts: ["application-shell", "learning-runtime"],
  },
} as const satisfies SensaSkinPlugin;

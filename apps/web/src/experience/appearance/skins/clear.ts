import { componentSkinContractVersion } from "../componentContract";
import { semanticDesignContractVersion, type SensaSkinPlugin } from "../skinContract";

export const clearSkin = {
  id: "clear",
  version: "2.0.0",
  semanticContractVersion: semanticDesignContractVersion,
  componentContractVersion: componentSkinContractVersion,
  nameKey: "appearance.skins.clear.name",
  descriptionKey: "appearance.skins.clear.description",
  capabilities: {
    colorModes: ["light", "dark"],
    textSizes: ["standard", "large"],
    density: "compact",
    motion: "direct",
    iconSet: "lucide",
  },
} as const satisfies SensaSkinPlugin;

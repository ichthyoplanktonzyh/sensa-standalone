import { componentSkinContractVersion } from "../componentContract";
import { semanticDesignContractVersion, type SensaSkinPlugin } from "../skinContract";

export const quietSkin = {
  id: "quiet",
  version: "2.0.0",
  semanticContractVersion: semanticDesignContractVersion,
  componentContractVersion: componentSkinContractVersion,
  nameKey: "appearance.skins.quiet.name",
  descriptionKey: "appearance.skins.quiet.description",
  capabilities: {
    colorModes: ["light", "dark"],
    textSizes: ["standard", "large"],
    density: "comfortable",
    motion: "gentle",
    iconSet: "lucide",
  },
} as const satisfies SensaSkinPlugin;

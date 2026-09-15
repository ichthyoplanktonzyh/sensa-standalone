import { componentSkinContractVersion } from "../componentContract";
import { pageLayoutContractVersion } from "../pageLayoutContract";
import { semanticDesignContractVersion, type SensaSkinPlugin } from "../skinContract";

export const quietSkin = {
  id: "quiet",
  version: "2.2.0",
  semanticContractVersion: semanticDesignContractVersion,
  componentContractVersion: componentSkinContractVersion,
  pageLayoutContractVersion,
  nameKey: "appearance.skins.quiet.name",
  descriptionKey: "appearance.skins.quiet.description",
  capabilities: {
    colorModes: ["light", "dark"],
    textSizes: ["standard", "large"],
    density: "comfortable",
    motion: "gentle",
    iconSet: "lucide",
    pageLayouts: ["application-shell", "learning-runtime"],
  },
} as const satisfies SensaSkinPlugin;

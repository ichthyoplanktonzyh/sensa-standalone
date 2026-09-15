export const semanticDesignContractVersion = "sensa-semantic-design-v2" as const;

export interface SensaSkinPlugin {
  readonly id: string;
  readonly version: string;
  readonly contractVersion: typeof semanticDesignContractVersion;
  readonly nameKey: string;
  readonly descriptionKey: string;
}

export const skinCatalog = [
  {
    id: "quiet",
    version: "1.1.0",
    contractVersion: semanticDesignContractVersion,
    nameKey: "appearance.skins.quiet.name",
    descriptionKey: "appearance.skins.quiet.description",
  },
  {
    id: "clear",
    version: "1.1.0",
    contractVersion: semanticDesignContractVersion,
    nameKey: "appearance.skins.clear.name",
    descriptionKey: "appearance.skins.clear.description",
  },
] as const satisfies readonly SensaSkinPlugin[];

export const colorModeCatalog = ["system", "light", "dark"] as const;
export const textSizeCatalog = ["standard", "large"] as const;

export type SkinId = (typeof skinCatalog)[number]["id"];
export type ColorModePreference = (typeof colorModeCatalog)[number];
export type TextSizePreference = (typeof textSizeCatalog)[number];
export type ResolvedColorMode = Exclude<ColorModePreference, "system">;

export interface AppearancePreference {
  readonly skin: SkinId;
  readonly colorMode: ColorModePreference;
  readonly textSize: TextSizePreference;
}

export interface ResolvedAppearance extends AppearancePreference {
  readonly resolvedColorMode: ResolvedColorMode;
}

export const defaultAppearancePreference: AppearancePreference = {
  skin: "quiet",
  colorMode: "system",
  textSize: "standard",
};

const skinIds = new Set<string>(skinCatalog.map(({ id }) => id));
const colorModes = new Set<string>(colorModeCatalog);
const textSizes = new Set<string>(textSizeCatalog);

/** Parse an untrusted device preference without migrating or touching product data. */
export function parseAppearancePreference(raw: string | null): AppearancePreference {
  if (!raw) return { ...defaultAppearancePreference };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { ...defaultAppearancePreference };
    const candidate = value as Record<string, unknown>;
    return {
      skin:
        typeof candidate.skin === "string" && skinIds.has(candidate.skin)
          ? (candidate.skin as SkinId)
          : defaultAppearancePreference.skin,
      colorMode:
        typeof candidate.colorMode === "string" && colorModes.has(candidate.colorMode)
          ? (candidate.colorMode as ColorModePreference)
          : defaultAppearancePreference.colorMode,
      textSize:
        typeof candidate.textSize === "string" && textSizes.has(candidate.textSize)
          ? (candidate.textSize as TextSizePreference)
          : defaultAppearancePreference.textSize,
    };
  } catch {
    return { ...defaultAppearancePreference };
  }
}

export function serializeAppearancePreference(preference: AppearancePreference): string {
  return JSON.stringify(preference);
}

export function resolveAppearance(
  preference: AppearancePreference,
  systemPrefersDark: boolean,
): ResolvedAppearance {
  return {
    ...preference,
    resolvedColorMode:
      preference.colorMode === "system"
        ? systemPrefersDark
          ? "dark"
          : "light"
        : preference.colorMode,
  };
}

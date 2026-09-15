import { Check, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  colorModeCatalog,
  skinCatalog,
  textSizeCatalog,
  type ColorModePreference,
  type SkinId,
  type TextSizePreference,
} from "./contract";
import { updateAppearancePreference, useAppearancePreference } from "./store";
import { SensaChoice, SensaSurface } from "../ui/SensaComponents";

export function AppearanceSettings() {
  const { t } = useTranslation();
  const preference = useAppearancePreference();
  return (
    <SensaSurface
      as="section"
      variant="raised"
      aria-labelledby="appearance-heading"
      className="sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-control bg-surface-subtle text-action-primary">
          <Palette size={19} />
        </span>
        <div>
          <h3 id="appearance-heading" className="text-base font-medium">{t("appearance.title")}</h3>
          <p className="mt-1 text-xs leading-5 text-fg-secondary">{t("appearance.deviceNote")}</p>
        </div>
      </div>

      <fieldset className="mt-6 border-0 p-0">
        <legend className="text-sm font-medium">{t("appearance.skin")}</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2" role="radiogroup">
          {skinCatalog.map((skin) => {
            const selected = preference.skin === skin.id;
            return (
              <SensaChoice
                key={skin.id}
                role="radio"
                aria-checked={selected}
                selected={selected}
                onClick={() => updateAppearancePreference({ skin: skin.id as SkinId })}
                className="min-h-24 w-full text-left"
              >
                <span className="mb-3 flex items-center gap-2" aria-hidden="true">
                  <span className="sensa-skin-swatch" data-sensa-skin-preview={skin.id}>
                    <i /><i /><i />
                  </span>
                  {selected && <Check className="ml-auto" size={17} />}
                </span>
                <strong className="block font-medium">{t(skin.nameKey)}</strong>
                <span className="mt-1 block text-xs leading-5 text-fg-secondary">{t(skin.descriptionKey)}</span>
              </SensaChoice>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <fieldset className="border-0 p-0">
          <legend className="text-sm font-medium">{t("appearance.colorMode")}</legend>
          <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup">
            {colorModeCatalog.map((mode) => (
              <SensaChoice
                key={mode}
                role="radio"
                aria-checked={preference.colorMode === mode}
                selected={preference.colorMode === mode}
                onClick={() => updateAppearancePreference({ colorMode: mode as ColorModePreference })}
                className="w-full justify-center text-center"
              >
                {t(`appearance.modes.${mode}`)}
              </SensaChoice>
            ))}
          </div>
        </fieldset>
        <fieldset className="border-0 p-0">
          <legend className="text-sm font-medium">{t("appearance.textSize")}</legend>
          <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup">
            {textSizeCatalog.map((size) => (
              <SensaChoice
                key={size}
                role="radio"
                aria-checked={preference.textSize === size}
                selected={preference.textSize === size}
                onClick={() => updateAppearancePreference({ textSize: size as TextSizePreference })}
                className="w-full justify-center text-center"
              >
                {t(`appearance.textSizes.${size}`)}
              </SensaChoice>
            ))}
          </div>
        </fieldset>
      </div>
      <p className="mt-5 text-xs leading-5 text-fg-tertiary">{t("appearance.immediate")}</p>
    </SensaSurface>
  );
}

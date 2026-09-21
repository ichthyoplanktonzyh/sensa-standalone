import { Languages, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import {defaultInterfaceLocale,interfaceLocaleRegistry,interfaceLocales,resolveInterfaceLocale} from './localeRegistry';
import {changeInterfaceLanguage} from './index';

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <label className="relative flex min-h-11 items-center gap-2 rounded-control px-2 text-sm text-fg-secondary hover:bg-surface-selected">
      <Languages size={17} aria-hidden="true" />
      <select
        aria-label={t("language.label")}
        value={resolveInterfaceLocale(i18n.resolvedLanguage ?? defaultInterfaceLocale)}
        onChange={(event) => void changeInterfaceLanguage(event.target.value)}
        className="min-h-11 cursor-pointer appearance-none bg-transparent pr-5 text-xs outline-offset-4 focus-visible:outline-2 focus-visible:outline-focus"
      >
        {interfaceLocales.map(locale=><option key={locale} value={locale}>{interfaceLocaleRegistry[locale].nativeName}</option>)}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2"
        aria-hidden="true"
      />
    </label>
  );
}

import { Languages, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <label className="relative flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-[#626774] hover:bg-black/5">
      <Languages size={17} aria-hidden="true" />
      <select
        aria-label={t("language.label")}
        value={i18n.resolvedLanguage ?? "zh-CN"}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        className="min-h-11 cursor-pointer appearance-none bg-transparent pr-5 text-xs outline-offset-4 focus-visible:outline-2 focus-visible:outline-[#3c51ad]"
      >
        <option value="zh-CN">{t("language.zh")}</option>
        <option value="en">{t("language.en")}</option>
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2"
        aria-hidden="true"
      />
    </label>
  );
}

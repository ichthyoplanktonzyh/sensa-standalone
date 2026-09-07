import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

export type InterfaceLanguage = "zh-CN" | "en";
const LANGUAGE_KEY = "sensa:interface-language:v1";
function initialLanguage(): InterfaceLanguage {
  if (typeof window === "undefined") return "zh-CN";
  try {
    return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}
function applyLanguage(language: string) {
  const resolved = language === "en" ? "en" : "zh-CN";
  if (typeof document !== "undefined") {
    document.documentElement.lang = resolved;
    document.title = i18n.t("brand");
  }
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LANGUAGE_KEY, resolved);
  } catch {
    /* In-session switching still works. */
  }
}
void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: "zh-CN",
  supportedLngs: ["zh-CN", "en"],
  interpolation: { escapeValue: false },
  initAsync: false,
});
i18n.on("languageChanged", applyLanguage);
applyLanguage(i18n.language);
export default i18n;

import i18n from "./index";
import en from './locales/en/content.json';
import './contentResources';

type ContentUiKey=keyof typeof en.contentUi;

/** Shared copy for content detail surfaces and their state labels. */
export function uiText(
  key: ContentUiKey,
  values?: Record<string, unknown>,
): string {
  return i18n.t(`contentUi.${key}`, values);
}

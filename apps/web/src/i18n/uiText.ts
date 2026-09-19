import i18n from "./index";
import {contentUiZh,contentUiEn} from "./contentUi";
import {registerTranslationSections} from './registerResources';

registerTranslationSections({contentUi:contentUiZh},{contentUi:contentUiEn});

/** Shared copy for content detail surfaces and their state labels. */
export function uiText(
  key: keyof typeof contentUiZh,
  values?: Record<string, unknown>,
): string {
  return i18n.t(`contentUi.${key}`, values);
}

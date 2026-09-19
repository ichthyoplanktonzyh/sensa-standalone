import i18n from './index';
import {originalCardsZh,originalCardsEn} from './originalCardCopy';
import {registerTranslationSections} from './registerResources';

registerTranslationSections({originalCards:originalCardsZh},{originalCards:originalCardsEn});
export function cardText(key: keyof typeof originalCardsZh, values?: Record<string, unknown>): string {
  return i18n.t(`originalCards.${key}`, values);
}

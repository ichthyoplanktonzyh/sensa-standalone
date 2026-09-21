import i18n from './index';
import zhCN from './locales/zh-CN/originalCards.json';
import en from './locales/en/originalCards.json';
import ja from './locales/ja/originalCards.json';
import {registerTranslationNamespace} from './registerResources';

registerTranslationNamespace('originalCards',{'zh-CN':zhCN,en,ja});
const originalCardsZh=zhCN.originalCards;
export function cardText(key: keyof typeof originalCardsZh, values?: Record<string, unknown>): string {
  return i18n.t(`originalCards.${key}`, values);
}

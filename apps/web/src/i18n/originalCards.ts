import i18n from './index';
import type { originalCardsZh } from './originalCardCopy';
export function cardText(key: keyof typeof originalCardsZh, values?: Record<string, unknown>): string {
  return i18n.t(`originalCards.${key}`, values);
}

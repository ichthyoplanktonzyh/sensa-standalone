import './contentResources';
import i18n from './index';
import type messages from './locales/zh-CN/content.json';
import {localFlowText} from './localFlowText';

/** Context editing copy loads with the content surface. */
export function contextFlowText(key:keyof typeof messages.contextFlow|Parameters<typeof localFlowText>[0],values?:Record<string,unknown>):string{
 return i18n.exists(`contextFlow.${key}`)?i18n.t(`contextFlow.${key}`,values):localFlowText(key as Parameters<typeof localFlowText>[0],values);
}

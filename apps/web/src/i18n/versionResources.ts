import zhCN from './locales/zh-CN/version.json';
import en from './locales/en/version.json';
import ja from './locales/ja/version.json';
import { registerTranslationNamespace } from './registerResources';

registerTranslationNamespace('version', { 'zh-CN': zhCN, en, ja });

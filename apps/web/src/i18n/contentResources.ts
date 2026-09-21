import zhCN from './locales/zh-CN/content.json';
import en from './locales/en/content.json';
import ja from './locales/ja/content.json';
import {registerTranslationNamespace} from './registerResources';

registerTranslationNamespace('content',{'zh-CN':zhCN,en,ja});

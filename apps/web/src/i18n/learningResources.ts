import zhCN from './locales/zh-CN/learning.json';
import en from './locales/en/learning.json';
import ja from './locales/ja/learning.json';
import {registerTranslationNamespace} from './registerResources';

registerTranslationNamespace('learning',{'zh-CN':zhCN,en,ja});

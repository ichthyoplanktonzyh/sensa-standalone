import zhCN from './locales/zh-CN/reference.json';
import en from './locales/en/reference.json';
import ja from './locales/ja/reference.json';
import {registerTranslationNamespace} from './registerResources';

registerTranslationNamespace('reference',{'zh-CN':zhCN,en,ja});

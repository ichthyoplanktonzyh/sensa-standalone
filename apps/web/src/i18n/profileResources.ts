import zhCN from './locales/zh-CN/profile.json';
import en from './locales/en/profile.json';
import ja from './locales/ja/profile.json';
import {registerTranslationNamespace} from './registerResources';

registerTranslationNamespace('profile',{'zh-CN':zhCN,en,ja});

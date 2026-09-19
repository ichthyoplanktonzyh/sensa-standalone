import {accountZh,accountEn} from './account';
import {cloudSyncZh,cloudSyncEn} from './cloudSync';
import {registerTranslationSections} from './registerResources';

registerTranslationSections(
 {account:accountZh,cloudSync:cloudSyncZh},
 {account:accountEn,cloudSync:cloudSyncEn},
);

import {appearanceZh,appearanceEn} from './appearance';
import {glossaryZh,glossaryEn} from './glossary';
import {languagesZh,languagesEn} from './languages';
import {libraryBackupZh,libraryBackupEn,modelServiceZh,modelServiceEn} from './localLibrary';
import {registerTranslationSections} from './registerResources';

registerTranslationSections(
 {appearance:appearanceZh,glossary:glossaryZh,languages:languagesZh,libraryBackup:libraryBackupZh,modelService:modelServiceZh},
 {appearance:appearanceEn,glossary:glossaryEn,languages:languagesEn,libraryBackup:libraryBackupEn,modelService:modelServiceEn},
);

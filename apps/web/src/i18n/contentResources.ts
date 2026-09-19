import {contentZh,contentEn,composerZh,composerEn} from './content';
import {contentUiZh,contentUiEn} from './contentUi';
import {registerTranslationSections} from './registerResources';

registerTranslationSections(
 {content:contentZh,composer:composerZh,contentUi:contentUiZh},
 {content:contentEn,composer:composerEn,contentUi:contentUiEn},
);

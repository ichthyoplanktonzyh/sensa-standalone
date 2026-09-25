import {stableUuid} from '@sensa/learning-kernel';

import {portableBookDeliveryFixture} from './portablePackageFixture.mts';

/** Synthetic `.sensa` for cloud-sync tests; no generated files or provider calls. */
export const libraryCloudPackageFixture=async()=>portableBookDeliveryFixture({
  packageId:stableUuid('sensa:cloud-sync-portable-fixture'),
  expression:'borrow',
  meaning:'临时取得他人的物品，并预期归还。',
  scene:'下雨了，你向同事借了一把伞，并约好第二天归还。',
  title:'Borrow · cloud sync fixture',
});

import type {LearningPackageBundle,LearningPackageDescriptor} from '@sensa/contracts/sensa';
import {readLibrary} from './store';

export type InstalledPackage={key:string;digest:string;bundle:LearningPackageBundle;installedAt:string};

export const packageKey=(value:LearningPackageBundle|LearningPackageDescriptor)=>{
 const current='book' in value;
 const bookVersionId=current?value.book.bookVersionId:null;
 if(bookVersionId&&'targetLanguage' in value&&'supportLanguage' in value)return JSON.stringify(['book-version',bookVersionId,value.targetLanguage,value.supportLanguage]);
 return JSON.stringify([
  current?value.book.bookId:value.id,
  current?String(value.book.versionNumber):value.version,
 ]);
};

export const installedPackages=()=>readLibrary(tx=>tx.all<InstalledPackage>('packages'));

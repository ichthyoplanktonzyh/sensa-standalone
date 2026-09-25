import {
 learningBundleBookId,
 learningBundleVersionLabel,
 learningPackageDescriptorSchema,
 sensaLanguageTagSchema,
 type LearningPackageBundle,
 type LearningPackageDescriptor,
 type SensaPortableLightweightPackage,
} from '@sensa/contracts/sensa';
import {z} from 'zod';
import {readLibrary} from './store';

/** Public exchange metadata retained with a locally installed `.sensa` artifact.
 * Media bytes remain in the compiled Runtime content and are reconstructed on export. */
export type PortablePackageOrigin={
 format:'sensa-portable-installation-origin-v2';
 manifest:SensaPortableLightweightPackage;
 packageDigest:string;
 archiveDigest:string;
 validatorVersion:string;
};
export type InstalledPackage={key:string;digest:string;bundle:LearningPackageBundle;installedAt:string;portableOrigin?:PortablePackageOrigin};

const digestSchema=z.string().regex(/^[a-f0-9]{64}$/u);
const artifactBase={
 digest:digestSchema,
 byteLength:z.number().int().positive().max(64*1024*1024),
 targetLanguage:sensaLanguageTagSchema,
 supportLanguage:sensaLanguageTagSchema,
};
export const packageInstallationSchema=z.object({
 format:z.literal('sensa-package-installation-v1'),
 key:z.string().min(1).max(2000),
 artifact:z.discriminatedUnion('kind',[
  z.object({...artifactBase,kind:z.literal('book_release'),bookId:z.string().uuid(),bookVersionId:z.string().uuid(),versionNumber:z.number().int().positive()}).strict(),
  z.object({...artifactBase,kind:z.literal('legacy_package'),packageId:z.string().uuid(),version:z.string().trim().min(1).max(500)}).strict(),
 ]),
}).strict().superRefine((value,context)=>{
 const expected=value.artifact.kind==='book_release'
  ?JSON.stringify(['book-version',value.artifact.bookVersionId,value.artifact.targetLanguage,value.artifact.supportLanguage])
  :JSON.stringify([value.artifact.packageId,value.artifact.version]);
 if(value.key!==expected)context.addIssue({code:'custom',message:'Package installation key does not match artifact identity'});
});
export type PackageInstallation=z.infer<typeof packageInstallationSchema>;

export const packageKey=(value:LearningPackageBundle|LearningPackageDescriptor)=>{
 const current='book' in value;
 const bookVersionId=current?value.book.bookVersionId:null;
 if(bookVersionId&&'targetLanguage' in value&&'supportLanguage' in value)return JSON.stringify(['book-version',bookVersionId,value.targetLanguage,value.supportLanguage]);
 return JSON.stringify([
  current?value.book.bookId:value.id,
  current?String(value.book.versionNumber):value.version,
 ]);
};

export const packageInstallationFor=(bundle:LearningPackageBundle,digest:string,byteLength:number):PackageInstallation=>packageInstallationSchema.parse({
 format:'sensa-package-installation-v1',
 key:packageKey(bundle),
 artifact:bundle.format==='sensa-book-release-bundle-v1'
  ?{kind:'book_release',bookId:bundle.book.bookId,bookVersionId:bundle.book.bookVersionId,versionNumber:bundle.book.versionNumber,targetLanguage:bundle.targetLanguage,supportLanguage:bundle.supportLanguage,digest,byteLength}
  :{kind:'legacy_package',packageId:learningBundleBookId(bundle),version:learningBundleVersionLabel(bundle),targetLanguage:bundle.targetLanguage,supportLanguage:bundle.supportLanguage,digest,byteLength},
});

export const descriptorMatchesInstallation=(raw:LearningPackageDescriptor,installation:PackageInstallation):boolean=>{
 const parsed=learningPackageDescriptorSchema.safeParse(raw);
 if(!parsed.success)return false;
 const descriptor=parsed.data;
 return packageKey(descriptor)===installation.key
  &&descriptor.sha256===installation.artifact.digest
  &&descriptor.byteLength===installation.artifact.byteLength
  &&(installation.artifact.kind==='book_release'
   ?'format' in descriptor&&descriptor.book.bookId===installation.artifact.bookId&&descriptor.book.bookVersionId===installation.artifact.bookVersionId&&descriptor.book.versionNumber===installation.artifact.versionNumber
   :!('format' in descriptor)&&descriptor.id===installation.artifact.packageId&&descriptor.version===installation.artifact.version)
  &&('targetLanguage' in descriptor?descriptor.targetLanguage===installation.artifact.targetLanguage:true)
  &&('supportLanguage' in descriptor?descriptor.supportLanguage===installation.artifact.supportLanguage:true);
};

export const installedPackages=()=>readLibrary(tx=>tx.all<InstalledPackage>('packageCache'));
export const packageInstallations=()=>readLibrary(tx=>tx.all<PackageInstallation>('packageInstallations'));

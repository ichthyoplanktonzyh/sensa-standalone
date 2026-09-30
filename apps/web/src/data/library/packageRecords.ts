import {
 canonicalConsumerJson,
 sensaLanguageTagSchema,
 type InstalledLearningContent,
 type SensaPortableBookManifest,
 type SensaPortableLightweightPackage,
 type SensaPortableBookMember,
} from '@sensa/contracts/sensa';
import {z} from 'zod';
import {readLibrary} from './store';

/** Public exchange metadata retained with a locally installed `.sensa` artifact.
 * Callers see complete Runtime data URLs; SQLite transparently deduplicates the
 * underlying media bytes, and export reconstructs the same public artifact. */
export type PortablePublicationAttestation={
 format:'sensa-portable-publication-attestation-v2';
 publisher:SensaPortableBookManifest['publisher'];
 book:SensaPortableBookManifest['book'];
 contentRelease:SensaPortableBookManifest['contentRelease'];
 route:SensaPortableBookManifest['route'];
 publishedAt:string;
 changeSummary:string;
 bookArchiveSha256:string;
 memberCount:number;
 member:SensaPortableBookMember;
};
export type PortablePackageOrigin={
 format:'sensa-portable-installation-origin-v2';
 manifest:SensaPortableLightweightPackage;
 packageDigest:string;
 archiveDigest:string;
 validatorVersion:string;
 publications:readonly PortablePublicationAttestation[];
};
export type InstalledPackage={
 key:string;
 digest:string;
 content:InstalledLearningContent;
 installedAt:string;
 portableOrigin:PortablePackageOrigin;
};

type InstalledEntry=InstalledPackage['content']['entries'][number];
export type InstalledPackageSummary=Readonly<{
 key:string;
 digest:string;
 installedAt:string;
 hasAssurance:boolean;
 content:Readonly<{
  targetLanguage:InstalledPackage['content']['targetLanguage'];
  supportLanguage:InstalledPackage['content']['supportLanguage'];
  entries:readonly Pick<InstalledEntry,'senseId'|'senseVersionId'|'bindingId'|'bindingVersionId'|'expression'|'meaning'|'semantic'>[];
 }>;
 portableOrigin:Readonly<{
  manifest:Readonly<{metadata:InstalledPackage['portableOrigin']['manifest']['metadata']}>;
  publications:InstalledPackage['portableOrigin']['publications'];
 }>;
}>;

/** Inventory projection deliberately excludes Runtime resources and media. */
export const installedPackageSummary=(value:InstalledPackage):InstalledPackageSummary=>({
 key:value.key,
 digest:value.digest,
 installedAt:value.installedAt,
 hasAssurance:!!value.content.assurance,
 content:{
  targetLanguage:value.content.targetLanguage,
  supportLanguage:value.content.supportLanguage,
  entries:value.content.entries.map(entry=>({
   senseId:entry.senseId,
   senseVersionId:entry.senseVersionId,
   bindingId:entry.bindingId,
   bindingVersionId:entry.bindingVersionId,
   expression:entry.expression,
   meaning:entry.meaning,
   semantic:entry.semantic?structuredClone(entry.semantic):undefined,
  })),
 },
 portableOrigin:{
  manifest:{metadata:structuredClone(value.portableOrigin.manifest.metadata)},
  publications:structuredClone(value.portableOrigin.publications),
 },
});

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
 artifact:z.object({
  ...artifactBase,
  kind:z.literal('portable_package'),
  packageId:z.string().uuid(),
  version:z.number().int().positive(),
  packageDigest:digestSchema,
  bookArchiveSha256:digestSchema.optional(),
 }).strict(),
}).strict().superRefine((value,context)=>{
 const expected=JSON.stringify([value.artifact.packageId,String(value.artifact.version)]);
 if(value.key!==expected)context.addIssue({code:'custom',message:'Package installation key does not match artifact identity'});
});
export type PackageInstallation=z.infer<typeof packageInstallationSchema>;

const installationCore=(value:PackageInstallation)=>{
 const {bookArchiveSha256:discarded,...artifact}=value.artifact;
 void discarded;
 return {...value,artifact};
};

export const samePackageInstallationArtifact=(
 left:PackageInstallation,
 right:PackageInstallation,
):boolean=>canonicalConsumerJson(installationCore(left))===canonicalConsumerJson(installationCore(right));

/** Keep an existing recovery source, or enrich an exact local fact with its first public Book. */
export const mergePackageInstallationRecovery=(
 current:PackageInstallation|undefined,
 requested:PackageInstallation,
):PackageInstallation|null=>{
 if(!current)return requested;
 if(!samePackageInstallationArtifact(current,requested))return null;
 const bookArchiveSha256=current.artifact.bookArchiveSha256??requested.artifact.bookArchiveSha256;
 return packageInstallationSchema.parse({
  ...requested,
  artifact:{
   ...requested.artifact,
   ...(bookArchiveSha256?{bookArchiveSha256}:{}),
  },
 });
};

export const portablePackageKey=(packageId:string,version:number)=>JSON.stringify([
 packageId,
 String(version),
]);

export const portablePackageInstallationFor=(
 manifest:SensaPortableLightweightPackage,
 archiveDigest:string,
 packageDigest:string,
 byteLength:number,
 bookArchiveSha256?:string,
):PackageInstallation=>packageInstallationSchema.parse({
 format:'sensa-package-installation-v1',
 key:portablePackageKey(manifest.metadata.packageId,manifest.metadata.version),
 artifact:{
  kind:'portable_package',
  packageId:manifest.metadata.packageId,
  version:manifest.metadata.version,
  packageDigest,
  ...(bookArchiveSha256?{bookArchiveSha256}:{}),
  targetLanguage:manifest.route.targetLanguage,
  supportLanguage:manifest.route.supportLanguage,
  digest:archiveDigest,
  byteLength,
 },
});

export const installedPackages=()=>readLibrary(tx=>tx.all<InstalledPackage>('packageCache'));
export const packageInstallations=()=>readLibrary(tx=>tx.all<PackageInstallation>('packageInstallations'));

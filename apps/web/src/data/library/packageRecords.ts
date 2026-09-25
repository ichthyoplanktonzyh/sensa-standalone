import {
 sensaLanguageTagSchema,
 type InstalledLearningContent,
 type SensaBookVersionManifest,
 type SensaPortableLightweightPackage,
 type SensaPublishedPortableArtifact,
} from '@sensa/contracts/sensa';
import {z} from 'zod';
import {readLibrary} from './store';

/** Public exchange metadata retained with a locally installed `.sensa` artifact.
 * Media bytes remain in the compiled Runtime content and are reconstructed on export. */
export type PortablePublicationAttestation={
 format:'sensa-portable-publication-attestation-v1';
 publisher:SensaBookVersionManifest['publisher'];
 book:SensaBookVersionManifest['book'];
 contentRelease:SensaBookVersionManifest['contentRelease'];
 route:SensaBookVersionManifest['route'];
 publishedAt:string;
 changeSummary:string;
 manifestSha256:string;
 memberCount:number;
 member:SensaPublishedPortableArtifact;
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
 }).strict(),
}).strict().superRefine((value,context)=>{
 const expected=JSON.stringify([value.artifact.packageId,String(value.artifact.version)]);
 if(value.key!==expected)context.addIssue({code:'custom',message:'Package installation key does not match artifact identity'});
});
export type PackageInstallation=z.infer<typeof packageInstallationSchema>;

export const portablePackageKey=(packageId:string,version:number)=>JSON.stringify([
 packageId,
 String(version),
]);

export const portablePackageInstallationFor=(
 manifest:SensaPortableLightweightPackage,
 archiveDigest:string,
 packageDigest:string,
 byteLength:number,
):PackageInstallation=>packageInstallationSchema.parse({
 format:'sensa-package-installation-v1',
 key:portablePackageKey(manifest.metadata.packageId,manifest.metadata.version),
 artifact:{
  kind:'portable_package',
  packageId:manifest.metadata.packageId,
  version:manifest.metadata.version,
  packageDigest,
  targetLanguage:manifest.route.targetLanguage,
  supportLanguage:manifest.route.supportLanguage,
  digest:archiveDigest,
  byteLength,
 },
});

export const installedPackages=()=>readLibrary(tx=>tx.all<InstalledPackage>('packageCache'));
export const packageInstallations=()=>readLibrary(tx=>tx.all<PackageInstallation>('packageInstallations'));

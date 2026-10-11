import {
 canonicalConsumerJson,
 maxPortableBookMembers,
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
 /** Exact zero-based position in the validated Book Manifest, not key order. */
 memberIndex?:number;
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
  entries:readonly Pick<InstalledEntry,'senseId'|'senseVersionId'|'expressionId'|'expressionVersionId'|'bindingId'|'bindingVersionId'|'expression'|'meaning'|'semantic'|'assurancePackageKey'>[];
 }>;
 portableOrigin:Readonly<{
  manifest:Readonly<{metadata:InstalledPackage['portableOrigin']['manifest']['metadata']}>;
  publications:InstalledPackage['portableOrigin']['publications'];
 }>;
}>;

const digestSchema=z.string().regex(/^[a-f0-9]{64}$/u);
export const bookMembershipSchema=z.object({
 archiveSha256:digestSchema,
 bookId:z.string().uuid(),
 bookVersionId:z.string().uuid(),
 memberIndex:z.number().int().nonnegative(),
 memberCount:z.number().int().positive().max(maxPortableBookMembers),
}).strict().refine(value=>value.memberIndex<value.memberCount,{message:'Book member position is outside its Manifest'});
export type PackageBookMembership=z.infer<typeof bookMembershipSchema>;
export const publicationBookMembership=(publication:PortablePublicationAttestation):PackageBookMembership|undefined=>publication.memberIndex===undefined?undefined:bookMembershipSchema.parse({
 archiveSha256:publication.bookArchiveSha256,bookId:publication.book.bookId,bookVersionId:publication.book.bookVersionId,memberIndex:publication.memberIndex,memberCount:publication.memberCount,
});
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
  bookMemberships:z.array(bookMembershipSchema).optional(),
 }).strict(),
}).strict().superRefine((value,context)=>{
 const expected=JSON.stringify([value.artifact.packageId,String(value.artifact.version)]);
 if(value.key!==expected)context.addIssue({code:'custom',message:'Package installation key does not match artifact identity'});
 const memberships=value.artifact.bookMemberships??[];
 if(new Set(memberships.map(member=>member.archiveSha256)).size!==memberships.length)context.addIssue({code:'custom',message:'Duplicate Book publication membership'});
 if(memberships.some((member,index)=>index>0&&memberships[index-1]!.archiveSha256.localeCompare(member.archiveSha256)>=0))context.addIssue({code:'custom',message:'Book publication memberships must have canonical order'});
});
export type PackageInstallation=z.infer<typeof packageInstallationSchema>;

/** A complete, exact Book selection, reconstructed from durable provenance.
 * Missing positions are unavailable; UUID ordering is never a substitute. */
export function orderedBookPackageKeys(installations:readonly PackageInstallation[],archiveSha256:string):string[]{
 digestSchema.parse(archiveSha256);
 const members=installations.flatMap(installation=>{
  const value=packageInstallationSchema.parse(installation),member=value.artifact.bookMemberships?.find(candidate=>candidate.archiveSha256===archiveSha256);
  return member?[{key:value.key,...member}]:[];
 });
 const first=members[0];
 if(!first||members.length!==first.memberCount||members.some(member=>member.bookId!==first.bookId||member.bookVersionId!==first.bookVersionId||member.memberCount!==first.memberCount)||new Set(members.map(member=>member.memberIndex)).size!==members.length)throw new Error('localFlow.catalogMismatch');
 return members.sort((a,b)=>a.memberIndex-b.memberIndex).map(member=>member.key);
}

const installationCore=(value:PackageInstallation)=>{
 const {bookArchiveSha256:discarded,bookMemberships:discardedMemberships,...artifact}=value.artifact;
 void discarded;void discardedMemberships;
 return {...value,artifact};
};

export const samePackageInstallationArtifact=(
 left:PackageInstallation,
 right:PackageInstallation,
):boolean=>canonicalConsumerJson(installationCore(left))===canonicalConsumerJson(installationCore(right));

/** Enrich exact local facts with admitted Book positions without changing prior sources. */
export const mergePackageInstallationRecovery=(
 current:PackageInstallation|undefined,
 requested:PackageInstallation,
):PackageInstallation|null=>{
 if(!current)return requested;
 if(!samePackageInstallationArtifact(current,requested))return null;
 const memberships=new Map((current.artifact.bookMemberships??[]).map(member=>[member.archiveSha256,member]));
 for(const member of requested.artifact.bookMemberships??[]){
  const previous=memberships.get(member.archiveSha256);
  if(previous&&canonicalConsumerJson(previous)!==canonicalConsumerJson(member))return null;
  memberships.set(member.archiveSha256,member);
 }
 const bookMemberships=[...memberships.values()].sort((a,b)=>a.archiveSha256.localeCompare(b.archiveSha256));
 const bookArchiveSha256=current.artifact.bookArchiveSha256??requested.artifact.bookArchiveSha256;
 return packageInstallationSchema.parse({
  ...requested,
  artifact:{
   ...requested.artifact,
   ...(bookArchiveSha256?{bookArchiveSha256}:{}),
   ...(bookMemberships.length?{bookMemberships}:{}),
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
 bookMembership?:PackageBookMembership,
):PackageInstallation=>packageInstallationSchema.parse({
 format:'sensa-package-installation-v1',
 key:portablePackageKey(manifest.metadata.packageId,manifest.metadata.version),
 artifact:{
  kind:'portable_package',
  packageId:manifest.metadata.packageId,
  version:manifest.metadata.version,
  packageDigest,
  ...(bookArchiveSha256?{bookArchiveSha256}:{}),
  ...(bookMembership?{bookMemberships:[bookMembership]}:{}),
  targetLanguage:manifest.route.targetLanguage,
  supportLanguage:manifest.route.supportLanguage,
  digest:archiveDigest,
  byteLength,
 },
});

export const installedPackages=()=>readLibrary(tx=>tx.all<InstalledPackage>('packageCache'));
export const packageInstallations=()=>readLibrary(tx=>tx.all<PackageInstallation>('packageInstallations'));

import type {InstalledPackage,InstalledPackageSummary} from './packageRecords';

/** Derived, device-local reads. The admitted packageCache record remains authoritative. */
export type PackageCacheIdentity=Readonly<{key:string;digest:string}>;
export type PackageRouteCount=Readonly<{targetLanguage:string;supportLanguage:string;packageCount:number}>;

export type PackageCacheProjectionQuery=
 |Readonly<{kind:'identities'}>
 |Readonly<{kind:'route_counts'}>
 |Readonly<{kind:'summaries'}>;

export type PackageCacheProjectionResult<Query extends PackageCacheProjectionQuery>=
 Query['kind'] extends 'identities'?PackageCacheIdentity[]:
 Query['kind'] extends 'route_counts'?PackageRouteCount[]:InstalledPackageSummary[];

/** Generic record fixtures/corrupt cache rows must never become installed evidence. */
export const isPackageCacheProjectionSource=(value:unknown):value is InstalledPackage=>{
 if(!value||typeof value!=='object')return false;
 const candidate=value as Partial<InstalledPackage>;
 return typeof candidate.key==='string'&&typeof candidate.digest==='string'
  &&typeof candidate.installedAt==='string'&&Array.isArray(candidate.content?.entries)
  &&!!candidate.portableOrigin?.manifest?.metadata
  &&Array.isArray(candidate.portableOrigin.publications);
};

export const createPackageCacheSummary=(value:InstalledPackage):InstalledPackageSummary=>({
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
   ...(entry.assurancePackageKey!==undefined?{assurancePackageKey:entry.assurancePackageKey}:{}),
   ...(entry.semantic?{semantic:entry.semantic}:{}),
  })),
 },
 portableOrigin:{
  manifest:{metadata:value.portableOrigin.manifest.metadata},
  publications:value.portableOrigin.publications,
 },
});

export const sqlitePackageCacheProjectionSchema=`
CREATE TABLE IF NOT EXISTS sensa_package_cache_projection(
 package_key TEXT NOT NULL PRIMARY KEY,
 digest TEXT NOT NULL,
 summary_json TEXT NOT NULL CHECK(json_valid(summary_json))
);
CREATE INDEX IF NOT EXISTS sensa_package_cache_identity
 ON sensa_package_cache_projection(package_key,digest);
CREATE INDEX IF NOT EXISTS sensa_package_cache_routes
 ON sensa_package_cache_projection(json_extract(summary_json,'$.content.targetLanguage'),json_extract(summary_json,'$.content.supportLanguage'));
`;

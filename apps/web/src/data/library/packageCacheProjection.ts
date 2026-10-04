import type {InstalledPackage,InstalledPackageSummary} from './packageRecords';

/** Derived, device-local reads. The admitted packageCache record remains authoritative. */
export type PackageCacheIdentity=Readonly<{key:string;digest:string}>;
export type PackageRouteCount=Readonly<{targetLanguage:string;supportLanguage:string;packageCount:number}>;

export type PackageCacheProjectionQuery=
 |Readonly<{kind:'learning_choices';languageTag:string;normalizedPrefix:string;offset:number;limit:number}>
 |Readonly<{kind:'identities'}>
 |Readonly<{kind:'route_counts'}>
 |Readonly<{kind:'summaries';packageId?:string}>;

/** All versions of one package share this prefix in the primary-key index. */
export const packageCacheKeyPrefix=(packageId:string)=>`${JSON.stringify([packageId]).slice(0,-1)},`;

export const learningExpressionForm=(text:unknown,language:unknown):string|null=>{
 if(typeof text!=='string'||typeof language!=='string')return null;
 try{return text.trim().toLocaleLowerCase(language);}catch{return null;}
};
export function validateLearningPackageQuery(query:Extract<PackageCacheProjectionQuery,{kind:'learning_choices'}>):void{
 if(typeof query.languageTag!=='string'||typeof query.normalizedPrefix!=='string'||query.normalizedPrefix.length>500||!Number.isSafeInteger(query.offset)||query.offset<0||!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>41)throw new Error('direct_learning_query_invalid');
}
export const learningPackageChoicesSql=`SELECT summary_json FROM sensa_package_cache_projection
 WHERE json_extract(summary_json,'$.content.targetLanguage')=?
 AND sensa_expression_form(json_extract(summary_json,'$.content.entries[0].expression'),json_extract(summary_json,'$.content.targetLanguage'))>=?
 AND sensa_expression_form(json_extract(summary_json,'$.content.entries[0].expression'),json_extract(summary_json,'$.content.targetLanguage'))<?
 AND json_array_length(summary_json,'$.portableOrigin.publications')>0
 AND json_extract(summary_json,'$.content.entries[0].semantic.relation')='realizes' AND json_extract(summary_json,'$.content.entries[0].semantic.semanticCoverage')='exact'
 ORDER BY sensa_expression_form(json_extract(summary_json,'$.content.entries[0].expression'),json_extract(summary_json,'$.content.targetLanguage')),package_key LIMIT ? OFFSET ?`;

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
CREATE INDEX IF NOT EXISTS sensa_package_learning_expression
 ON sensa_package_cache_projection(json_extract(summary_json,'$.content.targetLanguage'),sensa_expression_form(json_extract(summary_json,'$.content.entries[0].expression'),json_extract(summary_json,'$.content.targetLanguage')),package_key);
`;

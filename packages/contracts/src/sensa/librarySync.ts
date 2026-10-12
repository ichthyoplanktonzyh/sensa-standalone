import {z} from 'zod';
/** Durable Personal Library Facts carried by a Cloud Checkpoint. `operations` is
 * deliberately absent: it is a device-local command ledger, not learner data. */
export const librarySyncTables=['meta','drafts','settings','sessions','meanings','identities','packageInstallations','curriculumEnrollments','supplementalMembershipStates','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations','personalLearning','contentAttempts','annotations','semanticState','semanticMeanings','semanticContexts','semanticRegistry','semanticInbox','semanticDrafts','semanticReceipts','media'] as const;
export const librarySyncHash=z.string().regex(/^[a-f0-9]{64}$/);
/** Content-addressed block size in JavaScript string units. Restoring a library is
 * a bounded number of block requests, so one block already carries a real payload.
 * Sized against one captured context image. */
export const librarySyncBlockChars=262144;
/** Hashes one fetch request may ask for; the response is bounded by bytes, not by this. */
export const librarySyncBlockFetchHashes=512;
/** UTF-8 payload bytes one fetch response may carry, so paging follows bytes instead of block count. */
export const librarySyncBlockFetchBytes=4*1024*1024;
/** Blocks per store request. Bounds one request body below the route limit. */
export const librarySyncBlockStoreBatch=128;
/** Total block characters accepted in one store request. */
export const librarySyncBlockStoreChars=3*1024*1024;
/** UTF-8 JSON framing included; characters alone cannot bound an HTTP body. */
export const librarySyncBlockStoreBytes=3*1024*1024;
export const librarySyncBlock=z.object({hash:librarySyncHash,data:z.string().max(librarySyncBlockChars)}).strict();
export const librarySyncBlockFetch=z.object({hashes:z.array(librarySyncHash).min(1).max(librarySyncBlockFetchHashes)}).strict();
export const librarySyncBlockFetchResult=z.object({blocks:z.array(librarySyncBlock).max(librarySyncBlockFetchHashes),missing:z.array(librarySyncHash).max(librarySyncBlockFetchHashes),deferred:z.array(librarySyncHash).max(librarySyncBlockFetchHashes).default([])}).strict();
export const librarySyncBlockMissing=z.object({hashes:z.array(librarySyncHash).min(1).max(512)}).strict();
export const librarySyncBlockMissingResult=z.object({missing:z.array(librarySyncHash).max(512)}).strict();
export const librarySyncBlockStore=z.object({blocks:z.array(librarySyncBlock).min(1).max(librarySyncBlockStoreBatch)}).strict();
export const librarySyncRefs=z.array(librarySyncHash).min(1).max(2048);
export const librarySyncRow=z.object({table:z.enum(librarySyncTables),key:z.string().min(1).max(2000),blocks:librarySyncRefs}).strict();
const refineManifest=(v:{rows:readonly {table:string;key:string}[]},c:z.RefinementCtx)=>{
 const ids=new Set<string>();for(const row of v.rows){const id=JSON.stringify([row.table,row.key]);if(ids.has(id))c.addIssue({code:'custom',message:'duplicate row'});ids.add(id);if(row.table==='meta'&&!['identity','learning-active','learning-session-active','package-catalog'].includes(row.key))c.addIssue({code:'custom',message:'private metadata'});}
};
export const librarySyncManifest=z.object({version:z.literal(8),libraryId:z.string().uuid(),learnerId:z.string().uuid(),rows:z.array(librarySyncRow).max(200000)}).strict().superRefine(refineManifest);
export const librarySyncStorage=z.object({usedBytes:z.number().int().nonnegative(),capacityBytes:z.number().int().positive()}).strict();
const cursor=z.number().int().nonnegative().max(2147483646);
/** One account-scoped publication cursor. The descriptor names the immutable
 * index snapshot, never a competing complete-manifest head. */
export const librarySyncSnapshot=z.object({libraryId:z.string().uuid(),learnerId:z.string().uuid(),snapshotRevision:cursor,floor:cursor,records:z.number().int().min(1).max(200000)}).strict();
export const librarySyncHead=z.object({revision:cursor,manifest:librarySyncSnapshot.nullable(),readLease:z.string().uuid().optional(),receipt:z.object({operationId:z.string().uuid(),requestDigest:librarySyncHash}).strict().optional(),storage:librarySyncStorage.optional()}).strict().refine(head=>!head.manifest||head.manifest.floor<=head.manifest.snapshotRevision&&head.manifest.snapshotRevision<=head.revision,{message:'invalid snapshot cursor'});
const operation={operationId:z.string().uuid(),baseRevision:cursor};
/** Full manifest is only the first publication input. Subsequent publications
 * carry content-addressed changes, so retry bodies remain compact and exact. */
export const librarySyncCommit=z.union([z.object({...operation,manifest:librarySyncRefs}).strict(),z.object({...operation,patch:librarySyncRefs}).strict(),z.object({...operation,staging:z.object({pages:z.number().int().min(1).max(200000),records:z.number().int().min(1).max(200000),digest:librarySyncHash}).strict()}).strict()]);
/** Private initial-upload workspace. Its source fence is never a writer trust stamp. */
export const librarySyncStageBegin=z.object({...operation,libraryId:z.string().uuid(),learnerId:z.string().uuid(),incarnation:z.string().min(1).max(128),localRevision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
export const librarySyncStagePage=z.object({operationId:z.string().uuid(),page:z.number().int().nonnegative().max(199999),rows:z.array(librarySyncRow).min(1).max(512)}).strict().superRefine(refineManifest);
export const librarySyncChange=z.object({table:z.enum(librarySyncTables),key:z.string().min(1).max(2000),blocks:librarySyncRefs.nullable()}).strict();
export const librarySyncPatch=z.object({version:z.literal(1),libraryId:z.string().uuid(),learnerId:z.string().uuid(),changes:z.array(librarySyncChange).min(1).max(4096)}).strict().superRefine((v,c)=>refineManifest({rows:v.changes},c));
export const librarySyncMetadataPageBytes=4*1024*1024;
export const librarySyncMetadataPageRows=512;
export const librarySyncMetadataPageRefs=4096;
export const librarySyncPosition=z.object({revision:cursor,offset:z.number().int().nonnegative().max(200000)}).strict();
export const librarySyncPull=z.object({after:librarySyncPosition,toRevision:cursor,readLease:z.string().uuid().optional()}).strict();
export const librarySyncPullResult=z.object({from:librarySyncPosition,next:librarySyncPosition,toRevision:cursor,changes:z.array(librarySyncChange).max(librarySyncMetadataPageRows),done:z.boolean()}).strict();
export const librarySyncSnapshotPage=z.object({snapshotRevision:cursor,after:z.object({table:z.enum(librarySyncTables),key:z.string().min(1).max(2000)}).strict().nullable(),readLease:z.string().uuid().optional()}).strict();
export const librarySyncSnapshotPageResult=z.object({snapshotRevision:cursor,after:z.object({table:z.enum(librarySyncTables),key:z.string().min(1).max(2000)}).strict().nullable(),next:z.object({table:z.enum(librarySyncTables),key:z.string().min(1).max(2000)}).strict().nullable(),rows:z.array(librarySyncRow).max(librarySyncMetadataPageRows),done:z.boolean()}).strict();
export type LibrarySyncCommit=z.infer<typeof librarySyncCommit>;
export type LibrarySyncChange=z.infer<typeof librarySyncChange>;
export type LibrarySyncPullResult=z.infer<typeof librarySyncPullResult>;
export type LibrarySyncSnapshotPageResult=z.infer<typeof librarySyncSnapshotPageResult>;
export type LibrarySyncManifest=z.infer<typeof librarySyncManifest>;
export type LibrarySyncHead=z.infer<typeof librarySyncHead>;

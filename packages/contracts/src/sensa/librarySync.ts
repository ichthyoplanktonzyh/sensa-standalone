import {z} from 'zod';
/** Durable Personal Library Facts carried by a Cloud Checkpoint. `operations` is
 * deliberately absent: it is a device-local command ledger, not learner data. */
export const librarySyncTables=['meta','drafts','settings','sessions','meanings','identities','packageInstallations','curriculumEnrollments','supplementalMembershipStates','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations','personalLearning','contentAttempts','annotations','semanticState','semanticMeanings','semanticRegistry','semanticInbox','semanticDrafts','semanticReceipts','media'] as const;
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
export const librarySyncBlockStoreBatch=16;
/** Total block characters accepted in one store request. */
export const librarySyncBlockStoreChars=3*1024*1024;
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
export const librarySyncManifest=z.object({version:z.literal(6),libraryId:z.string().uuid(),learnerId:z.string().uuid(),rows:z.array(librarySyncRow).max(200000)}).strict().superRefine(refineManifest);
export const librarySyncStorage=z.object({usedBytes:z.number().int().nonnegative(),capacityBytes:z.number().int().positive()}).strict();
export const librarySyncHead=z.object({revision:z.number().int().nonnegative(),manifest:librarySyncRefs.nullable(),storage:librarySyncStorage.optional()}).strict();
export const librarySyncCommit=z.object({operationId:z.string().uuid(),baseRevision:z.number().int().nonnegative(),manifest:librarySyncRefs}).strict();
export type LibrarySyncManifest=z.infer<typeof librarySyncManifest>;
export type LibrarySyncHead=z.infer<typeof librarySyncHead>;

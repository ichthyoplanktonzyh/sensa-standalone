import {z} from 'zod';
export const librarySyncTables=['meta','drafts','settings','operations','sessions','meanings','identities','packages','learningTargets','learningRuns','learningEvents','personalLearning','contentAttempts'] as const;
export const librarySyncHash=z.string().regex(/^[a-f0-9]{64}$/);
export const librarySyncRefs=z.array(librarySyncHash).min(1).max(2048);
export const librarySyncRow=z.object({table:z.enum(librarySyncTables),key:z.string().min(1).max(2000),blocks:librarySyncRefs}).strict();
export const librarySyncManifest=z.object({version:z.literal(1),libraryId:z.string().uuid(),learnerId:z.string().uuid(),rows:z.array(librarySyncRow).max(200000)}).strict().superRefine((v,c)=>{
 const ids=new Set<string>();for(const row of v.rows){const id=JSON.stringify([row.table,row.key]);if(ids.has(id))c.addIssue({code:'custom',message:'duplicate row'});ids.add(id);if(row.table==='meta'&&!['identity','learning-active','package-catalog'].includes(row.key))c.addIssue({code:'custom',message:'private metadata'});}
});
export const librarySyncHead=z.object({revision:z.number().int().nonnegative(),manifest:librarySyncRefs.nullable()}).strict();
export const librarySyncCommit=z.object({operationId:z.string().uuid(),baseRevision:z.number().int().nonnegative(),manifest:librarySyncRefs}).strict();
export type LibrarySyncManifest=z.infer<typeof librarySyncManifest>;
export type LibrarySyncHead=z.infer<typeof librarySyncHead>;

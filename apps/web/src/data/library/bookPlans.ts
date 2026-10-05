import {z} from 'zod';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import type {InstalledPackageSummary,PackageInstallation} from './packageRecords';

const uuid=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/u);
export const bookRangeSelectionSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('all')}).strict(),
 z.object({kind:z.literal('ordinals'),first:z.number().int().positive(),last:z.number().int().positive()}).strict(),
 z.object({kind:z.literal('senses'),senseVersionIds:z.array(uuid).min(1)}).strict(),
]);
export type BookRangeSelection=z.infer<typeof bookRangeSelectionSchema>;
export const bookPlanSchema=z.object({
 mode:z.enum(['active','maintenance','paused']),
 revision:z.number().int().positive(),
 changedByOperationId:uuid,
 updatedAt:z.string().datetime({offset:true}),
 range:z.object({
  rangeRevisionId:uuid,bookId:uuid,bookVersionId:uuid,archiveSha256:digest,
  memberCount:z.number().int().positive(),selection:bookRangeSelectionSchema,
  members:z.array(z.object({packageKey:z.string().min(1),memberIndex:z.number().int().nonnegative().nullable(),senseVersionId:uuid,bindingVersionId:uuid}).strict()),
 }).strict(),
}).strict().superRefine((plan,ctx)=>{
 const range=plan.range;
 if(range.selection.kind!=='all'&&!range.members.length)ctx.addIssue({code:'custom',message:'Selected Book Range must resolve actual members'});
 if(range.selection.kind==='all'&&range.members.length)ctx.addIssue({code:'custom',message:'Whole Book Range is the fixed immutable Manifest reference'});
 if(new Set(range.members.map(member=>JSON.stringify([member.packageKey,member.senseVersionId,member.bindingVersionId]))).size!==range.members.length)ctx.addIssue({code:'custom',message:'Book Range members must be unique'});
 if(range.members.some(member=>member.memberIndex!==null&&member.memberIndex>=range.memberCount))ctx.addIssue({code:'custom',message:'Book Range ordinal exceeds the fixed version'});
 if(range.selection.kind==='ordinals'){
  const {first,last}=range.selection;
  if(first>last||last>range.memberCount||range.members.some(member=>member.memberIndex===null||member.memberIndex<first-1||member.memberIndex>=last))ctx.addIssue({code:'custom',message:'Book Range ordinals are inconsistent'});
  if(new Set(range.members.map(member=>member.memberIndex)).size!==last-first+1)ctx.addIssue({code:'custom',message:'Book Range omitted a selected ordinal'});
 }
 const selection=range.selection;
 if(selection.kind==='senses'&&(new Set(selection.senseVersionIds).size!==selection.senseVersionIds.length||range.members.some(member=>!selection.senseVersionIds.includes(member.senseVersionId))||selection.senseVersionIds.some(id=>!range.members.some(member=>member.senseVersionId===id))))ctx.addIssue({code:'custom',message:'Book Range Sense selection is inconsistent'});
});
export type LocalBookPlan=z.infer<typeof bookPlanSchema>;
export type BookEnrollmentMode=LocalBookPlan['mode'];

/** Whole-Book selection is a fixed admitted Manifest reference. Mode changes
 * need neither recovered public cache bytes nor a new Range snapshot. */
export function reviseBookMode(input:{operationId:string;at:string;mode:BookEnrollmentMode;source:{bookId:string;bookVersionId:string;publicationArchiveSha256:string;memberCount:number};previous?:LocalBookPlan}):LocalBookPlan{
 const reference={bookId:input.source.bookId,bookVersionId:input.source.bookVersionId,archiveSha256:input.source.publicationArchiveSha256,memberCount:input.source.memberCount,selection:{kind:'all' as const},members:[]};
 const range=input.previous?.range??{...reference,rangeRevisionId:stableUuid(`local-book-range:${input.operationId}:${canonicalJsonDigest(reference)}`)};
 return bookPlanSchema.parse({mode:input.mode,revision:(input.previous?.revision??0)+1,changedByOperationId:input.operationId,updatedAt:input.at,range});
}

/** Restore/live admission verifies the resolved snapshot against known source
 * positions; cached semantics strengthen it without making cache persistence
 * a prerequisite for preserving an already admitted Range. */
export function assertResolvedBookRange(range:LocalBookPlan['range'],installations:readonly PackageInstallation[],packages:readonly InstalledPackageSummary[]=[]):void{
 if(range.selection.kind==='all')return;
 const installed=new Map(installations.map(installation=>[installation.key,installation]));
 const cached=new Map(packages.map(pack=>[pack.key,pack]));
 for(const member of range.members){
  const installation=installed.get(member.packageKey);
  const reference=installation?.artifact.bookMemberships?.find(reference=>reference.archiveSha256===range.archiveSha256);
  if(!installation||(!reference&&installation.artifact.bookArchiveSha256!==range.archiveSha256)||reference&&(reference.bookId!==range.bookId||reference.bookVersionId!==range.bookVersionId||reference.memberIndex!==member.memberIndex)||range.selection.kind==='ordinals'&&!reference)throw new Error('Book Range differs from its admitted Manifest.');
  const pack=cached.get(member.packageKey);
  if(pack&&!pack.content.entries.some(entry=>entry.senseVersionId===member.senseVersionId&&entry.bindingVersionId===member.bindingVersionId))throw new Error('Book Range semantic member is inconsistent.');
 }
 if(range.selection.kind==='ordinals'){
  const {first,last}=range.selection;
  const expected=new Set(installations.flatMap(installation=>{
   const reference=installation.artifact.bookMemberships?.find(reference=>reference.archiveSha256===range.archiveSha256);
   return reference&&reference.memberIndex>=first-1&&reference.memberIndex<last?[installation.key]:[];
  }));
  const selected=new Set(range.members.map(member=>member.packageKey));
  if(expected.size!==selected.size||[...expected].some(key=>!selected.has(key)))throw new Error('Book Range omitted an admitted ordinal.');
 }
 const complete=installations.filter(installation=>installation.artifact.bookMemberships?.some(reference=>reference.archiveSha256===range.archiveSha256)||installation.artifact.bookArchiveSha256===range.archiveSha256);
 if(complete.length===range.memberCount&&complete.every(installation=>cached.has(installation.key))){
  const selected=range.selection;
  const expected=complete.flatMap(installation=>cached.get(installation.key)!.content.entries.filter(entry=>selected.kind==='senses'?selected.senseVersionIds.includes(entry.senseVersionId):range.members.some(member=>member.packageKey===installation.key)).map(entry=>JSON.stringify([installation.key,entry.senseVersionId,entry.bindingVersionId]))).sort();
  const actual=range.members.map(member=>JSON.stringify([member.packageKey,member.senseVersionId,member.bindingVersionId])).sort();
  if(canonicalJsonDigest(expected)!==canonicalJsonDigest(actual))throw new Error('Book Range resolved members are incomplete.');
 }
}

/** Resolve actual admitted members now; never interpret UUID order as an ordinal. */
export function resolveBookPlan(input:{operationId:string;at:string;mode:BookEnrollmentMode;selection:BookRangeSelection;archiveSha256:string;packages:readonly InstalledPackageSummary[];previous?:LocalBookPlan}):LocalBookPlan{
 const selection=bookRangeSelectionSchema.parse(input.selection);
 const publications=input.packages.flatMap(pack=>{
  const publication=pack.portableOrigin.publications.find(value=>value.bookArchiveSha256===input.archiveSha256);
  return publication?[{pack,publication}]:[];
 });
 const first=publications[0]?.publication;
 if(!first||publications.length!==first.memberCount||publications.some(({publication})=>publication.book.bookId!==first.book.bookId||publication.book.bookVersionId!==first.book.bookVersionId||publication.memberCount!==first.memberCount))throw new Error('localFlow.catalogMismatch');
 const positions=publications.map(({publication})=>publication.memberIndex);
 const positioned=positions.every(index=>Number.isInteger(index))&&new Set(positions).size===positions.length&&positions.every(index=>index!>=0&&index!<first.memberCount);
 if(selection.kind==='ordinals'&&!positioned)throw new Error('localFlow.catalogMismatch');
 if(selection.kind==='ordinals'&&(selection.first>selection.last||selection.last>first.memberCount))throw new Error('localFlow.resourceInvalid');
 const ordered=[...publications].sort((a,b)=>positioned?a.publication.memberIndex!-b.publication.memberIndex!:a.pack.key.localeCompare(b.pack.key));
 const all=ordered.flatMap(({pack,publication})=>pack.content.entries.map(entry=>({packageKey:pack.key,memberIndex:publication.memberIndex??null,senseVersionId:entry.senseVersionId,bindingVersionId:entry.bindingVersionId})));
 const members=all.filter(member=>selection.kind==='all'||selection.kind==='ordinals'&&member.memberIndex!>=selection.first-1&&member.memberIndex!<selection.last||selection.kind==='senses'&&selection.senseVersionIds.includes(member.senseVersionId));
 if(!members.length||selection.kind==='senses'&&selection.senseVersionIds.some(id=>!members.some(member=>member.senseVersionId===id)))throw new Error('localFlow.resourceInvalid');
 const range={bookId:first.book.bookId,bookVersionId:first.book.bookVersionId,archiveSha256:input.archiveSha256,memberCount:first.memberCount,selection,members:selection.kind==='all'?[]:members};
 const previous=input.previous?.range;
 const before=previous?{bookId:previous.bookId,bookVersionId:previous.bookVersionId,archiveSha256:previous.archiveSha256,memberCount:previous.memberCount,selection:previous.selection,members:previous.members}:null;
 const unchanged=before&&canonicalJsonDigest(before)===canonicalJsonDigest(range);
 return bookPlanSchema.parse({mode:input.mode,revision:(input.previous?.revision??0)+1,changedByOperationId:input.operationId,updatedAt:input.at,range:{...range,rangeRevisionId:unchanged&&previous?previous.rangeRevisionId:stableUuid(`local-book-range:${input.operationId}:${canonicalJsonDigest(range)}`)}});
}

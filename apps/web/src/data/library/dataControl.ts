import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {libraryTables,readLibrary,restoreLibraryTransaction,assertCurrentLibrary,type LibraryIdentity} from './store';
import {learningOwner} from './packages';
import {clearAllCredentials} from './providers';
export type LocalClearPreview={libraryId:string;incarnation:string;operations:number;drafts:number;meanings:number;packages:number;targets:number;events:number;pending:number};
export const inspectLocalClear=()=>readLibrary(async tx=>{
 const owner=await learningOwner(tx),incarnation=await assertCurrentLibrary(tx);
 const [operations,drafts,meanings,packages,targets,events,sessions,tasks]=await Promise.all(['operations','drafts','meanings','packages','learningTargets','learningEvents','sessions','personalLearning'].map(t=>tx.all<any>(t as typeof libraryTables[number])));
 return {libraryId:owner.id,incarnation,operations:operations.length,drafts:drafts.length,meanings:meanings.length,packages:packages.length,targets:targets.length,events:events.length,pending:sessions.filter(s=>s.status==='inflight').length+tasks.filter(t=>['waiting','generating','reviewing','failed','rejected','stopped'].includes(t.status)).length} satisfies LocalClearPreview;
});
/** Explicit local erasure, never account deletion. No pending request is carried into the new library. */
export async function clearLocalLibrary(preview:LocalClearPreview){
 await restoreLibraryTransaction(async tx=>{
  const incarnation=await assertCurrentLibrary(tx),current=await learningOwner(tx);
  if(preview.libraryId!==current.id||preview.incarnation!==incarnation||(await tx.all('operations')).length!==preview.operations)throw new Error('localFlow.clearChanged');
  const owner=await tx.get('meta','service-owner'),installation=await tx.get('meta','service-installation');
  for(const table of libraryTables)tx.clear(table);
  const identity:LibraryIdentity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2};
  tx.put('meta','identity',identity);tx.put('meta','service-owner',owner);
  if(installation)tx.put('meta','service-installation',installation);
  tx.put('meta','local-incarnation',crypto.randomUUID());
  tx.put('operations','00000000-0000-4000-8000-000000000001',{input:canonicalConsumerJson({kind:'library.create',input:{}}),result:identity,committedAt:identity.createdAt});
 });clearAllCredentials();
}
/** Apply a confirmed account barrier locally; never clear a different account's library. */
export async function eraseDeletedAccount(subject:string){
 await restoreLibraryTransaction(async tx=>{
  const owner=await tx.get<{subject:string}>('meta','service-owner');
  if(!owner&&await tx.get('meta','signed-out'))return;
  await assertCurrentLibrary(tx);
  if(owner&&owner.subject!==subject)throw new Error('localFlow.wrongAccount');
  for(const table of libraryTables)tx.clear(table);
  tx.put('meta','local-incarnation',crypto.randomUUID());tx.put('meta','signed-out',true);
 });clearAllCredentials();
}

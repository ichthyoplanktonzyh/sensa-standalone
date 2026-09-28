import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {libraryTables,readLibrary,restoreLibraryTransaction,assertCurrentLibrary,type LibraryIdentity,type LibraryTransaction} from './store';
import {learningOwner} from './libraryOwnership';
import {clearAllCredentials} from './providers';
import {clearLocalLibraryHint} from './localLibraryHint';
import {inspectPendingCloudSync,type PendingCloudSyncRecord} from './cloudSync';
import {syncAccountLibrary} from './cloudSyncService';
export type LocalClearSyncAttempt='not-needed'|'required'|'succeeded'|'failed';
export type LocalClearPreview={libraryId:string;incarnation:string;localRevision:number;operations:number;drafts:number;meanings:number;packages:number;targets:number;events:number;pending:number;pendingSync:number;pendingSyncRecords:PendingCloudSyncRecord[];canSync:boolean;syncAttempt:LocalClearSyncAttempt};
async function inspectLocalClearTransaction(tx:LibraryTransaction):Promise<LocalClearPreview>{
 const owner=await learningOwner(tx),incarnation=await assertCurrentLibrary(tx);
 const [operations,drafts,meanings,packages,targets,events,sessions,tasks,cloud]=await Promise.all([
  tx.count('operations'),tx.count('drafts'),tx.count('meanings'),tx.count('packageInstallations'),
  tx.count('learningTargets'),tx.count('learningEvents'),
  tx.all<any>('sessions'),tx.all<any>('personalLearning'),inspectPendingCloudSync(tx),
 ]);
 return {libraryId:owner.id,incarnation,localRevision:cloud.localRevision,operations,drafts,meanings,packages,targets,events,pending:sessions.filter(s=>s.status==='inflight').length+tasks.filter(t=>['waiting','generating','reviewing','failed','rejected','stopped'].includes(t.status)).length,pendingSync:cloud.records.length,pendingSyncRecords:cloud.records,canSync:cloud.canSync,syncAttempt:cloud.records.length?'required':'not-needed'};
}
export const inspectLocalClear=()=>readLibrary(inspectLocalClearTransaction);
function samePreview(expected:LocalClearPreview,current:LocalClearPreview){
 return expected.libraryId===current.libraryId&&expected.incarnation===current.incarnation&&expected.localRevision===current.localRevision&&expected.operations===current.operations;
}
/** Checkpoint pending account data before local erasure. A failure preserves all local records. */
export async function attemptLocalClearSync(preview:LocalClearPreview,synchronize:()=>Promise<void>=syncAccountLibrary):Promise<LocalClearPreview>{
 const before=await inspectLocalClear();
 if(!samePreview(preview,before))throw new Error('localFlow.clearChanged');
 if(!before.pendingSync)return {...before,syncAttempt:'not-needed'};
 try{await synchronize();}catch{
  const current=await inspectLocalClear();
  if(current.libraryId!==before.libraryId||current.incarnation!==before.incarnation)throw new Error('localFlow.clearChanged');
  return {...current,syncAttempt:'failed'};
 }
 const current=await inspectLocalClear();
 if(current.libraryId!==before.libraryId||current.incarnation!==before.incarnation)throw new Error('localFlow.clearChanged');
 return {...current,syncAttempt:current.pendingSync?'failed':'succeeded'};
}
/** Explicit local erasure, never account deletion. No pending request is carried into the new library. */
export async function clearLocalLibrary(preview:LocalClearPreview,options:{discardPendingSync?:boolean}={}){
 await restoreLibraryTransaction(async tx=>{
  const current=await inspectLocalClearTransaction(tx);
  if(!samePreview(preview,current))throw new Error('localFlow.clearChanged');
  if(current.pendingSync&&!(preview.syncAttempt==='failed'&&options.discardPendingSync))throw new Error('localFlow.clearSyncRequired');
  const owner=await tx.get('meta','service-owner'),installation=await tx.get('meta','service-installation');
  for(const table of libraryTables)tx.clear(table);
  const identity:LibraryIdentity={id:crypto.randomUUID(),learnerId:crypto.randomUUID(),deviceId:crypto.randomUUID(),createdAt:new Date().toISOString(),schemaVersion:2};
  tx.put('meta','identity',identity);if(owner)tx.put('meta','service-owner',owner);
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
 });clearAllCredentials();clearLocalLibraryHint();
}

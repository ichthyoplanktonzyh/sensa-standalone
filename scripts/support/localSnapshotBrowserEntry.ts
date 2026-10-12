/** Isolated assessment entry; the shipped app never imports this module. */
import {contentSupplySystem} from '../../apps/web/src/contentSupply/system/index';
import {sqliteRecordAdapter,openIsolatedLocalSnapshot,openIsolatedLocalGeneration} from '../../apps/web/src/data/library/sqliteAdapter';
import {openLibrary,readLibrary,restoreLibraryTransaction,readLocalLibraryRevision} from '../../apps/web/src/data/library/store';
import {enrollPackage,confirmLearningQuantity,finishLearning,startLearning,actLearning} from '../../apps/web/src/data/library/learning';
import {languageRoutesSnapshot} from '../../apps/web/src/data/library/language';
import {decodeBackupValue,encodeBackupValue} from '../../apps/web/src/data/library/backupCodec';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry} from '../../apps/web/src/data/library/replication/libraryReplica';
import {librarySyncTables} from '@sensa/contracts/sensa';
import {sha256} from '@sensa/learning-kernel';
import type {LocalPortableSnapshot} from '../../apps/web/src/data/library/sqlitePortableSnapshot';
import type {SqliteRecordAdapter} from '../../apps/web/src/data/library/sqliteAdapter';
let snapshot:LocalPortableSnapshot|undefined;
let imported:Awaited<ReturnType<typeof openIsolatedLocalSnapshot>>|undefined;
let reopened:Awaited<ReturnType<typeof openIsolatedLocalGeneration>>|undefined;
const reader=()=>reopened??imported?.adapter;
export async function install(bytes:number[]){
 const input=new Uint8Array(bytes),preview=await contentSupplySystem.execute({kind:'preview_portable_package',bytes:input});
 return contentSupplySystem.execute({kind:'install_portable_package',bytes:input,expectedArchiveDigest:preview.archiveDigest});
}
export async function seedLearning(bytes:number[],at:string){
 await openLibrary();const pack=await install(bytes),context=(await languageRoutesSnapshot()).context;
 const [targetId]=await enrollPackage(crypto.randomUUID(),pack.key,context);
 await confirmLearningQuantity(crypto.randomUUID(),context,20);await settle(targetId!,at);
 return {targetId,packageKey:pack.key};
}
export async function settle(id:string,at:string){
 const context=(await languageRoutesSnapshot()).context;
 let receipt=await startLearning(crypto.randomUUID(),id,context,20,at);
 receipt=await actLearning(crypto.randomUUID(),receipt.id,receipt.revision,{kind:'reveal'},at);
 receipt=await actLearning(crypto.randomUUID(),receipt.id,receipt.revision,{kind:'rate',rating:'good'},at);
 await finishLearning(crypto.randomUUID(),receipt.id);return receipt;
}
export async function targetClock(id:string){return readLibrary(async tx=>{const target=await tx.get<any>('learningTargets',id);return new Date(Math.max(Date.now(),Date.parse(target.relearnAt??target.memory?.dueAt.toISOString()??new Date().toISOString()))).toISOString();});}
export async function loadBatch(table:any,text:string){
 const rows=decodeBackupValue(JSON.parse(text));
 await restoreLibraryTransaction(async tx=>{for(const row of rows)tx.put(table,row.key,row.value);});
}
export async function confirmQuantity(){await confirmLearningQuantity(crypto.randomUUID(),(await languageRoutesSnapshot()).context,20);}
export async function targetIds(){const adapter=await sqliteRecordAdapter(),ids:string[]=[];let after:string|null=null;for(;;){const page=await adapter.recordKeysPage('learningTargets',after,128);ids.push(...page);if(page.length<128)return ids;after=page.at(-1)!;}}
export async function exportSnapshot(){
 const adapter=await sqliteRecordAdapter(),revision=await readLibrary(readLocalLibraryRevision),started=performance.now();
 if(!adapter.exportLocalSnapshot)throw Error('snapshot_export_missing');snapshot=await adapter.exportLocalSnapshot(revision);
 return {elapsedMs:performance.now()-started,bytes:snapshot.bytes.length,timingsMs:snapshot.timingsMs,sourceRevision:revision,digest:snapshot.sha256};
}
export async function importSnapshot(){
 if(!snapshot)throw Error('snapshot_missing');const started=performance.now();imported=await openIsolatedLocalSnapshot(snapshot);
 return {elapsedMs:performance.now()-started,namespace:imported.namespace,report:imported.report,diagnostics:imported.diagnostics};
}
export function snapshotData(){if(!snapshot)throw Error('snapshot_missing');return {...snapshot,bytes:[...snapshot.bytes]};}
export async function refuseSnapshotData(data:Omit<LocalPortableSnapshot,'bytes'>&{bytes:number[]}){
 try{const accepted=await openIsolatedLocalSnapshot({...data,bytes:new Uint8Array(data.bytes)});await accepted.adapter.close();return {accepted:true};}
 catch(error){return {accepted:false,error:String(error)};}
}
export async function rejectTruncatedSnapshot(){
 if(!snapshot)throw Error('snapshot_missing');const bytes=snapshot.bytes.slice(0,1024);
 try{const accepted=await openIsolatedLocalSnapshot({...snapshot,bytes,sha256:sha256(bytes)});await accepted.adapter.close();return {accepted:true};}
 catch(error){return {accepted:false,error:String(error)};}
}
export async function refusedReopen(namespace:string){
 try{const accepted=await openIsolatedLocalGeneration(namespace);await accepted.close();return {accepted:true};}
 catch(error){return {accepted:false,error:String(error)};}
}
export async function initialSnapshotRead(){
 try{if(!imported)throw Error('snapshot_missing');return {accepted:true,count:await imported.adapter.count('learningTargets')};}
 catch(error){return {accepted:false,error:String(error)};}
}
export async function reopenSnapshot(){
 if(!imported)throw Error('snapshot_import_missing');const started=performance.now();await imported.adapter.close();reopened=await openIsolatedLocalGeneration(imported.namespace);
 return {elapsedMs:performance.now()-started,diagnostics:await reopened.diagnostics(),targets:await reopened.count('learningTargets'),runs:await reopened.count('learningRuns'),events:await reopened.count('learningEvents')};
}
export async function hashes(receiver=false){
 const adapter=receiver?reader():await sqliteRecordAdapter();if(!adapter)throw Error('snapshot_reader_missing');
 const encoded=await adapter.get('meta','identity');if(encoded===null)throw Error('snapshot_identity_missing');const identity=decodeBackupValue(JSON.parse(encoded));
 const result:Record<string,string>={};
 for(const table of librarySyncTables){let after:string|null=null;for(;;){const page=await adapter.entriesPage(table,after,64);for(const row of page)if(isReplicatedLibraryEntry(table,row.key)){const value=decodeBackupValue(JSON.parse(row.encodedValue));const normalized=normalizeLibraryReplicaEntry({table,key:row.key,value},identity);result[JSON.stringify([table,row.key])]=sha256(JSON.stringify(encodeBackupValue(normalized.value)));}if(page.length<64)break;after=page.at(-1)!.key;}}
 return result;
}
export async function counts(receiver=false){const adapter=receiver?reader():await sqliteRecordAdapter();if(!adapter)throw Error('snapshot_reader_missing');return {targets:await adapter.count('learningTargets'),runs:await adapter.count('learningRuns'),events:await adapter.count('learningEvents'),privateOperations:await adapter.count('operations'),packageCache:await adapter.count('packageCache')};}
/** Inject only the isolated adapter into this fresh assessment page. No
 * selection key or user active pointer is changed. This is not UI acceptance. */
export async function attachForLearning(namespace:string){
 const isolated=await openIsolatedLocalGeneration(namespace),normal=await sqliteRecordAdapter();
 const methods=['get','entries','entriesPage','recordKeysPage','existingRecordKeys','packageCacheProjection','lookupMeanings','contextBrowse','worldBrowse','worldSceneMeaning','registrySelection','worldLearningChoices','practiceExpressions','existingJourneyIdentities','changesSince','hasChangesSince','syncBaseEntries','syncBaseReferences','count','estimateRecordBytes','homeLearningProjection','learningSchedulePage','learningHistoryPage','learningManagementSummary','runtimeLearningCandidates','studyScopeMember','latestLearningActionAt','countIntroducedLearningTargets','learningRunIdsForTarget','openLearningRunTargets','countContentAttemptsSince','learningTargetIdsForBookUpgrade','isMediaReferenced','portableMedia','portableMediaDiagnostics','commit','diagnostics','learningSemanticMemory','replicaCandidate'] as const satisfies readonly (keyof SqliteRecordAdapter)[];
 for(const name of methods)Reflect.set(normal,name,(...args:unknown[])=>Reflect.apply(Reflect.get(isolated,name),isolated,args));
 reopened=isolated;await openLibrary();return counts(true);
}
export async function close(){await reopened?.close();if(imported&&!reopened)await imported.adapter.close();}

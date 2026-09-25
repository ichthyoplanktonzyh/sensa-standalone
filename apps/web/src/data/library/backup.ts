import {z} from 'zod';
import {libraryTables,readLibrary,restoreLibraryTransaction,assertCurrentLibrary,type LibraryTransaction,type LibraryIdentity} from './store';
import {learningOwner} from './libraryOwnership';
import {encodeBackupValue,decodeBackupValue} from './backupCodec';
import {validateBackupRows,backupOwnerSchema,type BackupRows} from './backupValidation';
import {clearAllCredentials} from './providers';
import {libraryBackupTables} from './backupPolicy';
import {isReplicatedLibraryEntry,normalizeLibraryReplicaEntry,restoreLibraryReplicaValue,type LibraryReplicaEntry} from './replication/libraryReplica';
const MAX_PLAIN=64*1024*1024,MAX_FILE=90*1024*1024;
const AAD=new TextEncoder().encode('sensa-web-library-backup-v1:PBKDF2-SHA256:600000:AES-256-GCM');
const localMeta=new Set(['cloud-sync','delivery-private','delivery-join','service-owner','service-installation','signed-out','backup-restored','local-incarnation','local-content-revision']);
const serviceOperation=(value:any)=>typeof value?.input==='string'&&JSON.parse(value.input).kind?.startsWith('service.');
const b64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
const unb64=(value:string)=>{if(!/^[A-Za-z0-9+/]*={0,2}$/u.test(value))throw new Error('libraryBackup.errors.encoding');const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));if(b64(bytes)!==value)throw new Error('libraryBackup.errors.encoding');return bytes;};
const passSchema=z.string().min(12).max(1024);
async function keyFor(password:string,salt:Uint8Array){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(passSchema.parse(password)),{name:'PBKDF2'},false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:salt as BufferSource,iterations:600000},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
const rowSchema=z.object({key:z.string().min(1).max(2000),value:z.unknown()}).strict();
const localBackupOwnerSchema=backupOwnerSchema.extend({accountId:z.string().uuid().optional()});
const payloadBase={librarySchema:z.literal(6),createdAt:z.string().datetime({offset:true}),tables:z.record(z.string(),z.array(rowSchema))};
const payloadSchema=z.discriminatedUnion('format',[
 z.object({...payloadBase,format:z.literal('sensa-web-library-snapshot-v1'),owner:backupOwnerSchema}).strict(),
 z.object({...payloadBase,format:z.literal('sensa-web-library-snapshot-v2'),owner:localBackupOwnerSchema.nullable()}).strict(),
]);
const envelopeSchema=z.object({format:z.literal('sensa-web-library-backup-v1'),kdf:z.literal('PBKDF2-SHA256'),iterations:z.literal(600000),cipher:z.literal('AES-256-GCM'),salt:z.string().max(24),iv:z.string().max(16),data:z.string().max(MAX_FILE)}).strict();
export type BackupSummary={createdAt:string;account:string|null;libraryId:string;drafts:number;meanings:number;packages:number;targets:number;runs:number;events:number;preparations:number;interrupted:number};
export type BackupSizeEstimate={usedBytes:number;capacityBytes:number};
function summary(payload:z.infer<typeof payloadSchema>,rows:BackupRows):BackupSummary{const identity=rows.meta.find(r=>r.key==='identity')!.value;return {createdAt:payload.createdAt,account:payload.owner?.email??payload.owner?.subject??null,libraryId:identity.id,drafts:rows.drafts.length,meanings:rows.meanings.length,packages:rows.packageInstallations.length,targets:rows.learningTargets.length,runs:rows.learningRuns.length,events:rows.learningEvents.length,preparations:rows.personalLearning.length,interrupted:rows.sessions.filter(r=>r.value.status==='inflight').length+rows.personalLearning.filter(r=>['generating','reviewing'].includes(r.value.status)).length};}
async function decode(file:Uint8Array,password:string){
 if(file.byteLength>MAX_FILE)throw new Error('libraryBackup.errors.fileTooLarge');
 let payload:z.infer<typeof payloadSchema>;
 try{const envelope=envelopeSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(file))),salt=unb64(envelope.salt),iv=unb64(envelope.iv),data=unb64(envelope.data);if(salt.length!==16||iv.length!==12||data.length>MAX_PLAIN+16)throw Error();const key=await keyFor(password,salt);const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:iv as BufferSource,additionalData:AAD},key,data as BufferSource);payload=payloadSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}catch{throw new Error('libraryBackup.errors.invalidFile');}
 if(Object.keys(payload.tables).length!==libraryBackupTables.length||libraryBackupTables.some(t=>!Array.isArray(payload.tables[t])))throw new Error('libraryBackup.errors.tables');
 const rows=Object.fromEntries(libraryTables.map(table=>[table,[]])) as unknown as BackupRows;let count=0;
 for(const table of libraryBackupTables){const source=payload.tables[table];count+=source.length;if(count>200000||new Set(source.map(r=>r.key)).size!==source.length)throw new Error('libraryBackup.errors.records');rows[table]=source.map(r=>({key:r.key,value:decodeBackupValue(r.value)}));}
 if(rows.meta.some(r=>localMeta.has(r.key))||rows.operations.some(r=>serviceOperation(r.value)))throw new Error('libraryBackup.errors.authorization');
 validateBackupRows(rows);return {payload,rows,summary:summary(payload,rows)};
}
async function encodeCurrentLibrary(){
 const snapshot=await readLibrary(async tx=>{await learningOwner(tx);const storedOwner=await tx.get('meta','service-owner');const owner=storedOwner?localBackupOwnerSchema.parse(storedOwner):null;const rows=Object.fromEntries(libraryTables.map(table=>[table,[]])) as unknown as BackupRows;for(const table of libraryTables){rows[table]=(await tx.entries(table)).map(r=>{if(typeof r.key!=='string')throw new Error('libraryBackup.errors.recordKey');return {key:r.key,value:r.value};});}rows.meta=rows.meta.filter(r=>!localMeta.has(r.key));rows.operations=rows.operations.filter(r=>!serviceOperation(r.value));return {owner,rows};});
 if(libraryBackupTables.reduce((count,table)=>count+snapshot.rows[table].length,0)>200000)throw new Error('libraryBackup.errors.rowLimit');
 validateBackupRows(snapshot.rows);
 const tables=Object.fromEntries(libraryBackupTables.map(t=>[t,snapshot.rows[t].map(r=>({key:r.key,value:encodeBackupValue(r.value)}))]));
 const payload=payloadSchema.parse({format:'sensa-web-library-snapshot-v2',librarySchema:6,createdAt:new Date().toISOString(),owner:snapshot.owner,tables});
 const plaintext=new TextEncoder().encode(JSON.stringify(payload));if(plaintext.length>MAX_PLAIN)throw new Error('libraryBackup.errors.sizeLimit');
 return {payload,rows:snapshot.rows,plaintext};
}
export async function estimateLibraryBackupSize():Promise<BackupSizeEstimate>{const {plaintext}=await encodeCurrentLibrary();return {usedBytes:plaintext.byteLength,capacityBytes:MAX_PLAIN};}
export async function exportLibraryBackup(password:string){
 passSchema.parse(password);
 const {payload,rows,plaintext}=await encodeCurrentLibrary();
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));const key=await keyFor(password,salt);const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:AAD},key,plaintext);
 const file=new TextEncoder().encode(JSON.stringify({format:'sensa-web-library-backup-v1',kdf:'PBKDF2-SHA256',iterations:600000,cipher:'AES-256-GCM',salt:b64(salt),iv:b64(iv),data:b64(new Uint8Array(ciphertext))}));
 return {file,summary:summary(payload,rows)};
}
export async function inspectLibraryBackup(file:Uint8Array,password:string){return (await decode(file,password)).summary;}
async function emptyDestination(tx:LibraryTransaction){
 for(const table of libraryTables){const entries=await tx.entries(table);if(table==='packageCache')continue;if(table==='meta'){if(entries.some(r=>!localMeta.has(String(r.key))&&!['identity','package-catalog'].includes(String(r.key))))return false;}else if(table==='operations'){if(entries.some(r=>!serviceOperation(r.value)&&!['library.create','package.catalog'].includes(JSON.parse(r.value.input).kind)))return false;}else if(entries.length)return false;}
 return true;
}
function restoredDomainValue(table:string,key:string,value:unknown,identity:LibraryIdentity){
 if(!isReplicatedLibraryEntry(table,key))return value;
 const entry={table:table as LibraryReplicaEntry['table'],key,value};
 const normalized=normalizeLibraryReplicaEntry(entry,identity);
 return restoreLibraryReplicaValue(normalized,normalized.value,identity);
}
export async function restoreLibraryBackup(file:Uint8Array,password:string){
 const checked=await decode(file,password);
 const result=await restoreLibraryTransaction(async tx=>{
  await assertCurrentLibrary(tx);
  const destination=await learningOwner(tx),storedOwner=await tx.get('meta','service-owner'),owner=storedOwner?localBackupOwnerSchema.parse(storedOwner):null;
  const sourceOwner=checked.payload.owner;
  if(owner?.subject!==sourceOwner?.subject||(owner?.accountId&&sourceOwner?.accountId&&owner.accountId!==sourceOwner.accountId))throw new Error('libraryBackup.errors.accountMismatch');
  // Recheck after decrypt/preview: another tab or Intake may have written meanwhile.
  if(!await emptyDestination(tx))throw new Error('libraryBackup.errors.occupied');
  const rows=checked.rows,source=rows.meta.find(r=>r.key==='identity')!.value as LibraryIdentity;
  const identity={...source,deviceId:destination.deviceId===source.deviceId?crypto.randomUUID():destination.deviceId};
  tx.clear('packageCache');
  for(const table of libraryBackupTables){if(table==='meta'||table==='operations')continue;for(const row of rows[table]){
    tx.put(table,row.key,restoredDomainValue(table,row.key,row.value,identity));
  }}
  for(const row of rows.meta)tx.put('meta',row.key,row.key==='identity'?identity:row.value);
  for(const row of rows.operations){if(row.key==='00000000-0000-4000-8000-000000000001')row.value.result=identity;tx.put('operations',row.key,row.value);}
  tx.delete('meta','cloud-sync');
  tx.put('meta','local-incarnation',crypto.randomUUID());
  tx.put('meta','backup-restored',{at:new Date().toISOString(),sourceCreatedAt:checked.payload.createdAt,libraryId:source.id});
  return checked.summary;
 });clearAllCredentials();const {contentSupplySystem}=await import('../../contentSupply/system/contentSupplySystem');await contentSupplySystem.execute({kind:'rehydrate'}).catch(()=>undefined);return result;
}

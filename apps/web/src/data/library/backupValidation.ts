import {hydrateMeaningContexts} from '../../experience/personalMeaningJourney/contextRecords';
import {canonicalConsumerJson,defaultSensaLanguageRouteCollection,sensaFormalPinnedLanguageContextSchema,sensaLanguageRouteCollectionSchema,sensaReadingGlossarySchema} from '@sensa/contracts/sensa';
import {z} from 'zod';

import {backupEqual} from './backupCodec';
import {providerInputSchema} from './providerContracts';
import {validateContentSupplyReplicaSteps} from './replication/contentSupplyValidation';
import {validatePersonalContentReplicaSteps} from './replication/personalContentValidation';
import {validateLearningReplicaSteps} from './replication/learningValidation';
import {validatePersonalSemanticWorldReplicaSteps} from './replication/personalSemanticWorldValidation';
import type {Table} from './store';
import {libraryRowsReader,libraryRecordViews,findLibraryRow,type LibraryRecordReader} from './libraryRecordReader';
import {sqliteLibraryTables} from './sqliteProtocol';
import {runSynchronously,runCooperatively} from '../../experience/personalMeaningJourney/cooperative';

export type BackupRows=Record<Table,{key:string;value:any}[]>;
const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
const identitySchema=z.object({id:uuid,learnerId:uuid,deviceId:uuid,createdAt:timestamp,schemaVersion:z.literal(2)}).strict();
export const backupOwnerSchema=z.object({subject:uuid,accountId:uuid,email:z.string().max(500).optional()}).strict();
const fail=():never=>{throw new Error('libraryBackup.errors.inconsistent');};

/**
 * Cross-domain integrity coordinator used by both Cloud Checkpoints and manual
 * backup. Each product domain validates its own facts and replay semantics.
 */
export function validateBackupRows(rows:BackupRows){
 return validateLibraryRecords(libraryRowsReader(rows));
}

/** Same complete integrity contract for decoded backups and indexed candidates. */
export function validateLibraryRecords(reader:LibraryRecordReader){
 return runSynchronously(validateLibraryRecordSteps(reader));
}
export function validateLibraryRecordsCooperatively(reader:LibraryRecordReader){
 return runCooperatively(validateLibraryRecordSteps(reader));
}
export function* validateLibraryRecordSteps(reader:LibraryRecordReader){
 let readFailed=false,readFailure:unknown;
 const read=<T>(work:()=>T):T=>{try{return work();}catch(cause){if(!readFailed){readFailed=true;readFailure=cause;}throw cause;}};
 const observed:LibraryRecordReader={
  get:(table,key)=>read(()=>reader.get(table,key)),has:(table,key)=>read(()=>reader.has(table,key)),
  *entries(table){
   const iterator=read(()=>reader.entries(table)[Symbol.iterator]());
   try{for(;;){const next=read(()=>iterator.next());if(next.done)return;yield next.value;}}
   finally{read(()=>iterator.return?.());}
  },
 };
 try{
  const identity=yield*validateLibraryRecordFacts(observed);
  if(readFailed)throw readFailure;
  return identity;
 }catch(cause){
  // Domain adapters may normalize an invariant failure. They must not erase
  // the original reader's cancellation, fence or physical storage failure.
  if(readFailed)throw readFailure;
  throw cause;
 }
}
function* validateLibraryRecordFacts(reader:LibraryRecordReader){
 const {rows,maps}=libraryRecordViews(reader);
 // A lazy reader must decode every stored wire value, including opaque
 // preferences that a domain validator may not otherwise need to inspect.
 for(const table of sqliteLibraryTables){
  const keys=new Set<string>();
  for(const {key} of rows[table]){if(typeof key!=='string'||key.length===0||key.length>2000||keys.has(key))fail();keys.add(key);yield;}
 }
 const requireRow=(table:Table,id:string)=>{const raw=maps[table].get(id)??fail();return table==='semanticMeanings'?hydrateMeaningContexts(raw,key=>maps.semanticContexts.get(key)):raw;};
 const routeCollection=sensaLanguageRouteCollectionSchema.parse(maps.settings.get('language-learning-routes')??defaultSensaLanguageRouteCollection);
 const routes=new Map(routeCollection.routes.map(route=>[route.id,route]));
 const validateLanguageContext=(value:unknown)=>{const context=sensaFormalPinnedLanguageContextSchema.parse(value);const route=routes.get(context.languageRouteId);if(!route||route.targetLanguageTag!==context.targetLanguageTag||context.languageRouteRevision>route.revision)fail();return context;};
 const glossary=maps.settings.get('reading-glossary');if(glossary!==undefined)sensaReadingGlossarySchema.parse(glossary);
 const identity=identitySchema.parse(requireRow('meta','identity'));
 const {requirePersonalSource}=yield*validatePersonalSemanticWorldReplicaSteps({rows,maps,requireRow,fail});

 for(const table of ['drafts','sessions','meanings','curriculumEnrollments','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations','personalLearning','contentAttempts','providers'] as Table[]){
  for(const {key,value} of rows[table]){if(!value||key!==value.id)fail();uuid.parse(key);yield;}
 }
 for(const {value:provider} of rows.providers){const {revision,...fields}=provider;providerInputSchema.parse({...fields,expectedRevision:revision-1});yield;}
 for(const {key,value:operation} of rows.operations){
  uuid.parse(key);if(typeof operation?.input!=='string')fail();const input=JSON.parse(operation.input);
  if(canonicalConsumerJson(input)!==operation.input||typeof input.kind!=='string'||input.kind.startsWith('service.'))fail();
  timestamp.parse(operation.committedAt);
  if(operation.cloudReceipt!==undefined&&(operation.cloudReceipt!==true||operation.result!==null||['library.create','intake.receive'].includes(input.kind)))fail();
  yield;
 }
 const operationInput=(id:string)=>{const operation=maps.operations.get(id);return operation?JSON.parse(operation.input):undefined;};
 if(findLibraryRow(rows.operations,()=>true)){
  const creation=maps.operations.get('00000000-0000-4000-8000-000000000001');
  if(!creation||operationInput('00000000-0000-4000-8000-000000000001').kind!=='library.create'||!backupEqual(creation.result,identity))fail();
 }

 yield*validateContentSupplyReplicaSteps({rows,identity,requireRow,requirePersonalSource,validateLanguageContext,fail});
 yield*validatePersonalContentReplicaSteps({rows,requireRow,fail});
 yield*validateLearningReplicaSteps({rows,maps,identity,routes,requireRow,requirePersonalSource,validateLanguageContext,operationInput,fail});
 return identity;
}

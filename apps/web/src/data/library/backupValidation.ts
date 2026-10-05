import {canonicalConsumerJson,defaultSensaLanguageRouteCollection,sensaFormalPinnedLanguageContextSchema,sensaLanguageRouteCollectionSchema,sensaReadingGlossarySchema} from '@sensa/contracts/sensa';
import {z} from 'zod';

import {backupEqual} from './backupCodec';
import {providerInputSchema} from './providers';
import {validateContentSupplyReplica} from './replication/contentSupplyValidation';
import {validatePersonalContentReplica} from './replication/personalContentValidation';
import {validateLearningReplica} from './replication/learningValidation';
import {validatePersonalSemanticWorldReplica} from './replication/personalSemanticWorldValidation';
import {libraryTables,type Table} from './store';

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
 const maps=Object.fromEntries(libraryTables.map(table=>[table,new Map(rows[table].map(row=>[row.key,row.value]))])) as Record<Table,Map<string,any>>;
 const requireRow=(table:Table,id:string)=>maps[table].get(id)??fail();
 const routeCollection=sensaLanguageRouteCollectionSchema.parse(maps.settings.get('language-learning-routes')??defaultSensaLanguageRouteCollection);
 const routes=new Map(routeCollection.routes.map(route=>[route.id,route]));
 const validateLanguageContext=(value:unknown)=>{const context=sensaFormalPinnedLanguageContextSchema.parse(value);const route=routes.get(context.languageRouteId);if(!route||route.targetLanguageTag!==context.targetLanguageTag||context.languageRouteRevision>route.revision)fail();return context;};
 const glossary=maps.settings.get('reading-glossary');if(glossary!==undefined)sensaReadingGlossarySchema.parse(glossary);
 const identity=identitySchema.parse(requireRow('meta','identity'));
 const {requirePersonalSource}=validatePersonalSemanticWorldReplica({rows,maps,requireRow,fail});

 for(const table of ['drafts','sessions','meanings','curriculumEnrollments','studyScopes','learningSessions','learningTargets','learningRuns','learningEvents','learningReconciliations','personalLearning','contentAttempts','providers'] as Table[]){
  for(const {key,value} of rows[table]){if(!value||key!==value.id)fail();uuid.parse(key);}
 }
 for(const {value:provider} of rows.providers){const {revision,...fields}=provider;providerInputSchema.parse({...fields,expectedRevision:revision-1});}
 for(const {key,value:operation} of rows.operations){
  uuid.parse(key);if(typeof operation?.input!=='string')fail();const input=JSON.parse(operation.input);
  if(canonicalConsumerJson(input)!==operation.input||typeof input.kind!=='string'||input.kind.startsWith('service.'))fail();
  timestamp.parse(operation.committedAt);
  if(operation.cloudReceipt!==undefined&&(operation.cloudReceipt!==true||operation.result!==null||['library.create','intake.receive'].includes(input.kind)))fail();
 }
 const operationInput=(id:string)=>{const operation=maps.operations.get(id);return operation?JSON.parse(operation.input):undefined;};
 if(rows.operations.length){
  const creation=maps.operations.get('00000000-0000-4000-8000-000000000001');
  if(!creation||operationInput('00000000-0000-4000-8000-000000000001').kind!=='library.create'||!backupEqual(creation.result,identity))fail();
 }

 validateContentSupplyReplica({rows,identity,requireRow,requirePersonalSource,validateLanguageContext,fail});
 validatePersonalContentReplica({rows,requireRow,fail});
 validateLearningReplica({rows,maps,identity,routes,requireRow,requirePersonalSource,validateLanguageContext,operationInput,fail});
 return identity;
}

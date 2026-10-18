/** Owner-local, exact registry selectors for command frames, not model tools. */
import type {SensaExpressionType,SensaExpressionBindingRelation,SensaSemanticCoverage} from '@sensa/contracts/sensa';
import {sensaExpressionTypeSchema} from '@sensa/contracts/sensa';
import type {SenseRegistryState} from '../../experience/personalMeaningJourney/store';
import {isUuid} from '../../experience/personalMeaningJourney/ids';
import {decodeBackupValue} from './backupCodec';
import {unpackStoredRecord} from './sharedRecordContent';

export type RegistrySelectionQuery=
 |{kind:'learningChoices';normalizedPrefix:string;languageTag:string;offset:number;limit:number}
 |{kind:'senseKey';senseKey:string}
 |{kind:'expression';normalizedForm:string;languageTag:string;expressionType:SensaExpressionType}
 |{kind:'binding';senseId:string;expressionId:string;relation:SensaExpressionBindingRelation}
 |{kind:'bindingVersion';bindingId:string;senseVersionId:string;expressionVersionId:string;coverage:SensaSemanticCoverage}
 |{kind:'ordinal';registryKind:keyof SenseRegistryState};
export type RegistrySelection={keys:string[];nextOrdinal?:number};
const kinds=['senses','senseVersions','expressions','expressionVersions','bindings','bindingVersions'];
/** Deterministic scalar fields from the actual tagged source codec. SQLite
 * maintains expression indexes atomically; no second registry cache is trusted.
 * Memoize only the current row, never the complete registry or private prose. */
export function registryFieldReader(){
 let previous:string|null=null,row:{kind:string;ordinal:number;value:Record<string,unknown>}|null=null;
 return (encoded:unknown,field:unknown):string|number|null=>{
  if(typeof encoded!=='string'||typeof field!=='string')throw new Error('semantic_registry_field_invalid');
  if(previous!==encoded){
   const value=decodeBackupValue(JSON.parse(unpackStoredRecord(encoded)));
   if(!value||!kinds.includes(value.kind)||!Number.isSafeInteger(value.ordinal)||value.ordinal<0||!value.value||typeof value.value!=='object'||Array.isArray(value.value))throw new Error('semantic_registry_record_invalid');
   row=value;previous=encoded;
  }
  const value=field==='kind'||field==='ordinal'?row![field]:row!.value[field];
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'&&typeof value!=='number')throw new Error('semantic_registry_field_invalid');
  return value;
 };
}
export function validateRegistrySelection(query:RegistrySelectionQuery):void{
 const text=(value:unknown)=>typeof value==='string'&&value.length>0;
 const valid=query.kind==='senseKey'?text(query.senseKey)
  :query.kind==='learningChoices'?typeof query.normalizedPrefix==='string'&&query.normalizedPrefix.length<=500&&text(query.languageTag)&&Number.isSafeInteger(query.offset)&&query.offset>=0&&Number.isSafeInteger(query.limit)&&query.limit>0&&query.limit<=41
  :query.kind==='expression'?text(query.normalizedForm)&&text(query.languageTag)&&sensaExpressionTypeSchema.safeParse(query.expressionType).success
  :query.kind==='binding'?isUuid(query.senseId)&&isUuid(query.expressionId)&&(query.relation===null||['realizes','approximates','evokes'].includes(query.relation))
  :query.kind==='bindingVersion'?isUuid(query.bindingId)&&isUuid(query.senseVersionId)&&isUuid(query.expressionVersionId)&&(query.coverage===null||['exact','broader','narrower','overlapping'].includes(query.coverage))
  :query.kind==='ordinal'&&kinds.includes(query.registryKind);
 if(!valid)throw new Error('semantic_registry_query_invalid');
}
export function registrySelectionSql(query:RegistrySelectionQuery):{sql:string;bind:unknown[]}{
 validateRegistrySelection(query);
 const source="table_name='semanticRegistry'",value=(field:string)=>`sensa_registry_field(value_json,'${field}')`;
 const order="ORDER BY sensa_registry_field(value_json,'ordinal'),record_key";
 switch(query.kind){
  case 'learningChoices':return {sql:`SELECT bv.record_key FROM sensa_records AS ev
   JOIN sensa_records AS expression ON expression.table_name='semanticRegistry' AND expression.record_key='expressions:'||sensa_registry_field(ev.value_json,'expressionId')
   JOIN sensa_records AS binding ON binding.table_name='semanticRegistry' AND sensa_registry_field(binding.value_json,'kind')='bindings' AND sensa_registry_field(binding.value_json,'expressionId')=sensa_registry_field(ev.value_json,'expressionId')
   JOIN sensa_records AS bv ON bv.table_name='semanticRegistry' AND bv.record_key='bindingVersions:'||sensa_registry_field(binding.value_json,'currentBindingVersionId')
   JOIN sensa_records AS sv ON sv.table_name='semanticRegistry' AND sv.record_key='senseVersions:'||sensa_registry_field(bv.value_json,'senseVersionId')
   WHERE ev.table_name='semanticRegistry' AND sensa_registry_field(ev.value_json,'kind')='expressionVersions'
    AND sensa_registry_field(ev.value_json,'normalizedForm')>=? AND sensa_registry_field(ev.value_json,'normalizedForm')<?
    AND sensa_registry_field(expression.value_json,'languageTag')=?
    AND sensa_registry_field(bv.value_json,'expressionVersionId')=sensa_registry_field(ev.value_json,'expressionVersionId')
    AND ((sensa_registry_field(binding.value_json,'relation') IS NULL AND sensa_registry_field(bv.value_json,'semanticCoverage') IS NULL) OR (sensa_registry_field(binding.value_json,'relation')='realizes' AND sensa_registry_field(bv.value_json,'semanticCoverage')='exact'))
    AND sensa_registry_field(bv.value_json,'reviewStatus')!='rejected' AND sensa_registry_field(sv.value_json,'reviewStatus')!='rejected'
   ORDER BY sensa_registry_field(ev.value_json,'normalizedForm'),bv.record_key LIMIT ? OFFSET ?`,bind:[query.normalizedPrefix,query.normalizedPrefix+'\u{10ffff}',query.languageTag,query.limit,query.offset]};
  case 'senseKey':return {sql:`SELECT record_key FROM sensa_records WHERE ${source} AND sensa_registry_field(value_json,'kind')='senses' AND ${value('senseKey')}=? ${order} LIMIT 2`,bind:[query.senseKey]};
  case 'expression':return {sql:`SELECT expression.record_key AS expression_key,version.record_key AS version_key FROM sensa_records AS version
   JOIN sensa_records AS expression ON expression.table_name='semanticRegistry' AND expression.record_key='expressions:'||sensa_registry_field(version.value_json,'expressionId')
   WHERE version.table_name='semanticRegistry' AND sensa_registry_field(version.value_json,'kind')='expressionVersions' AND sensa_registry_field(version.value_json,'normalizedForm')=?
    AND sensa_registry_field(expression.value_json,'languageTag')=? AND sensa_registry_field(expression.value_json,'expressionType')=?
   ORDER BY sensa_registry_field(expression.value_json,'ordinal'),sensa_registry_field(version.value_json,'ordinal'),expression.record_key,version.record_key LIMIT 1`,bind:[query.normalizedForm,query.languageTag,query.expressionType]};
  case 'binding':return {sql:`SELECT record_key FROM sensa_records WHERE ${source} AND sensa_registry_field(value_json,'kind')='bindings' AND ${value('senseId')}=? AND ${value('expressionId')}=? AND ${value('relation')} IS ? ${order} LIMIT 1`,bind:[query.senseId,query.expressionId,query.relation]};
  case 'bindingVersion':return {sql:`SELECT record_key FROM sensa_records WHERE ${source} AND sensa_registry_field(value_json,'kind')='bindingVersions' AND ${value('senseExpressionBindingId')}=? AND ${value('senseVersionId')}=? AND ${value('expressionVersionId')}=? AND ${value('semanticCoverage')} IS ? ${order} LIMIT 1`,bind:[query.bindingId,query.senseVersionId,query.expressionVersionId,query.coverage]};
  // An explicit indexed tail read stays bounded after cold OPFS reopen. MAX
  // over this decoded expression can choose a source scan despite the index.
  case 'ordinal':return {sql:`SELECT sensa_registry_field(value_json,'ordinal')+1 AS next_ordinal FROM sensa_records INDEXED BY sensa_registry_kind_ordinal WHERE ${source} AND sensa_registry_field(value_json,'kind')=? ORDER BY sensa_registry_field(value_json,'ordinal') DESC LIMIT 1`,bind:[query.registryKind]};
 }
}
export function registrySelectionResult(query:RegistrySelectionQuery,rows:Record<string,any>[]):RegistrySelection{
 if(query.kind==='ordinal'){
  const nextOrdinal=rows.length?rows[0]?.next_ordinal:0;if(!Number.isSafeInteger(nextOrdinal)||nextOrdinal<0)throw new Error('semantic_registry_ordinal_invalid');return {keys:[],nextOrdinal};
 }
 return {keys:query.kind==='expression'?rows.flatMap(row=>[String(row.expression_key),String(row.version_key)]):rows.map(row=>String(row.record_key))};
}
/** Faithful local test adapter; the production SQL path never enumerates rows. */
export function memoryRegistrySelection(query:RegistrySelectionQuery,rows:Array<{key:string;value:{kind:string;ordinal:number;value:Record<string,any>}}>):RegistrySelection{
 validateRegistrySelection(query);rows=[...rows].sort((a,b)=>a.value.ordinal-b.value.ordinal||a.key.localeCompare(b.key));
 const kind=(name:string)=>rows.filter(row=>row.value.kind===name);
 if(query.kind==='learningChoices'){
  const choices=kind('bindings').flatMap(binding=>{
   const b=binding.value.value,bv=kind('bindingVersions').find(row=>row.value.value.bindingVersionId===b.currentBindingVersionId);
   if(!bv||!((b.relation===null&&bv.value.value.semanticCoverage===null)||(b.relation==='realizes'&&bv.value.value.semanticCoverage==='exact'))||bv.value.value.reviewStatus==='rejected')return [];
   const ev=kind('expressionVersions').find(row=>row.value.value.expressionVersionId===bv.value.value.expressionVersionId&&row.value.value.expressionId===b.expressionId);
   const expression=kind('expressions').find(row=>row.value.value.expressionId===b.expressionId),sv=kind('senseVersions').find(row=>row.value.value.senseVersionId===bv.value.value.senseVersionId);
   return ev&&expression?.value.value.languageTag===query.languageTag&&sv&&sv.value.value.reviewStatus!=='rejected'&&ev.value.value.normalizedForm.startsWith(query.normalizedPrefix)?[{key:bv.key,form:ev.value.value.normalizedForm as string}]:[];
  }).sort((a,b)=>a.form<b.form?-1:a.form>b.form?1:a.key<b.key?-1:1);
  return {keys:choices.slice(query.offset,query.offset+query.limit).map(row=>row.key)};
 }
 if(query.kind==='ordinal')return {keys:[],nextOrdinal:Math.max(-1,...kind(query.registryKind).map(row=>row.value.ordinal))+1};
 if(query.kind==='expression'){
  for(const expression of kind('expressions'))if(expression.value.value.languageTag===query.languageTag&&expression.value.value.expressionType===query.expressionType){
   const version=kind('expressionVersions').find(row=>row.value.value.expressionId===expression.value.value.expressionId&&row.value.value.normalizedForm===query.normalizedForm);
   if(version)return {keys:[expression.key,version.key]};
  }
  return {keys:[]};
 }
 const found=kind(query.kind==='senseKey'?'senses':query.kind==='binding'?'bindings':'bindingVersions').filter(({value:{value}})=>query.kind==='senseKey'?value.senseKey===query.senseKey:query.kind==='binding'?value.senseId===query.senseId&&value.expressionId===query.expressionId&&value.relation===query.relation:value.senseExpressionBindingId===query.bindingId&&value.senseVersionId===query.senseVersionId&&value.expressionVersionId===query.expressionVersionId&&value.semanticCoverage===query.coverage);
 return {keys:found.slice(0,query.kind==='senseKey'?2:1).map(row=>row.key)};
}

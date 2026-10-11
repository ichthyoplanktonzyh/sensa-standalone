import {materialSourcePin,sameLearningSourcePin} from '../../../learning/runtime/learningIdentity';
import {z} from 'zod';

import type {LibraryRecordRows} from '../libraryRecordReader';
import type {PersonalContentRecord} from '../../../personalContent/system/personalContentSystem';
import type {Table} from '../store';
import {assertSceneAcceptance,assertSceneConflictHistory,sceneHistoryRecords,findSceneRevision} from '../../../personalContent/system/sceneConflictHistory';
import {hydrateMeaningContexts,type ContextRecord} from '../../../experience/personalMeaningJourney/contextRecords';
import {backupEqual} from '../backupCodec';

/** Validate Personal Content and its references into Semantic/Learning facts. */
export function* validatePersonalContentReplicaSteps(input:{rows:LibraryRecordRows;requireRow:(table:Table,id:string)=>any;fail:()=>never}){
 const {rows,requireRow,fail}=input,uuid=z.string().uuid();
 for(const {key,value:annotation} of rows.annotations as Iterable<{key:string;value:PersonalContentRecord}>){
  if(!annotation||annotation.id!==key||!['sense_note','saved_sense','saved_example','sense_context','learning_scene'].includes(annotation.kind))fail();
  const subject=annotation.kind==='learning_scene'?`${annotation.learningTargetId}:${annotation.languageRouteId}`:annotation.kind==='saved_example'?annotation.exampleId:annotation.kind==='sense_context'?annotation.contextId:annotation.senseId;
  if(key!==`${annotation.kind}:${encodeURIComponent(subject)}`)fail();
  if(annotation.kind==='sense_note'){z.string().min(1).max(2000).parse(annotation.senseId);z.string().max(1000).parse(annotation.body);z.number().int().positive().parse(annotation.revision);z.number().int().nonnegative().parse(annotation.createdAt);z.number().int().nonnegative().parse(annotation.updatedAt);}
  if(annotation.kind==='saved_sense'){z.string().min(1).max(2000).parse(annotation.senseId);z.number().int().nonnegative().parse(annotation.createdAt);}
  if(annotation.kind==='saved_example'){z.string().min(1).max(2000).parse(annotation.exampleId);z.number().int().nonnegative().parse(annotation.createdAt);}
  if(annotation.kind==='sense_context'){
   uuid.parse(annotation.contextId);z.string().min(1).max(2000).parse(annotation.senseId);z.string().max(1000).parse(annotation.body);z.number().int().positive().parse(annotation.revision);z.number().int().nonnegative().parse(annotation.createdAt);z.number().int().nonnegative().parse(annotation.updatedAt);
   z.array(z.object({mediaId:uuid,kind:z.literal('image'),dataUrl:z.string().startsWith('data:image/').max(8*1024*1024),mimeType:z.string().min(1).max(200),fileName:z.string().min(1).max(500),altText:z.string().max(80)}).strict()).max(3).parse(annotation.media);
   if(!annotation.body.trim()&&!annotation.media.length)fail();
  }
  if(annotation.kind==='learning_scene'){
   assertSceneConflictHistory(annotation);
   uuid.parse(annotation.sceneId);uuid.parse(annotation.learningTargetId);uuid.parse(annotation.languageRouteId);uuid.parse(annotation.senseId);uuid.parse(annotation.expressionId);z.number().int().positive().parse(annotation.currentRevision);z.number().int().nonnegative().parse(annotation.createdAt);z.number().int().nonnegative().parse(annotation.updatedAt);
   const target=requireRow('learningTargets',annotation.learningTargetId),membershipIds=new Set(target.curriculumMemberships.filter((membership:any)=>membership.languageContext.languageRouteId===annotation.languageRouteId).map((membership:any)=>membership.id));
   for(const snapshot of sceneHistoryRecords(annotation))for(const revision of snapshot.revisions)if(!membershipIds.has(revision.curriculumMembershipId)||!sameLearningSourcePin(revision.sourcePin,materialSourcePin(target.curriculumMemberships.find((row:any)=>row.id===revision.curriculumMembershipId).material)))fail();
   for(const snapshot of sceneHistoryRecords(annotation))if(snapshot.acceptedPersonalMeaningId)assertSceneAcceptance(snapshot,requireRow('semanticMeanings',snapshot.acceptedPersonalMeaningId));
   if(target.identity.senseId!==annotation.senseId||target.identity.expressionId!==annotation.expressionId||annotation.revisions.length!==annotation.currentRevision||new Set(annotation.revisions.map(revision=>revision.revisionId)).size!==annotation.revisions.length)fail();
   for(const [index,revision] of annotation.revisions.entries()){
    uuid.parse(revision.revisionId);if(revision.revision!==index+1||!membershipIds.has(revision.curriculumMembershipId))fail();z.string().max(1000).parse(revision.body);z.number().int().nonnegative().parse(revision.createdAt);
    z.array(z.object({mediaId:uuid,kind:z.literal('image'),dataUrl:z.string().startsWith('data:image/').max(8*1024*1024),mimeType:z.string().min(1).max(200),fileName:z.string().min(1).max(500),altText:z.string().max(80)}).strict()).max(3).parse(revision.media);
    if(!revision.body.trim()&&!revision.media.length)fail();
   }
   if((annotation.acceptedRevisionId===null)!==(annotation.acceptedPersonalMeaningId===null)||annotation.acceptedRevisionId!==null&&!annotation.revisions.some(revision=>revision.revisionId===annotation.acceptedRevisionId))fail();
   if(annotation.acceptedPersonalMeaningId!==null)uuid.parse(annotation.acceptedPersonalMeaningId);
  }
  yield;
 }
 const scenes=new Map([...rows.annotations].flatMap(({value})=>value?.kind==='learning_scene'?[[value.sceneId,value] as const]:[]));
 for(const {value} of rows.semanticContexts){
  const context=value as ContextRecord;if(context.kind!=='anchorRevisions')continue;
  const pin=context.value.structuredPayload.learningScene as {sceneId:string;revisionId:string;revision:number;learningTargetId:string;curriculumMembershipId:string}|undefined;
  if(!pin)continue;
  const scene=scenes.get(pin.sceneId)??fail(),revision=findSceneRevision(scene,pin)??fail();
  if(pin.learningTargetId!==scene.learningTargetId||pin.curriculumMembershipId!==revision.curriculumMembershipId||context.value.bodyText!==(revision.body.trim()||null)||!backupEqual(context.value.structuredPayload.media,revision.media))fail();
  yield;
 }
}

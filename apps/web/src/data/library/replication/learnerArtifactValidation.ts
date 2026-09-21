import {z} from 'zod';

import type {BackupRows} from '../backupValidation';
import type {ContentAnnotation} from '../contentAnnotations';
import type {Table} from '../store';

/** Validate learner-owned annotations and their references into Semantic/Learning facts. */
export function validateLearnerArtifactReplica(input:{rows:BackupRows;requireRow:(table:Table,id:string)=>any;fail:()=>never}){
 const {rows,requireRow,fail}=input,uuid=z.string().uuid();
 for(const {key,value:annotation} of rows.annotations as {key:string;value:ContentAnnotation}[]){
  if(!annotation||annotation.id!==key||!['sense_note','saved_sense','saved_example','semantic_anchor','learning_scene'].includes(annotation.kind))fail();
  if(annotation.kind==='sense_note'){z.string().min(1).max(2000).parse(annotation.senseId);z.string().min(1).max(1000).parse(annotation.body);z.number().int().nonnegative().parse(annotation.updatedAt);}
  if(annotation.kind==='saved_sense'){z.string().min(1).max(2000).parse(annotation.senseId);z.number().int().nonnegative().parse(annotation.createdAt);}
  if(annotation.kind==='saved_example'){z.string().min(1).max(2000).parse(annotation.exampleId);z.number().int().nonnegative().parse(annotation.createdAt);}
  if(annotation.kind==='semantic_anchor'){
   uuid.parse(annotation.anchorId);z.string().min(1).max(2000).parse(annotation.senseId);z.string().max(1000).parse(annotation.body);z.number().int().nonnegative().parse(annotation.createdAt);z.number().int().nonnegative().parse(annotation.updatedAt);
   z.array(z.object({mediaId:uuid,kind:z.literal('image'),dataUrl:z.string().startsWith('data:image/').max(8*1024*1024),mimeType:z.string().min(1).max(200),fileName:z.string().min(1).max(500),altText:z.string().max(80)}).strict()).max(3).parse(annotation.media);
   if(!annotation.body.trim()&&!annotation.media.length)fail();
  }
  if(annotation.kind==='learning_scene'){
   uuid.parse(annotation.sceneId);uuid.parse(annotation.learningTargetId);uuid.parse(annotation.languageRouteId);uuid.parse(annotation.senseId);uuid.parse(annotation.senseVersionId);uuid.parse(annotation.bindingVersionId);z.number().int().positive().parse(annotation.currentRevision);z.number().int().nonnegative().parse(annotation.createdAt);z.number().int().nonnegative().parse(annotation.updatedAt);
   const target=requireRow('learningTargets',annotation.learningTargetId),membershipIds=new Set(target.curriculumMemberships.filter((membership:any)=>membership.languageContext.languageRouteId===annotation.languageRouteId).map((membership:any)=>membership.id));
   if(target.identity.senseId!==annotation.senseId||target.identity.senseVersionId!==annotation.senseVersionId||target.identity.bindingVersionId!==annotation.bindingVersionId||annotation.revisions.length!==annotation.currentRevision||new Set(annotation.revisions.map(revision=>revision.revisionId)).size!==annotation.revisions.length)fail();
   for(const [index,revision] of annotation.revisions.entries()){
    uuid.parse(revision.revisionId);if(revision.revision!==index+1||!membershipIds.has(revision.curriculumMembershipId))fail();z.string().max(1000).parse(revision.body);z.number().int().nonnegative().parse(revision.createdAt);
    z.array(z.object({mediaId:uuid,kind:z.literal('image'),dataUrl:z.string().startsWith('data:image/').max(8*1024*1024),mimeType:z.string().min(1).max(200),fileName:z.string().min(1).max(500),altText:z.string().max(80)}).strict()).max(3).parse(revision.media);
    if(!revision.body.trim()&&!revision.media.length)fail();
   }
   if((annotation.acceptedRevisionId===null)!==(annotation.acceptedPersonalMeaningId===null)||annotation.acceptedRevisionId!==null&&!annotation.revisions.some(revision=>revision.revisionId===annotation.acceptedRevisionId))fail();
   if(annotation.acceptedPersonalMeaningId!==null)uuid.parse(annotation.acceptedPersonalMeaningId);
  }
 }
}


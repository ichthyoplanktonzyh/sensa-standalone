import {stableLearningTargetId} from '../../learning/runtime/learningIdentity';
import {z} from 'zod';
import {stableUuid,canonicalJsonDigest} from '@sensa/learning-kernel';
import {sensaFormalPinnedLanguageContextSchema,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {isDirectProvisioningReference,provisioningMembershipId,provisioningTaskId,type ContentProvisioningTask} from '../../contentSupply/provisioning/contracts';
import {curriculumEnrollmentSchema,type LocalCurriculumEnrollment} from './curriculumEnrollments';
import {curriculumSourceEligibility,planningMembershipForContext} from '../../learning/runtime/curriculumEligibility';
import type {LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {backupEqual} from './backupCodec';
import type {LibraryTransaction} from './store';

const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
export const supplementalSourceReferenceSchema=z.object({kind:z.enum(['stable_sense','personal_meaning_alignment']),id:uuid}).strict();
export type SupplementalSourceReference=z.infer<typeof supplementalSourceReferenceSchema>;
/** Only explicit learner decisions are stored. Absence means the accepted
 * original source remains active; material and Content Supply status are not
 * Curriculum governance. */
export const supplementalMembershipStateSchema=z.object({
 format:z.literal('sensa-supplemental-membership-state-v1'),id:uuid,revision:z.number().int().positive(),
 learnerUserId:uuid,targetId:uuid,source:supplementalSourceReferenceSchema,
 languageContext:sensaFormalPinnedLanguageContextSchema,status:z.enum(['active','removed']),
 createdByOperationId:uuid,changedByOperationId:uuid,createdAt:timestamp,updatedAt:timestamp,
}).strict().superRefine((state,context)=>{
 if(Date.parse(state.updatedAt)<Date.parse(state.createdAt)||state.revision===1&&(state.status!=='removed'||state.changedByOperationId!==state.createdByOperationId||state.updatedAt!==state.createdAt))context.addIssue({code:'custom',message:'Supplemental Membership decision is inconsistent'});
});
export type SupplementalMembershipState=z.infer<typeof supplementalMembershipStateSchema>;
export type SupplementalSourceDescriptor={id:string;targetId:string;source:SupplementalSourceReference;languageContext:SensaFormalPinnedLanguageContext;expression:string};

/** Resolve an already accepted intent, including one without ready material. */
export function supplementalSourceDescriptor(source:SupplementalSourceReference,raw:unknown,learnerId:string):SupplementalSourceDescriptor{
 supplementalSourceReferenceSchema.parse(source);
 if(source.kind==='stable_sense'){
  const enrollment=curriculumEnrollmentSchema.parse(raw);
  if(enrollment.id!==source.id||enrollment.learnerUserId!==learnerId||enrollment.source.kind!=='stable_sense'||enrollment.status!=='active')throw new Error('localFlow.invalidTarget');
  const reference=enrollment.source.selection.reference;
  const targetId=stableLearningTargetId(learnerId,reference.senseId,reference.expressionId);
  return {id:stableUuid(`local-curriculum-membership:${targetId}:${enrollment.languageContext.languageRouteId}:stable_sense:${source.id}`),targetId,source,languageContext:enrollment.languageContext,expression:enrollment.source.selection.expression.surfaceForm};
 }
 const task=raw as ContentProvisioningTask|undefined;
 if(!task||task.id!==source.id||isDirectProvisioningReference(task.source)||task.id!==provisioningTaskId(task.source,task.languageContext.languageRouteId))throw new Error('localFlow.invalidTarget');
 const targetId=stableLearningTargetId(learnerId,task.source.senseId,task.source.expressionId);
 const id=provisioningMembershipId(task.source,targetId,task.languageContext.languageRouteId);
 if(task.targetId!==targetId||task.curriculumMembershipId!==id)throw new Error('localFlow.invalidTarget');
 return {id,targetId,source,languageContext:sensaFormalPinnedLanguageContextSchema.parse(task.languageContext),expression:''};
}
export function assertSupplementalStateSource(state:SupplementalMembershipState,descriptor:SupplementalSourceDescriptor):void{
 if(state.id!==descriptor.id||state.targetId!==descriptor.targetId||!backupEqual(state.source,descriptor.source)||state.languageContext.languageRouteId!==descriptor.languageContext.languageRouteId||state.languageContext.targetLanguageTag!==descriptor.languageContext.targetLanguageTag)throw new Error('localFlow.invalidTarget');
}
const sourceTable=(source:SupplementalSourceReference)=>source.kind==='stable_sense'?'curriculumEnrollments' as const:'personalLearning' as const;
export async function readSupplementalSource(tx:Pick<LibraryTransaction,'get'>,source:SupplementalSourceReference,learnerId:string){
 return supplementalSourceDescriptor(source,await tx.get(sourceTable(source),source.id),learnerId);
}
export async function assertSupplementalMembershipActive(tx:Pick<LibraryTransaction,'get'>,membershipId:string):Promise<void>{
 const state=await tx.get<SupplementalMembershipState>('supplementalMembershipStates',membershipId);
 if(state&&supplementalMembershipStateSchema.parse(state).status==='removed')throw new Error('localFlow.membershipRemoved');
}
export type ChangeSupplementalMembershipInput={operationId:string;source:SupplementalSourceReference;expectedRevision:number;active:boolean;languageContext:SensaFormalPinnedLanguageContext};
export async function changeSupplementalMembership(input:ChangeSupplementalMembershipInput):Promise<boolean>{
 const [{learningCommand},{learningOwner},{requireLanguageRouteContext}]=await Promise.all([import('./learningAdmission'),import('./libraryOwnership'),import('./language')]);
 return learningCommand({id:input.operationId,kind:'learning.changeSupplementalMembership',input},async tx=>{
  const owner=await learningOwner(tx),context=sensaFormalPinnedLanguageContextSchema.parse(input.languageContext);
  await requireLanguageRouteContext(tx,context);
  const descriptor=await readSupplementalSource(tx,input.source,owner.learnerId),pair=descriptor.languageContext;
  if(pair.languageRouteId!==context.languageRouteId||pair.targetLanguageTag!==context.targetLanguageTag||pair.supportLanguageTag!==context.supportLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
  const raw=await tx.get('supplementalMembershipStates',descriptor.id),before=raw?supplementalMembershipStateSchema.parse(raw):undefined;
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||(before?.revision??0)!==input.expectedRevision)throw new Error('localFlow.membershipChanged');
  if(before)assertSupplementalStateSource(before,descriptor);
  const status=input.active?'active':'removed';
  if((before?.status??'active')===status)return true;
  const now=new Date().toISOString();
  tx.put('supplementalMembershipStates',descriptor.id,supplementalMembershipStateSchema.parse({
   ...before,format:'sensa-supplemental-membership-state-v1',id:descriptor.id,targetId:descriptor.targetId,source:descriptor.source,languageContext:pair,learnerUserId:owner.learnerId,
   revision:(before?.revision??0)+1,status,createdByOperationId:before?.createdByOperationId??input.operationId,changedByOperationId:input.operationId,createdAt:before?.createdAt??now,updatedAt:now,
  }));
  return true;
 });
}

/** Exact referenced-source reads, never a collection scan during Add or preparation. */
export async function currentPlanningMembership(tx:Pick<LibraryTransaction,'get'>,target:LocalLearningTarget,context:SensaFormalPinnedLanguageContext){
 const enrollments=new Map<string,LocalCurriculumEnrollment>(),caps:Record<string,{introduce:boolean;ongoing:boolean}>={};
 for(const member of target.curriculumMemberships){
  const id=member.provenance.curriculumEnrollmentId;
  if(typeof id==='string'&&!enrollments.has(id)){const enrollment=await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',id);if(enrollment)enrollments.set(id,enrollment);}
  const state=await tx.get<SupplementalMembershipState>('supplementalMembershipStates',member.id);
  caps[member.id]=state?.status==='removed'?{introduce:false,ongoing:false}:curriculumSourceEligibility(member,typeof id==='string'?enrollments.get(id):undefined,!!target.startedAt);
 }
 return planningMembershipForContext(target,context,enrollments,()=>true,caps);
}
export type SupplementalMembershipProjection=SupplementalSourceDescriptor&{revision:number;active:boolean;readiness:'ready'|'preparing'|'blocked'};
export type SupplementalMembershipPage={members:readonly SupplementalMembershipProjection[];nextCursor:string|null};
export async function readSupplementalMemberships(context:SensaFormalPinnedLanguageContext,cursor:string|null=null):Promise<SupplementalMembershipPage>{
 const [{assertCurrentLibrary,readLibrary},{learningOwner}]=await Promise.all([import('./store'),import('./libraryOwnership')]);
 return readLibrary(async tx=>{
  await assertCurrentLibrary(tx);const owner=await learningOwner(tx),result:SupplementalMembershipProjection[]=[];
  const direction=canonicalJsonDigest(context);
  const position=cursor?z.object({direction:z.literal(direction),source:supplementalSourceReferenceSchema}).strict().parse(JSON.parse(cursor)):null;
  for(const kind of ['stable_sense','personal_meaning_alignment'] as const){
   if(position?.source.kind==='personal_meaning_alignment'&&kind==='stable_sense')continue;
   const table=kind==='stable_sense'?'curriculumEnrollments':'personalLearning';
   for await(const batch of tx.entryBatches(table,position?.source.kind===kind?position.source.id:null))for(const row of batch){
   const raw=row.value as LocalCurriculumEnrollment|ContentProvisioningTask;
   if(kind==='stable_sense'&&('source'in raw&&'kind'in raw.source&&raw.source.kind!=='stable_sense')||kind==='personal_meaning_alignment'&&isDirectProvisioningReference((raw as ContentProvisioningTask).source))continue;
   const source={kind,id:row.key},descriptor=supplementalSourceDescriptor(source,raw,owner.learnerId),pair=descriptor.languageContext;
   if(pair.languageRouteId!==context.languageRouteId||pair.targetLanguageTag!==context.targetLanguageTag||pair.supportLanguageTag!==context.supportLanguageTag)continue;
   if(result.length===50)return {members:result,nextCursor:JSON.stringify({direction,source:result.at(-1)!.source})};
   const state=await tx.get<SupplementalMembershipState>('supplementalMembershipStates',descriptor.id),target=await tx.get<LocalLearningTarget>('learningTargets',descriptor.targetId);
   const task=source.kind==='personal_meaning_alignment'?await tx.get<ContentProvisioningTask>('personalLearning',source.id):await tx.get<ContentProvisioningTask>('personalLearning',stableUuid(`sensa-direct-provisioning:${source.id}`));
   const readiness=target?.curriculumMemberships.some(member=>member.id===descriptor.id)?'ready':task&&['failed','rejected','stopped'].includes(task.status)?'blocked':'preparing';
   let expression=descriptor.expression||target?.expression||'';
   if(!expression&&task&&!isDirectProvisioningReference(task.source)){
    const binding=await tx.get<{expressionVersionId:string}>('semanticRegistry',`bindingVersions:${task.source.bindingVersionId}`);
    if(binding){const version=await tx.get<{surfaceForm:string}>('semanticRegistry',`expressionVersions:${binding.expressionVersionId}`);expression=version?.surfaceForm??'';}
   }
   result.push({...descriptor,expression,revision:state?.revision??0,active:state?.status!=='removed',readiness});
   }
  }
  return {members:result,nextCursor:null};
 });
}

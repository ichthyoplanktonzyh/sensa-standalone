import {z} from 'zod';
import {canonicalJsonDigest,stableUuid} from '@sensa/learning-kernel';
import {sensaFormalPinnedLanguageContextSchema,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {LEARNING_PROTOCOL_PURPOSES,learningPolicyProfileRegistry,type LearningProtocolPurpose} from '../../learning/runtime/policyProfiles';
import {inspectLocalTargetReadiness} from '../../learning/runtime/runtimeCoordinator';
import {curriculumSourceEligibility} from '../../learning/runtime/curriculumEligibility';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import type {LocalLearningTarget,LocalLearningRun,LocalCurriculumMembership} from '../../learning/runtime/localProtocol';
import type {InstalledPackage} from './packageRecords';
import {curriculumEnrollmentSchema,type LocalCurriculumEnrollment} from './curriculumEnrollments';
import type {LibraryTransaction} from './store';

const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
const planSchema=z.object({
 revisionId:uuid,purpose:z.enum(LEARNING_PROTOCOL_PURPOSES),readiness:z.enum(['ready','blocked']),
 profileId:z.string().min(1),profileVersion:z.string().min(1),
 protocolId:z.string().min(1),protocolVersion:z.string().min(1),runtimeAdapterId:z.string().min(1),
 contentDemands:z.array(z.object({contentDemandKey:z.string().min(1),definitionVersion:z.string().min(1)}).strict()),
 materializationIds:z.array(uuid),reason:z.string().nullable(),
}).strict();
const sourceSchema=z.object({
 membershipId:uuid,membershipRevision:z.number().int().positive(),sourceKind:z.enum(['sense_learning_package','personal_meaning_alignment','stable_sense']),
 membershipStatus:z.enum(['active','superseded']),
 enrollmentId:uuid.nullable(),packageKey:z.string().nullable(),assurancePackageKey:z.string().optional(),
 provenance:z.record(z.string(),z.unknown()),introduce:z.boolean(),ongoing:z.boolean(),
 plans:z.array(planSchema).length(LEARNING_PROTOCOL_PURPOSES.length),
}).strict();
const memberSchema=z.object({
 targetId:uuid,retentionTargetId:uuid,
 senseId:z.string().min(1),senseVersionId:uuid,bindingId:z.string().min(1),bindingVersionId:uuid,
 policy:z.object({assignmentId:uuid,assignmentRevision:z.number().int().positive(),profileId:z.string().min(1),profileVersion:z.string().min(1)}).strict(),
 sources:z.array(sourceSchema).min(1),
}).strict();
export const studyScopeSchema=z.object({
 format:z.literal('sensa-study-scope-v1'),id:uuid,learnerUserId:uuid,
 definitionDigest:z.string().regex(/^[a-f0-9]{64}$/u),
 createdByOperationId:uuid,createdAt:timestamp,languageContext:sensaFormalPinnedLanguageContextSchema,
 dailyNewSenseLimit:z.number().int().min(1).max(100),
 enrollments:z.array(curriculumEnrollmentSchema),members:z.array(memberSchema),
}).strict().superRefine((scope,context)=>{
 const {id,createdAt,createdByOperationId,definitionDigest,...body}=scope;
 if(definitionDigest!==canonicalJsonDigest(body)||id!==stableUuid(`local-study-scope:${createdByOperationId}:${definitionDigest}`))context.addIssue({code:'custom',message:'Study Scope identity differs from its immutable snapshot'});
 if(new Set(scope.members.map(member=>member.targetId)).size!==scope.members.length||new Set(scope.members.map(member=>member.retentionTargetId)).size!==scope.members.length)context.addIssue({code:'custom',message:'Study Scope must deduplicate Retention Targets'});
 if(new Set(scope.enrollments.map(enrollment=>enrollment.id)).size!==scope.enrollments.length)context.addIssue({code:'custom',message:'Study Scope source snapshot is duplicated'});
 const enrollmentIds=new Set(scope.enrollments.map(enrollment=>enrollment.id));
 for(const member of scope.members){
  if(new Set(member.sources.map(source=>source.membershipId)).size!==member.sources.length)context.addIssue({code:'custom',message:'Study Scope membership is duplicated'});
  for(const source of member.sources){
   if(source.enrollmentId&&!enrollmentIds.has(source.enrollmentId)||!source.introduce&&!source.ongoing||new Set(source.plans.map(plan=>plan.purpose)).size!==LEARNING_PROTOCOL_PURPOSES.length)context.addIssue({code:'custom',message:'Study Scope source eligibility is inconsistent'});
   for(const plan of source.plans)if(plan.profileId!==member.policy.profileId||plan.profileVersion!==member.policy.profileVersion||plan.readiness==='ready'&&(!plan.materializationIds.length||plan.reason!==null))context.addIssue({code:'custom',message:'Study Scope resolved plan is inconsistent'});
  }
 }
});
export type LocalStudyScope=z.infer<typeof studyScopeSchema>;
export type LocalStudyScopeMember=LocalStudyScope['members'][number];
export type StudyScopeSource=LocalStudyScope['members'][number]['sources'][number];
const persistedScopes=new WeakSet<object>();
const captureWitnesses=new WeakMap<LibraryTransaction,Set<string>>();
export const hasStudyScopeCaptureWitness=(tx:LibraryTransaction,id:string)=>captureWitnesses.get(tx)?.has(id)??false;

/** Resolve the entire admitted Target inventory, not the next-card prefix.
 * An unmaterialized Book member remains an Enrollment intent, not a fabricated
 * ready Target. Purpose readiness and source/policy references are frozen here;
 * actual Encounter material is resolved separately when its Run starts. */
export async function captureStudyScope(tx:LibraryTransaction,input:{operationId:string;learnerId:string;context:SensaFormalPinnedLanguageContext;dailyLimit:number;at:string}):Promise<LocalStudyScope>{
 const context=sensaFormalPinnedLanguageContextSchema.parse(input.context);
 const enrollments=await tx.all<LocalCurriculumEnrollment>('curriculumEnrollments');
 const byEnrollment=new Map(enrollments.map(enrollment=>[enrollment.id,enrollment]));
 const usedEnrollments=new Set<string>(),members:LocalStudyScope['members']=[];
 const resources=new Map<string,InstalledPackage|undefined>();
 let until=performance.now()+8;
 for await(const batch of tx.entryBatches('learningTargets'))for(const row of batch){
  const target=row.value as LocalLearningTarget;
  if(hasDeclaredMasteryOverride(target))continue;
  const profile=learningPolicyProfileRegistry.get(target.committedPolicy?.profileId??target.policyAssignment.profileId,target.committedPolicy?.profileVersion);
  const sources:StudyScopeSource[]=[];
  for(const membership of target.curriculumMemberships){
   const pair=membership.languageContext;
   if(pair.languageRouteId!==context.languageRouteId||pair.targetLanguageTag!==context.targetLanguageTag||pair.supportLanguageTag!==context.supportLanguageTag)continue;
   const enrollmentId=typeof membership.provenance.curriculumEnrollmentId==='string'?membership.provenance.curriculumEnrollmentId:null;
   const eligibility=curriculumSourceEligibility(membership,enrollmentId?byEnrollment.get(enrollmentId):undefined,!!target.startedAt);
   if(!eligibility.introduce&&!eligibility.ongoing)continue;
   let resource:InstalledPackage|undefined;
   if(membership.assurancePackageKey&&membership.packageKey){
    if(!resources.has(membership.packageKey))resources.set(membership.packageKey,await tx.get<InstalledPackage>('packageCache',membership.packageKey));
    resource=resources.get(membership.packageKey);
   }
   const plans=LEARNING_PROTOCOL_PURPOSES.map(purpose=>{
    const ready=inspectLocalTargetReadiness(target,membership,resource,purpose),binding=profile.protocols[purpose];
    const reference={purpose,readiness:ready.status,profileId:profile.profileId,profileVersion:profile.profileVersion,protocolId:binding.protocolId,protocolVersion:binding.protocolVersion,runtimeAdapterId:binding.runtimeAdapterId,contentDemands:[...structuredClone(binding.contentDemands)],materializationIds:[...ready.materializationIds],reason:ready.reason};
    return {...reference,revisionId:stableUuid(`local-scope-plan:${target.id}:${membership.id}:${canonicalJsonDigest(reference)}`)};
   });
   if(enrollmentId)usedEnrollments.add(enrollmentId);
   sources.push({membershipId:membership.id,membershipRevision:membership.revision,membershipStatus:membership.status??'active',sourceKind:membership.sourceKind,enrollmentId,packageKey:membership.packageKey,...(membership.assurancePackageKey?{assurancePackageKey:membership.assurancePackageKey}:{}),provenance:structuredClone(membership.provenance),introduce:eligibility.introduce,ongoing:eligibility.ongoing||eligibility.introduce,plans});
  }
  if(sources.length)members.push({targetId:target.id,retentionTargetId:target.retentionId,senseId:target.identity.senseId,senseVersionId:target.identity.senseVersionId,bindingId:target.identity.senseExpressionBindingId,bindingVersionId:target.identity.bindingVersionId,policy:{assignmentId:target.policyAssignment.assignmentId,assignmentRevision:target.policyAssignment.revision,profileId:profile.profileId,profileVersion:profile.profileVersion},sources});
  if(performance.now()>=until){await new Promise<void>(resolve=>setTimeout(resolve,0));until=performance.now()+8;}
 }
 const body={format:'sensa-study-scope-v1' as const,learnerUserId:input.learnerId,languageContext:context,dailyNewSenseLimit:input.dailyLimit,enrollments:enrollments.filter(enrollment=>usedEnrollments.has(enrollment.id)||enrollment.languageContext.languageRouteId===context.languageRouteId&&enrollment.languageContext.targetLanguageTag===context.targetLanguageTag&&enrollment.languageContext.supportLanguageTag===context.supportLanguageTag),members};
 const definitionDigest=canonicalJsonDigest(body),cacheKey=`study-scope-definition:${definitionDigest}`;
 const cachedId=await tx.get<string>('meta',cacheKey),existing=cachedId?await tx.get('studyScopes',cachedId):undefined;
 if(existing){const scope=studyScopeSchema.parse(existing);if(scope.definitionDigest!==definitionDigest)throw new Error('localFlow.progressReadFailed');if(Date.parse(scope.createdAt)<=Date.parse(input.at)){persistedScopes.add(scope);return scope;}}
 const id=stableUuid(`local-study-scope:${input.operationId}:${definitionDigest}`);
 tx.put('meta',cacheKey,id);
 const scope=studyScopeSchema.parse({...body,id,definitionDigest,createdByOperationId:input.operationId,createdAt:input.at});
 const captured=captureWitnesses.get(tx)??new Set<string>();captured.add(scope.id);captureWitnesses.set(tx,captured);
 return scope;
}

/** Current Target state chooses purpose, but never changes the frozen sources. */
export function scopedMembership(member:LocalStudyScopeMember|null|undefined,target:LocalLearningTarget,purpose:LearningProtocolPurpose):LocalCurriculumMembership|undefined{
 if(!member||member.retentionTargetId!==target.retentionId)return undefined;
 const policy=target.committedPolicy?.profileId??target.policyAssignment.profileId;
 if(member.policy.profileId!==policy)return undefined;
 return [...member.sources].reverse().flatMap(source=>{
  const eligible=target.startedAt?source.ongoing:source.introduce;
  const plan=source.plans.find(plan=>plan.purpose===purpose);
  const membership=target.curriculumMemberships.find(membership=>membership.id===source.membershipId);
  return eligible&&plan?.readiness==='ready'&&membership?[membership]:[];
 })[0];
}

export const learningSessionSchema=z.object({
 format:z.literal('sensa-learning-session-v1'),id:uuid,revision:z.number().int().positive(),learnerUserId:uuid,
 scopeRevisionId:uuid,languageContext:sensaFormalPinnedLanguageContextSchema,intent:z.enum(['mixed','review_only']),
 dailyNewSenseLimit:z.number().int().min(1).max(100),
 startedByOperationId:uuid,startedAt:timestamp,runIds:z.array(uuid).min(1),activeRunId:uuid.nullable(),
 endedAt:timestamp.nullable(),endedByOperationId:uuid.nullable(),endReason:z.enum(['learner_finished','learner_ended','session_switch','planning_override','plan_change']).nullable(),
}).strict().superRefine((session,context)=>{
 if(session.id!==stableUuid(`local-learning-session:${session.startedByOperationId}`)||new Set(session.runIds).size!==session.runIds.length||session.activeRunId&&!session.runIds.includes(session.activeRunId)||!!session.endedAt!==!!session.endedByOperationId||!!session.endedAt!==!!session.endReason||session.endedAt&&(Date.parse(session.endedAt)<Date.parse(session.startedAt)||session.activeRunId!==null))context.addIssue({code:'custom',message:'Learning Session lifecycle is inconsistent'});
});
export type LocalLearningSession=z.infer<typeof learningSessionSchema>;
export const activeLearningSessionKey='learning-session-active';
export async function readActiveLearningSessionHeader(tx:Pick<LibraryTransaction,'get'>):Promise<LocalLearningSession|null>{
 const id=await tx.get<string>('meta',activeLearningSessionKey);if(!id)return null;
 const raw=await tx.get('learningSessions',id);if(!raw)throw new Error('localFlow.progressReadFailed');
 const session=learningSessionSchema.parse(raw);if(session.endedAt)throw new Error('localFlow.progressReadFailed');return session;
}
export async function readActiveLearningSession(tx:Pick<LibraryTransaction,'get'>):Promise<{session:LocalLearningSession;scope:LocalStudyScope}|null>{
 const session=await readActiveLearningSessionHeader(tx);if(!session)return null;
 const scope=studyScopeSchema.parse(await tx.get('studyScopes',session.scopeRevisionId));
 if(session.learnerUserId!==scope.learnerUserId||canonicalJsonDigest(session.languageContext)!==canonicalJsonDigest(scope.languageContext)||session.dailyNewSenseLimit!==scope.dailyNewSenseLimit)throw new Error('localFlow.progressReadFailed');
 return {session,scope};
}
export function endLearningSession(tx:LibraryTransaction,session:LocalLearningSession,operationId:string,at:string,reason:NonNullable<LocalLearningSession['endReason']>):void{
 if(session.endedAt)return;
 tx.put('learningSessions',session.id,learningSessionSchema.parse({...session,revision:session.revision+1,activeRunId:null,endedAt:at,endedByOperationId:operationId,endReason:reason}));
 tx.delete('meta',activeLearningSessionKey);
}
export function focusLearningSession(tx:LibraryTransaction,session:LocalLearningSession,run:LocalLearningRun):void{
 tx.put('learningSessions',session.id,learningSessionSchema.parse({...session,revision:session.revision+1,runIds:session.runIds.includes(run.id)?session.runIds:[...session.runIds,run.id],activeRunId:run.id}));
 tx.put('meta',activeLearningSessionKey,session.id);
}

export function createLearningSession(tx:LibraryTransaction,scope:LocalStudyScope,run:LocalLearningRun,operationId:string,intent:LocalLearningSession['intent'],at:string):LocalLearningSession{
 const session=learningSessionSchema.parse({format:'sensa-learning-session-v1',id:stableUuid(`local-learning-session:${operationId}`),revision:1,learnerUserId:scope.learnerUserId,scopeRevisionId:scope.id,languageContext:scope.languageContext,dailyNewSenseLimit:scope.dailyNewSenseLimit,intent,startedByOperationId:operationId,startedAt:at,runIds:[run.id],activeRunId:run.id,endedAt:null,endedByOperationId:null,endReason:null});
 if(!persistedScopes.has(scope))tx.put('studyScopes',scope.id,scope);
 tx.put('learningSessions',session.id,session);tx.put('meta',activeLearningSessionKey,session.id);
 return session;
}

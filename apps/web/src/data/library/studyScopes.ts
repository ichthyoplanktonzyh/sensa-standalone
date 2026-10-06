import {z} from 'zod';
import {canonicalJsonDigest,stableUuid} from '@sensa/learning-kernel';
import {sensaFormalPinnedLanguageContextSchema,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {LEARNING_PROTOCOL_PURPOSES,type LearningProtocolPurpose} from '../../learning/runtime/policyProfiles';
import {studyScopeMemberIdentity,studyScopeSourceSnapshot} from './studyScopeSources';
import {inspectLocalTargetReadiness} from '../../learning/runtime/runtimeCoordinator';
import {curriculumSourceEligibility,planningMembershipForContext} from '../../learning/runtime/curriculumEligibility';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import type {LocalLearningTarget,LocalLearningRun,LocalCurriculumMembership} from '../../learning/runtime/localProtocol';
import type {InstalledPackage} from './packageRecords';
import {curriculumEnrollmentSchema,type LocalCurriculumEnrollment} from './curriculumEnrollments';
import type {LibraryTransaction} from './store';
import {supplementalMembershipStateSchema,type SupplementalMembershipState} from './supplementalMemberships';

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
 supplementalState:supplementalMembershipStateSchema.optional(),
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

/** Read only the selected Target's actual sources. The rest of the inventory
 * stays in the indexed, rebuildable queue and is not a Session snapshot. */
export async function currentStudyMembership(tx:LibraryTransaction,target:LocalLearningTarget,context:SensaFormalPinnedLanguageContext,purpose:LearningProtocolPurpose):Promise<LocalCurriculumMembership|undefined>{
 const enrollments=new Map<string,LocalCurriculumEnrollment>(),removed:Record<string,{introduce:boolean;ongoing:boolean}>={},resources=new Map<string,InstalledPackage|undefined>();
 for(const member of target.curriculumMemberships){
  const id=member.provenance.curriculumEnrollmentId;
  if(typeof id==='string'&&!enrollments.has(id)){const enrollment=await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',id);if(enrollment)enrollments.set(id,enrollment);}
  if((await tx.get<SupplementalMembershipState>('supplementalMembershipStates',member.id))?.status==='removed')removed[member.id]={introduce:false,ongoing:false};
  if(member.assurancePackageKey&&member.packageKey&&!resources.has(member.packageKey))resources.set(member.packageKey,await tx.get<InstalledPackage>('packageCache',member.packageKey));
 }
 return planningMembershipForContext(target,context,enrollments,member=>inspectLocalTargetReadiness(target,member,member.packageKey?resources.get(member.packageKey):undefined,purpose).status==='ready',removed);
}

/** Freeze only the participants and sources actually selected for a Run.
 * This is not an inventory cap: future candidates use the current queue. */
export async function captureStudyScope(tx:LibraryTransaction,input:{operationId:string;learnerId:string;context:SensaFormalPinnedLanguageContext;dailyLimit:number;at:string;targets:readonly LocalLearningTarget[];memberships:ReadonlyMap<string,LocalCurriculumMembership>}):Promise<LocalStudyScope>{
 const context=sensaFormalPinnedLanguageContextSchema.parse(input.context);
 const enrollments=new Map<string,LocalCurriculumEnrollment>(),members:LocalStudyScope['members']=[];
 const resources=new Map<string,InstalledPackage|undefined>();
 for(const target of input.targets){
  if(hasDeclaredMasteryOverride(target))throw new Error('localFlow.stepChanged');
  const membership=input.memberships.get(target.id);if(!membership)throw new Error('localFlow.routeMembershipMissing');
   const pair=membership.languageContext;
   if(pair.languageRouteId!==context.languageRouteId||pair.targetLanguageTag!==context.targetLanguageTag||pair.supportLanguageTag!==context.supportLanguageTag)throw new Error('localFlow.routeMembershipMissing');
   const enrollmentId=typeof membership.provenance.curriculumEnrollmentId==='string'?membership.provenance.curriculumEnrollmentId:null;
   if(enrollmentId&&!enrollments.has(enrollmentId)){const enrollment=await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',enrollmentId);if(enrollment)enrollments.set(enrollmentId,enrollment);}
   const decision=await tx.get<SupplementalMembershipState>('supplementalMembershipStates',membership.id);if(decision?.status==='removed')throw new Error('localFlow.routeMembershipMissing');
   const eligibility=curriculumSourceEligibility(membership,enrollmentId?enrollments.get(enrollmentId):undefined,!!target.startedAt);
   if(!eligibility.introduce&&!eligibility.ongoing)throw new Error('localFlow.routeMembershipMissing');
   let resource:InstalledPackage|undefined;
   if(membership.assurancePackageKey&&membership.packageKey){
    if(!resources.has(membership.packageKey))resources.set(membership.packageKey,await tx.get<InstalledPackage>('packageCache',membership.packageKey));
    resource=resources.get(membership.packageKey);
   }
   const source=studyScopeSourceSnapshot(target,membership,resource);
   members.push({...studyScopeMemberIdentity(target),sources:[{...source,...(decision?{supplementalState:structuredClone(decision)}:{}),introduce:eligibility.introduce,ongoing:eligibility.ongoing||eligibility.introduce}]});
 }
 const body={format:'sensa-study-scope-v1' as const,learnerUserId:input.learnerId,languageContext:context,dailyNewSenseLimit:input.dailyLimit,enrollments:[...enrollments.values()],members};
 const definitionDigest=canonicalJsonDigest(body),cacheKey=`study-scope-definition:${definitionDigest}`;
 const cachedId=await tx.get<string>('meta',cacheKey),existing=cachedId?await tx.get('studyScopes',cachedId):undefined;
 if(existing){const scope=studyScopeSchema.parse(existing);if(scope.definitionDigest!==definitionDigest)throw new Error('localFlow.progressReadFailed');if(Date.parse(scope.createdAt)<=Date.parse(input.at)){persistedScopes.add(scope);return scope;}}
 const id=stableUuid(`local-study-scope:${input.operationId}:${definitionDigest}`);
 tx.put('meta',cacheKey,id);
 const scope=studyScopeSchema.parse({...body,id,definitionDigest,createdByOperationId:input.operationId,createdAt:input.at});
 const captured=captureWitnesses.get(tx)??new Set<string>();captured.add(scope.id);captureWitnesses.set(tx,captured);
 tx.put('studyScopes',scope.id,scope);
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

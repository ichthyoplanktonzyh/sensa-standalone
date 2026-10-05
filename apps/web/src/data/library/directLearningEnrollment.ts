import {stableUuid} from '@sensa/learning-kernel';
import {sensaFormalPinnedLanguageContextSchema,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {resolveDirectLearningSource,type DirectLearningReference,type DirectLearningSource} from '../../learning/system/directLearningSource';
import {planningMembershipForContext} from '../../learning/runtime/curriculumEligibility';
import type {LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {curriculumEnrollmentId,curriculumEnrollmentSchema,type LocalCurriculumEnrollment} from './curriculumEnrollments';
import {learningCommand} from './learningAdmission';
import {learningOwner} from './libraryOwnership';
import {requireLanguageRouteContext} from './language';
import {readLibrary,assertCurrentLibrary,type LibraryTransaction} from './store';
import {backupEqual} from './backupCodec';

export interface DirectLearningEnrollment {
  enrollmentId:string|null;
  targetId:string;
  status:'awaiting_content'|'already_in_scope';
  languageContext:SensaFormalPinnedLanguageContext;
  selection:DirectLearningSource;
}
const targetIdFor=(learnerId:string,reference:DirectLearningReference)=>stableUuid(`sensa-learning-target:${learnerId}:${reference.senseVersionId}:${reference.bindingVersionId}`);
export function assertDirectTargetIdentity(target:LocalLearningTarget,selection:DirectLearningSource,learnerId:string):void{
 const reference=selection.reference;
 if(target.id!==targetIdFor(learnerId,reference)||target.identity.learnerUserId!==learnerId||target.identity.senseId!==reference.senseId||target.identity.senseVersionId!==reference.senseVersionId
   ||target.identity.senseExpressionBindingId!==reference.bindingId||target.identity.bindingVersionId!==reference.bindingVersionId||target.expression!==selection.expression.surfaceForm
   ||target.targetLanguageTag!==selection.targetLanguageTag)throw new Error('localFlow.invalidTarget');
}
export async function directSourceAlreadyCovered(tx:LibraryTransaction,targetId:string,context:SensaFormalPinnedLanguageContext,selection:DirectLearningSource,learnerId:string){
  const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(!target)return false;
  assertDirectTargetIdentity(target,selection,learnerId);
  const enrollments=new Map<string,LocalCurriculumEnrollment>();
  const ids=new Set(target.curriculumMemberships.flatMap(member=>typeof member.provenance.curriculumEnrollmentId==='string'?[member.provenance.curriculumEnrollmentId]:[]));
  for(const id of ids){const enrollment=await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',id);if(enrollment)enrollments.set(id,enrollment);}
  return !!planningMembershipForContext(target,context,enrollments);
}

/** Explicit Curriculum intent. Content readiness is never inferred from a click. */
export function enrollDirectSense(input:{operationId:string;reference:DirectLearningReference;expectedDigest:string;languageContext:SensaFormalPinnedLanguageContext}):Promise<DirectLearningEnrollment>{
  return learningCommand({id:input.operationId,kind:'learning.enrollDirect',input},async tx=>{
    const owner=await learningOwner(tx),languageContext=sensaFormalPinnedLanguageContextSchema.parse(input.languageContext);
    await requireLanguageRouteContext(tx,languageContext);
    const selection=await resolveDirectLearningSource(tx,input.reference,input.expectedDigest);
    if(selection.targetLanguageTag!==languageContext.targetLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
    const targetId=targetIdFor(owner.learnerId,selection.reference);
    if(await directSourceAlreadyCovered(tx,targetId,languageContext,selection,owner.learnerId))return {enrollmentId:null,targetId,status:'already_in_scope',languageContext,selection};
    const source={kind:'stable_sense' as const,selection},id=curriculumEnrollmentId(owner.learnerId,languageContext.languageRouteId,source);
    const existing=await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',id);
    if(existing){
      if(existing.source.kind!=='stable_sense'||existing.status!=='active')throw new Error('localFlow.meaningChanged');
      const pinned=existing.source.selection;
      if(pinned.reference.senseId!==selection.reference.senseId||pinned.reference.bindingId!==selection.reference.bindingId
        ||pinned.senseKey!==selection.senseKey||!backupEqual(pinned.semanticSpec,selection.semanticSpec)||!backupEqual(pinned.expression,selection.expression)||!backupEqual(pinned.binding,selection.binding))throw new Error('localFlow.meaningChanged');
      // A new entry path to the same connection cannot silently replace the
      // learner's original pinned source or its preparation language pair.
      if(existing.languageContext.targetLanguageTag!==languageContext.targetLanguageTag||existing.languageContext.supportLanguageTag!==languageContext.supportLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
      return {enrollmentId:id,targetId,status:'awaiting_content',languageContext:existing.languageContext,selection:existing.source.selection};
    }
    const now=new Date().toISOString();
    const enrollment=curriculumEnrollmentSchema.parse({format:'sensa-curriculum-enrollment-v1',id,revision:1,learnerUserId:owner.learnerId,languageContext,source,status:'active',createdByOperationId:input.operationId,createdAt:now,updatedAt:now});
    tx.put('curriculumEnrollments',id,enrollment);
    return {enrollmentId:id,targetId,status:'awaiting_content',languageContext,selection};
  });
}

export function readDirectLearningEnrollment(enrollmentId:string):Promise<DirectLearningEnrollment|null>{
  return readLibrary(async tx=>{
    await assertCurrentLibrary(tx);const owner=await learningOwner(tx),raw=await tx.get('curriculumEnrollments',enrollmentId);
    if(!raw)return null;const enrollment=curriculumEnrollmentSchema.parse(raw);
    if(enrollment.id!==enrollmentId||enrollment.learnerUserId!==owner.learnerId||enrollment.source.kind!=='stable_sense'||enrollment.status!=='active')return null;
    const selection=enrollment.source.selection,targetId=targetIdFor(owner.learnerId,selection.reference);
    return {enrollmentId,targetId,status:await directSourceAlreadyCovered(tx,targetId,enrollment.languageContext,selection,owner.learnerId)?'already_in_scope':'awaiting_content',languageContext:enrollment.languageContext,selection};
  });
}

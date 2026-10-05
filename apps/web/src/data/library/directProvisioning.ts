import {stableUuid} from '@sensa/learning-kernel';
import {canonicalConsumerJson} from '@sensa/contracts/sensa';
import {curriculumEnrollmentSchema,assertDirectEnrollmentSource} from './curriculumEnrollments';
import {resolveDirectLearningSource} from '../../learning/system/directLearningSource';
import {directProvisioningReferenceSchema,provisioningMembershipId,provisioningTaskId,type ContentProvisioningTask,type DirectProvisioningSource,type DirectProvisioningReference} from '../../contentSupply/provisioning/contracts';
import {contentSupplyCommand} from './contentSupplyAdmission';
import {learningOwner} from './libraryOwnership';
import {requireLanguageRouteContext} from './language';
import {readLibrary,type LibraryTransaction} from './store';
import type {LocalLearningTarget} from '../../learning/runtime/localProtocol';
import {localCurriculumMembershipForContext} from '../../learning/runtime/localCurriculum';
import {assertDirectTargetIdentity} from './directLearningEnrollment';

export const directProvisioningTaskId=(enrollmentId:string)=>stableUuid(`sensa-direct-provisioning:${enrollmentId}`);

/** Resolve accepted facts, never a caller-supplied gloss or a fabricated Context. */
export async function directProvisioningSource(tx:Pick<LibraryTransaction,'get'>,enrollmentId:string){
 const raw=await tx.get('curriculumEnrollments',enrollmentId);
 if(!raw)throw new Error('localFlow.enrollFirst');const enrollment=curriculumEnrollmentSchema.parse(raw);
 if(enrollment.source.kind!=='stable_sense'||enrollment.status!=='active')throw new Error('localFlow.enrollFirst');
 const owner=await learningOwner(tx as LibraryTransaction);
 if(enrollment.learnerUserId!==owner.learnerId)throw new Error('localFlow.enrollFirst');
 const {selection}=enrollment.source,origin=selection.reference.origin;
 if(origin.kind==='published_package'&&!await tx.get('packageCache',origin.packageKey)){
  const installation=await tx.get('packageInstallations',origin.packageKey);
  assertDirectEnrollmentSource(selection,(table,key)=>table==='packageInstallations'&&key===origin.packageKey?installation:undefined);
 }else await resolveDirectLearningSource(tx,selection.reference,selection.sourceDigest);
 const source:DirectProvisioningSource={sourceKind:'stable_sense',reference:{kind:'stable_sense',enrollmentId,sourceDigest:selection.sourceDigest,
  senseId:selection.reference.senseId,senseVersionId:selection.reference.senseVersionId,bindingId:selection.reference.bindingId,bindingVersionId:selection.reference.bindingVersionId},
  targetLanguageTag:selection.targetLanguageTag,expression:structuredClone(selection.expression),semanticSpec:structuredClone(selection.semanticSpec)};
 return {owner,enrollment,selection,source};
}

export async function assertDirectProvisioningReference(tx:Pick<LibraryTransaction,'get'>,reference:DirectProvisioningReference):Promise<void>{
 const parsed=directProvisioningReferenceSchema.parse(reference),resolved=await directProvisioningSource(tx,parsed.enrollmentId);
 if(canonicalConsumerJson(resolved.source.reference)!==canonicalConsumerJson(parsed))throw new Error('localFlow.meaningChanged');
}

export async function enrollDirectProvisioning(operationId:string,enrollmentId:string):Promise<ContentProvisioningTask<DirectProvisioningReference>>{
 return contentSupplyCommand({id:operationId,kind:'direct.enroll',input:{enrollmentId}},async tx=>{
  const {owner,enrollment,selection,source}=await directProvisioningSource(tx,enrollmentId),context=enrollment.languageContext;
  await requireLanguageRouteContext(tx,context);
  const id=provisioningTaskId(source.reference,context.languageRouteId),existing=await tx.get<ContentProvisioningTask<DirectProvisioningReference>>('personalLearning',id);
  if(existing){if(canonicalConsumerJson(existing.source)!==canonicalConsumerJson(source.reference))throw new Error('localFlow.meaningChanged');return existing;}
  const targetId=stableUuid(`sensa-learning-target:${owner.learnerId}:${source.reference.senseVersionId}:${source.reference.bindingVersionId}`),target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(target)assertDirectTargetIdentity(target,selection,owner.learnerId);
  const covered=target&&localCurriculumMembershipForContext(target,context);
  const task:ContentProvisioningTask<DirectProvisioningReference>={id,source:source.reference,targetId,curriculumMembershipId:provisioningMembershipId(source.reference,targetId,context.languageRouteId),languageContext:context,planRevision:crypto.randomUUID(),useContext:false,status:covered?'covered':'waiting',...(covered?{coveredByMembershipId:covered.id}:{}),attemptId:null,leaseUntil:0,notice:'',createdAt:new Date().toISOString()};
  tx.put('personalLearning',id,task);return task;
 });
}

export const readDirectProvisioningSource=(enrollmentId:string)=>readLibrary(async tx=>(await directProvisioningSource(tx,enrollmentId)).source);

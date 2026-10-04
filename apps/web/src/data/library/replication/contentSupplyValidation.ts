import {
  sensaContentGenerationRequestSchema,
  sensaMaterialCandidateBundleSchema,
  sensaPortableLightweightPackageSchema,
} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';

import type {BackupRows} from '../backupValidation';
import {packageInstallationSchema,portablePackageKey} from '../packageRecords';
import {validateInstalledLearningContent} from '../../../contentSupply/portable/installedLearningContent';
import type {LibraryIdentity,Table} from '../store';
import {isDirectProvisioningReference,provisioningTaskId,provisioningMembershipId} from '../../../contentSupply/provisioning/contracts';
import {curriculumEnrollmentSchema} from '../curriculumEnrollments';
import {assertDirectTaskEnrollment,assertDirectAttemptSource} from '../directProvisioningAssertions';
import {assertReadyContentAttempt} from '../contentAttemptEvidence';

type RequireRow=(table:Table,id:string)=>any;

/** Content Supply validates both recoverable public-artifact references and learner-owned preparation attempts. */
export function validateContentSupplyReplica(input:{
 rows:BackupRows;
 identity:LibraryIdentity;
 requireRow:RequireRow;
 requirePersonalSource:(source:any)=>unknown;
 validateLanguageContext:(value:unknown)=>{languageRouteId:string};
 fail:()=>never;
}){
 const {rows,identity,requireRow,requirePersonalSource,validateLanguageContext,fail}=input;
 for(const {key,value:i} of rows.packageInstallations){const installation=packageInstallationSchema.parse(i);if(key!==installation.key)fail();}
 for(const {key,value:p} of rows.packageCache){
  validateInstalledLearningContent(p.content);
  const manifest=sensaPortableLightweightPackageSchema.parse(p.portableOrigin.manifest);
  if(key!==p.key||key!==portablePackageKey(manifest.metadata.packageId,manifest.metadata.version))fail();
  z.string().regex(/^[a-f0-9]{64}$/u).parse(p.digest);
  const installation=packageInstallationSchema.parse(requireRow('packageInstallations',key));
  if(
   installation.artifact.digest!==p.digest
   ||installation.artifact.packageDigest!==p.portableOrigin.packageDigest
   ||installation.artifact.targetLanguage!==p.content.targetLanguage
   ||installation.artifact.supportLanguage!==p.content.supportLanguage
  )fail();
 }
 for(const {value:task} of rows.personalLearning){
  const direct=isDirectProvisioningReference(task.source);
  if(direct)assertDirectTaskEnrollment(task,curriculumEnrollmentSchema.parse(requireRow('curriculumEnrollments',task.source.enrollmentId)));
  else requirePersonalSource(task.source);
  const context=validateLanguageContext(task.languageContext);
  if(task.id!==provisioningTaskId(task.source,context.languageRouteId)||task.targetId!==stableUuid(`sensa-learning-target:${identity.learnerId}:${task.source.senseVersionId}:${task.source.bindingVersionId}`)
    ||task.curriculumMembershipId!==provisioningMembershipId(task.source,task.targetId,context.languageRouteId))fail();
  z.string().uuid().parse(task.curriculumMembershipId);
  if(task.attemptId&&requireRow('contentAttempts',task.attemptId).taskId!==task.id)fail();
  if(task.status==='ready'&&!requireRow('learningTargets',task.targetId).curriculumMemberships.some((membership:any)=>membership.id===task.curriculumMembershipId))fail();
  if(task.status==='covered'){
   if(!direct)fail();const target=requireRow('learningTargets',task.targetId),member=target.curriculumMemberships.find((candidate:any)=>candidate.id===task.coveredByMembershipId);
   if(target.identity.senseId!==task.source.senseId||target.identity.senseVersionId!==task.source.senseVersionId||target.identity.senseExpressionBindingId!==task.source.bindingId||target.identity.bindingVersionId!==task.source.bindingVersionId)fail();
   if(!member||member.languageContext.languageRouteId!==task.languageContext.languageRouteId||member.languageContext.targetLanguageTag!==task.languageContext.targetLanguageTag||member.languageContext.supportLanguageTag!==task.languageContext.supportLanguageTag)fail();
  }else if(task.coveredByMembershipId!==undefined)fail();
  if(!['waiting','generating','reviewing','failed','rejected','stopped','ready','covered'].includes(task.status))fail();
 }
 for(const {value:attempt} of rows.contentAttempts){
  const task=requireRow('personalLearning',attempt.taskId);
  if(isDirectProvisioningReference(task.source))assertDirectAttemptSource(attempt,task,assertDirectTaskEnrollment(task,curriculumEnrollmentSchema.parse(requireRow('curriculumEnrollments',task.source.enrollmentId))),identity.learnerId);
  else assertReadyContentAttempt(attempt);
  if(attempt.request)sensaContentGenerationRequestSchema.parse(attempt.request);
  if(attempt.bundle){sensaMaterialCandidateBundleSchema.parse(attempt.bundle);if(!attempt.request||attempt.bundle.contentGenerationRequestId!==attempt.request.contentGenerationRequestId)fail();}
  if(attempt.resumedFrom)requireRow('contentAttempts',attempt.resumedFrom);
 }
}

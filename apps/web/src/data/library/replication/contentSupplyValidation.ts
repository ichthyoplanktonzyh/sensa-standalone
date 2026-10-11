import {portableEntryIdentity} from '../../../contentSupply/portable/portableEntryIdentity';
import {sameLearningSourcePin} from '../../../learning/runtime/learningIdentity';
import {stableLearningTargetId} from '../../../learning/runtime/learningIdentity';
import {
  sensaContentGenerationRequestSchema,
  sensaMaterialCandidateBundleSchema,
  sensaPortableLightweightPackageSchema,
} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {z} from 'zod';

import type {LibraryRecordRows} from '../libraryRecordReader';
import {packageInstallationSchema,portablePackageKey,publicationBookMembership} from '../packageRecords';
import {validateInstalledLearningContent} from '../../../contentSupply/portable/installedLearningContent';
import type {LibraryIdentity,Table} from '../store';
import {isDirectProvisioningReference,provisioningTaskId,provisioningMembershipId} from '../../../contentSupply/provisioning/contracts';
import {curriculumEnrollmentSchema} from '../curriculumEnrollments';
import {assertDirectTaskEnrollment,assertDirectAttemptSource} from '../directProvisioningAssertions';
import {assertPersonalAttemptSource} from '../personalProvisioningAssertions';
import {assertPersonalContextPin,resolvePinnedPersonalMeaningLearningSource,orderPersonalContextImages,personalMeaningPinnedRecord} from '../../../experience/personalMeaningJourney/learningSource';
import {parseStoredMedia} from '../media';
import {backupEqual} from '../backupCodec';
import {assertReadyContentAttempt} from '../contentAttemptEvidence';

type RequireRow=(table:Table,id:string)=>any;

/** Content Supply validates both recoverable public-artifact references and learner-owned preparation attempts. */
export function* validateContentSupplyReplicaSteps(input:{
 rows:LibraryRecordRows;
 identity:LibraryIdentity;
 requireRow:RequireRow;
 requirePersonalSource:(source:any)=>unknown;
 validateLanguageContext:(value:unknown)=>{languageRouteId:string};
 fail:()=>never;
}){
 const {rows,identity,requireRow,requirePersonalSource,validateLanguageContext,fail}=input;
 for(const {key,value:i} of rows.packageInstallations){const installation=packageInstallationSchema.parse(i);if(key!==installation.key)fail();yield;}
 for(const {key,value:p} of rows.packageCache){
  validateInstalledLearningContent(p.content);
  const manifest=sensaPortableLightweightPackageSchema.parse(p.portableOrigin.manifest);
  if(key!==p.key||key!==portablePackageKey(manifest.metadata.packageId,manifest.metadata.version))fail();
  z.string().regex(/^[a-f0-9]{64}$/u).parse(p.digest);
  const expectedPin=portableEntryIdentity(manifest,p.portableOrigin.publications.length>0);
  if(p.content.entries.length!==1||!sameLearningSourcePin(p.content.entries[0],expectedPin))fail();
  const installation=packageInstallationSchema.parse(requireRow('packageInstallations',key));
  if(
   installation.artifact.digest!==p.digest
   ||installation.artifact.packageDigest!==p.portableOrigin.packageDigest
   ||installation.artifact.targetLanguage!==p.content.targetLanguage
   ||installation.artifact.supportLanguage!==p.content.supportLanguage
  )fail();
  for(const publication of p.portableOrigin.publications){
   const member=publicationBookMembership(publication);
   if(member&&!installation.artifact.bookMemberships?.some(value=>backupEqual(value,member)))fail();
  }
  yield;
 }
 for(const {value:task} of rows.personalLearning){
  const direct=isDirectProvisioningReference(task.source);
  if(direct)assertDirectTaskEnrollment(task,curriculumEnrollmentSchema.parse(requireRow('curriculumEnrollments',task.source.enrollmentId)));
  else requirePersonalSource(task.source);
  if(direct&&task.contextPin!==undefined)fail();
  if(!direct&&task.contextPin!==undefined)assertPersonalContextPin(personalMeaningPinnedRecord(requireRow('semanticMeanings',task.source.personalMeaningId),task.source,task.contextPin)??fail(),task.contextPin);
  const context=validateLanguageContext(task.languageContext);
  if(task.id!==provisioningTaskId(task.source,context.languageRouteId)||task.targetId!==stableLearningTargetId(identity.learnerId,task.source.senseId,task.source.expressionId)
    ||task.curriculumMembershipId!==provisioningMembershipId(task.source,task.targetId,context.languageRouteId))fail();
  z.string().uuid().parse(task.curriculumMembershipId);
  if(task.attemptId&&requireRow('contentAttempts',task.attemptId).taskId!==task.id)fail();
  if(task.status==='ready'&&!requireRow('learningTargets',task.targetId).curriculumMemberships.some((membership:any)=>membership.id===task.curriculumMembershipId))fail();
  if(task.status==='covered'){
   const target=requireRow('learningTargets',task.targetId),member=target.curriculumMemberships.find((candidate:any)=>candidate.id===task.coveredByMembershipId);
   if(target.identity.senseId!==task.source.senseId||target.identity.expressionId!==task.source.expressionId)fail();
   if(!member||member.languageContext.languageRouteId!==task.languageContext.languageRouteId||member.languageContext.targetLanguageTag!==task.languageContext.targetLanguageTag||member.languageContext.supportLanguageTag!==task.languageContext.supportLanguageTag)fail();
  }else if(task.coveredByMembershipId!==undefined)fail();
  if(!['waiting','generating','reviewing','failed','rejected','stopped','ready','covered'].includes(task.status))fail();
  yield;
 }
 for(const {value:attempt} of rows.contentAttempts){
  if(attempt.status==='ready')assertReadyContentAttempt(attempt);
  else if(attempt.readyAt!==null)fail();
  const task=requireRow('personalLearning',attempt.taskId);
  if(task.attemptId===attempt.id&&!backupEqual(attempt.contextPin??null,task.contextPin??null))fail();
  if(task.attemptId===attempt.id&&!backupEqual(attempt.fixedInput,{source:task.source,languageContext:task.languageContext,planRevision:task.planRevision,useContext:task.useContext}))fail();
  if(attempt.contextPin!==undefined){
   if(isDirectProvisioningReference(task.source))fail();
  }
  if(isDirectProvisioningReference(task.source))assertDirectAttemptSource(attempt,task,assertDirectTaskEnrollment(task,curriculumEnrollmentSchema.parse(requireRow('curriculumEnrollments',task.source.enrollmentId))),identity.learnerId);
  else{
   if(!attempt.fixedInput)throw new Error('Personal preparation is missing its frozen input.');
   validateLanguageContext(attempt.fixedInput.languageContext);
   requirePersonalSource(attempt.fixedInput.source);
   const record=personalMeaningPinnedRecord(requireRow('semanticMeanings',attempt.fixedInput.source.personalMeaningId),attempt.fixedInput.source,attempt.contextPin)??fail();
   if(attempt.contextPin)assertPersonalContextPin(record,attempt.contextPin);
   const source=resolvePinnedPersonalMeaningLearningSource(record,(kind,id)=>requireRow('semanticRegistry',`${kind}:${id}`).value,attempt.fixedInput.source,attempt.contextPin);
   if(!source)throw new Error('Personal preparation has a different accepted source.');
   const ids=new Set(source.context.personalSemanticAnchorRevisionIds);
   const mediaIds=[...new Set<string>(record.personalSemanticAnchorRevisions.filter((revision:any)=>ids.has(revision.personalSemanticAnchorRevisionId)).flatMap((revision:any)=>revision.personalMediaObjectId?[revision.personalMediaObjectId]:[]))];
   const images=mediaIds.map(mediaId=>({id:mediaId,name:'personal-context-image',dataUrl:parseStoredMedia(requireRow('media',mediaId)).dataUrl}));
   source.context.images=orderPersonalContextImages(record,source.context.personalSemanticAnchorRevisionIds,[...source.context.images,...images]);
   assertPersonalAttemptSource(attempt,task,source,identity.learnerId);
  }
  if(attempt.request)sensaContentGenerationRequestSchema.parse(attempt.request);
  if(attempt.bundle){sensaMaterialCandidateBundleSchema.parse(attempt.bundle);if(!attempt.request||attempt.bundle.contentGenerationRequestId!==attempt.request.contentGenerationRequestId)fail();}
  if(attempt.resumedFrom)requireRow('contentAttempts',attempt.resumedFrom);
  yield;
 }
}

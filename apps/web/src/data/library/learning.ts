import {materialForNextStep} from '../../contentSupply/provisioning/hybridMaterialization';
import {
  materializeOnDemandContent,
  materializePublishedEntry,
} from '../../contentSupply/provisioning/materialization';
import {provisioningMembershipId,type ContentProvisioningSource} from '../../contentSupply/provisioning/contracts';
import {inspectLocalTargetReadiness,localExecutionForRun,learningRuntimeCoordinator,requireLocalTargetReadiness,type LocalLearningAction} from '../../learning/runtime/runtimeCoordinator';
import {localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {learningPolicyProfileRegistry,type LearningPolicyId} from '../../learning/runtime/policyProfiles';
import {stableUuid} from '@sensa/learning-kernel';
import {sensaFormalPinnedLanguageContextSchema,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {readLibrary,requestCloudCheckpoint,type LibraryTransaction,type LibraryIdentity} from './store';
import {learningCommand} from './learningAdmission';
import {learningOwner} from './libraryOwnership';
import type {InstalledPackage,InstalledPackageSummary} from './packageRecords';
import {validateLightweightInitialMaterialization,type LightweightInitialLearningMaterialization} from '../../contentSupply/provisioning/lightweightInitialContent';
import {
  createLocalProtocolState,
  createLocalProtocolProgress,
  assertLocalTargetMaterialIdentity,
  initializeLocalProtocolState,
  localProtocolActiveTargetId,
  localProtocolStepId,
  localProtocolOutcomePermissions,
  localRunOpenPlanningInterruption,
  reduceLocalProtocolAction,
  localLearningPurpose,
  localRunTargetIds,
  type LocalCommittedLearningPolicy,
  type LocalCurriculumMembership,
  type LocalLearningRun,
  type LocalLearningMaterialization,
  type LocalLearningPolicyAssignment,
  type LocalProtocolEvaluationFacts,
  type LocalResolvedLearningPlanSnapshot,
  type LocalLearningTarget,
  validateLocalProtocolResources,
} from '../../learning/runtime/localProtocol';
import {localCurriculumMembershipForContext,localExecutableTarget,localExecutableTargetForParticipant,upsertLocalCurriculumMembership} from '../../learning/runtime/localCurriculum';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {
  readPersonalLearningSceneForAction,
  type PersonalLearningScene,
} from '../../personalContent/system/personalContentSystem';
import {applyLocalProtocolTransition,type LocalLearningTransitionRecord} from './learningSettlement';
import {requireLanguageRouteContext} from './language';
import {readStudyPlans,writeStudyPlans} from './studyPlans';
import {backupEqual} from './backupCodec';
import {resolveDirectLearningSource} from '../../learning/system/directLearningSource';
import {createPackageCacheSummary} from './packageCacheProjection';
import {assertDirectTargetIdentity} from './directLearningEnrollment';
import {
 curriculumEnrollmentId,
 curriculumEnrollmentSchema,
 enrollmentMatchesContext,
 type CurriculumEnrollmentSource,
 type LocalCurriculumEnrollment,
} from './curriculumEnrollments';

export {localRunTargetIds};
export type {LocalLearningRun,LocalLearningTarget};
export type {LocalStudyPlan} from './studyPlans';
export type LearningEvent={id:string;runId:string;targetId:string;kind:string;at:string;detail:{stepId:string;materializationId:string;personalLearningScene:{sceneId:string;revisionId:string;revision:number}|null;action:LocalLearningAction;formalEvaluation:LocalProtocolEvaluationFacts|null;transition:LocalLearningTransitionRecord}};

const createPolicyAssignment=(input:{operationId:string;targetId:string;profileId:LearningPolicyId;scope:LocalLearningPolicyAssignment['scope'];at:string;provenance:Readonly<Record<string,unknown>>}):LocalLearningPolicyAssignment=>({
 assignmentId:stableUuid(`local-policy-assignment:${input.targetId}`),revision:1,scope:input.scope,profileId:input.profileId,
 assignedByOperationId:input.operationId,assignedAt:input.at,provenance:structuredClone(input.provenance),
});

const curriculumMembership=(input:{
 operationId:string;targetId:string;sourceKey:string;languageContext:SensaFormalPinnedLanguageContext;
 sourceKind:LocalCurriculumMembership['sourceKind'];provenance:Readonly<Record<string,unknown>>;
 packageKey:string|null;assurancePackageKey?:string;material:LocalLearningMaterialization;at:string;previous?:LocalCurriculumMembership;
}):LocalCurriculumMembership=>({
 id:stableUuid(`local-curriculum-membership:${input.targetId}:${input.languageContext.languageRouteId}:${input.sourceKind}:${input.sourceKey}`),
 revision:(input.previous?.revision??0)+1,
 status:'active',
 languageContext:sensaFormalPinnedLanguageContextSchema.parse(input.languageContext),sourceKind:input.sourceKind,
 provenance:structuredClone(input.provenance),packageKey:input.packageKey,
 ...(input.assurancePackageKey?{assurancePackageKey:input.assurancePackageKey}:{}),material:structuredClone(input.material),
 createdByOperationId:input.previous?.createdByOperationId??input.operationId,createdAt:input.previous?.createdAt??input.at,updatedAt:input.at,
});

const materialForProtocolRun=(material:LocalLearningMaterialization,purpose:LocalLearningRun['purpose'],protocolRunId:string,at:string):LocalLearningMaterialization=>({
 snapshot:{...structuredClone(material.snapshot),learningMaterializationId:stableUuid(`local-run-materialization:${protocolRunId}:${material.snapshot.learningMaterializationId}`),protocolPurpose:purpose,createdAt:at},
 content:structuredClone(material.content),
});

const sameRunLanguagePair=(left:SensaFormalPinnedLanguageContext,right:SensaFormalPinnedLanguageContext)=>
 left.languageRouteId===right.languageRouteId&&left.targetLanguageTag===right.targetLanguageTag&&left.supportLanguageTag===right.supportLanguageTag;

/** Bind the current Step to the newest compatible material. Once the learner
 * acts, its presented material becomes history. Before that action, an explicit
 * personal-material publication or Portable update may refresh the current Step. */
async function bindCurrentStepMaterial(tx:LibraryTransaction,run:LocalLearningRun,at:string,replace=false,operationId?:string):Promise<boolean>{
 if(run.completedAt)return false;
 const execution=localExecutionForRun(run),targetId=localProtocolActiveTargetId(execution,run),participant=run.participants[targetId];
 if(!participant)throw new Error('localFlow.stepChanged');
 const stepId=localProtocolStepId(execution,run);
 const previous=participant.presentedMaterials[stepId];
 if(!replace&&previous)return false;
 const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!target)throw new Error('localFlow.enrollFirst');
 const pinnedMembership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId&&sameRunLanguagePair(candidate.languageContext,participant.languageContext));
 const currentMembership=localCurriculumMembershipForContext(target,participant.languageContext);
 const currentPack=currentMembership?.packageKey?await tx.get<InstalledPackage>('packageCache',currentMembership.packageKey):undefined;
 // Unfinished Steps may adopt material from the currently active Portable membership.
 const membership=currentPack?currentMembership:pinnedMembership;
 const material=membership?materialForProtocolRun(replace?membership.material:materialForNextStep(participant.material,membership.material),run.purpose,participant.protocolRunId,at):structuredClone(participant.material);
 assertLocalTargetMaterialIdentity(target,material);validateLightweightInitialMaterialization(material);
 const executable=localExecutableTargetForParticipant(target,participant,material),pack=executable.packageKey?await tx.get<InstalledPackage>('packageCache',executable.packageKey):undefined;
 validateLocalProtocolResources(execution,executable,pack);
 participant.presentedMaterials[stepId]=material;
 if(replace){
  if(!previous||!operationId)throw new Error('localFlow.resourceInvalid');
  run.lifecycleEvents.push({eventId:stableUuid(`local-run-material-refresh:${run.id}:${operationId}:${stepId}`),kind:'current_step_material_refreshed',operationId,targetId,stepId,materializationId:material.snapshot.learningMaterializationId,at});
 }
 return true;
}

async function refreshCurrentStepsForMaterial(tx:LibraryTransaction,targetId:string,at:string,operationId:string):Promise<void>{
 for(const runId of await tx.learningRunIdsForTarget(targetId,{openOnly:true})){
  const run=await tx.get<LocalLearningRun>('learningRuns',runId);if(!run)continue;
  const execution=localExecutionForRun(run);
  if(localProtocolActiveTargetId(execution,run)!==targetId)continue;
  if(await bindCurrentStepMaterial(tx,run,at,true,operationId)){run.revision++;tx.put('learningRuns',run.id,run);}
 }
}

const commitPolicy=(target:LocalLearningTarget,protocolRunId:string,at:string):LocalCommittedLearningPolicy=>{
 if(target.committedPolicy)return target.committedPolicy;
 const profile=learningPolicyProfileRegistry.get(target.policyAssignment.profileId);
 return {commitmentId:stableUuid(`local-policy-commitment:${target.retentionId}`),revision:1,assignmentId:target.policyAssignment.assignmentId,assignmentRevision:target.policyAssignment.revision,profileId:profile.profileId,profileVersion:profile.profileVersion,committedByProtocolRunId:protocolRunId,committedAt:at};
};

const resolveRunPlan=(target:LocalLearningTarget,commitment:LocalCommittedLearningPolicy,purpose:LocalLearningRun['purpose'],material:LocalLearningMaterialization,at:string):LocalResolvedLearningPlanSnapshot=>{
 const profile=learningPolicyProfileRegistry.get(commitment.profileId,commitment.profileVersion),binding=profile.protocols[purpose];
 if(!binding.localProtocolVersion||!profile.lifecycle.schedulingPolicy)throw new Error('localFlow.resourceInvalid');
 return {resolvedLearningPlanRevisionId:stableUuid(`local-resolved-plan:${target.id}:${commitment.commitmentId}:${commitment.revision}:${purpose}:${binding.protocolId}:${binding.protocolVersion}:${material.snapshot.learningMaterializationId}`),revision:1,learningTargetId:target.id,retentionTargetId:target.retentionId,purpose,profileId:profile.profileId,profileVersion:profile.profileVersion,protocolBinding:structuredClone(binding),contentDemands:structuredClone(binding.contentDemands),learningMaterializationIds:[material.snapshot.learningMaterializationId],readiness:'ready',resolvedAt:at};
};

type PublishedEnrollmentMember=Readonly<{
 key:string;
 pack:InstalledPackageSummary;
 publication:InstalledPackage['portableOrigin']['publications'][number]|undefined;
 bookId:string;
 bookVersionId:string|null;
 contentReleaseId:string|null;
 packageVersion:string;
}>;

/** Book and direct selection share the same validated publication → Target handoff. */
async function admitPublishedTarget(tx:LibraryTransaction,input:{operationId:string;owner:LibraryIdentity;context:SensaFormalPinnedLanguageContext;enrollment:LocalCurriculumEnrollment;member:PublishedEnrollmentMember;pack:InstalledPackage;entry:InstalledPackage['content']['entries'][number];existing:LocalLearningTarget|undefined;at:string}):Promise<LocalLearningTarget>{
 const {operationId,owner,context,enrollment,member,pack,entry,existing,at}=input;
 const targetId=stableUuid(`sensa-learning-target:${owner.learnerId}:${entry.senseVersionId}:${entry.bindingVersionId}`);
 const material=materializePublishedEntry({learnerUserId:owner.learnerId,learningTargetId:targetId,packageKey:member.key,installedPackage:pack,entry,createdAt:at});
 const source={kind:enrollment.source.kind==='stable_sense'?'stable_sense':'sense_learning_package',curriculumEnrollmentId:enrollment.id,
  bookId:member.bookId,bookVersionId:member.bookVersionId,contentReleaseId:member.contentReleaseId,packageVersion:member.packageVersion,packageDigest:pack.digest,
  ...(member.publication?{publicationArchiveSha256:member.publication.bookArchiveSha256}:{})};
 const sourceKind=enrollment.source.kind==='stable_sense'?'stable_sense':'sense_learning_package',sourceKey=sourceKind==='stable_sense'?enrollment.id:member.key;
 const priorMembership=existing?.curriculumMemberships.find(candidate=>candidate.id===stableUuid(`local-curriculum-membership:${targetId}:${context.languageRouteId}:${sourceKind}:${sourceKey}`));
 const membership=curriculumMembership({operationId,targetId,sourceKey,languageContext:context,sourceKind,provenance:source,packageKey:member.key,assurancePackageKey:entry.assurancePackageKey,material,at,previous:priorMembership});
 if(existing){
  if(existing.identity.learnerUserId!==owner.learnerId||existing.identity.senseId!==entry.senseId||existing.identity.senseVersionId!==entry.senseVersionId||existing.identity.senseExpressionBindingId!==entry.bindingId||existing.identity.bindingVersionId!==entry.bindingVersionId||existing.targetLanguageTag!==pack.content.targetLanguage||existing.expression!==entry.expression)throw new Error('localFlow.invalidTarget');
  const updated=upsertLocalCurriculumMembership(existing,membership);tx.put('learningTargets',targetId,updated);return updated;
 }
 const profileId=entry.assurancePackageKey?'high_assurance':'lightweight';
 const target:LocalLearningTarget={id:targetId,retentionId:stableUuid(`sensa-retention:${targetId}`),identity:{learnerUserId:owner.learnerId,senseId:entry.senseId,senseVersionId:entry.senseVersionId,senseExpressionBindingId:entry.bindingId,bindingVersionId:entry.bindingVersionId,targetLanguageTag:pack.content.targetLanguage},curriculumMemberships:[membership],expression:entry.expression,policyAssignment:createPolicyAssignment({operationId,targetId,profileId,scope:'curriculum_source',at,provenance:{curriculumEnrollmentId:enrollment.id,bookId:member.bookId,bookVersionId:member.bookVersionId,contentReleaseId:member.contentReleaseId,packageVersion:member.packageVersion}}),committedPolicy:null,planningOverrides:[],targetLanguageTag:pack.content.targetLanguage,introducedLanguageRouteId:null,createdAt:at,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
 tx.put('learningTargets',targetId,target);return target;
}

const versionFamily=(pack:InstalledPackageSummary)=>[
 pack.portableOrigin.manifest.metadata.packageId,
 pack.content.targetLanguage,
 pack.content.supportLanguage,
].join('\0');

const sameLocalDay=(left:string,right:string)=>new Date(left).toDateString()===new Date(right).toDateString();

const enrollmentPackages=(
 enrollment:LocalCurriculumEnrollment,
 packages:readonly InstalledPackageSummary[],
):PublishedEnrollmentMember[]=>{
 const source=enrollment.source;
 // Direct intent is prepared by its source-specific provisioning handoff,
 // never widened into all entries in the containing package or Book.
 if(source.kind==='stable_sense')return [];
 if(source.kind==='portable_package'){
  const pack=packages.find(candidate=>candidate.key===source.packageKey);
  return pack?[{
   key:pack.key,pack,publication:undefined,
   bookId:pack.portableOrigin.manifest.metadata.packageId,
   bookVersionId:null,
   contentReleaseId:null,
   packageVersion:String(pack.portableOrigin.manifest.metadata.version),
  }]:[];
 }
 const matches=packages.flatMap(pack=>{
  const publication=pack.portableOrigin.publications.find(candidate=>
   candidate.bookArchiveSha256===source.publicationArchiveSha256
   &&candidate.publisher.namespace===source.publisherNamespace
   &&candidate.book.bookId===source.bookId
   &&candidate.book.bookVersionId===source.bookVersionId);
  return publication?[{
   key:pack.key,pack,publication,
   bookId:publication.book.bookId,
   bookVersionId:publication.book.bookVersionId,
   contentReleaseId:publication.contentRelease.contentReleaseId,
   packageVersion:String(pack.portableOrigin.manifest.metadata.version),
  }]:[];
 }).sort((left,right)=>left.key.localeCompare(right.key));
 return matches.length===source.memberCount?matches:[];
};

const activeTargetInRoute=(target:LocalLearningTarget,routeId:string)=>target.curriculumMemberships.some(membership=>
 membership.status!=='superseded'&&membership.languageContext.languageRouteId===routeId);

const hydratedPackage=async(
 tx:LibraryTransaction,
 key:string,
 cache:Map<string,InstalledPackage>,
):Promise<InstalledPackage>=>{
 const existing=cache.get(key);if(existing)return existing;
 const value=await tx.get<InstalledPackage>('packageCache',key);
 if(!value)throw new Error('localFlow.downloadFirst');
 cache.set(key,value);return value;
};

/** Materialize only the bounded candidate window the scheduler can introduce.
 * The durable learner intent remains one Curriculum Enrollment regardless of
 * whether its Book contains 10 or 10,000 Senses. */
async function materializeCurriculumWindow(
 tx:LibraryTransaction,
 operationId:string,
 context:SensaFormalPinnedLanguageContext,
 dailyLimit:number,
 at:string,
 availablePackages?:readonly InstalledPackageSummary[],
):Promise<string[]> {
 const owner=await learningOwner(tx);
 const [enrollments,targets]=await Promise.all([
  tx.all<LocalCurriculumEnrollment>('curriculumEnrollments'),
  tx.all<LocalLearningTarget>('learningTargets'),
 ]);
 const routeTargets=targets.filter(target=>activeTargetInRoute(target,context.languageRouteId));
 const startedToday=routeTargets.filter(target=>target.startedAt&&sameLocalDay(target.startedAt,at)).length;
 const pending=routeTargets.filter(target=>!target.startedAt&&!target.completedAt&&!hasDeclaredMasteryOverride(target));
 let slots=Math.max(0,dailyLimit-startedToday-pending.length);
 if(!slots)return [];
 const packages=availablePackages??await tx.packageCacheProjection({kind:'summaries'});
 const byId=new Map(targets.map(target=>[target.id,target]));
 const hydratedPackages=new Map<string,InstalledPackage>();
 const active=enrollments.filter(enrollment=>enrollmentMatchesContext(enrollment,context)).sort((left,right)=>left.id.localeCompare(right.id));
 const iterators=active.flatMap(enrollment=>{
  const members=enrollmentPackages(enrollment,packages);
  if(!members.length)return [];
  function* candidates(){
   for(const member of members)for(const entry of member.pack.content.entries){
    const targetId=stableUuid(`sensa-learning-target:${owner.learnerId}:${entry.senseVersionId}:${entry.bindingVersionId}`);
    const existing=byId.get(targetId);
    if(existing&&activeTargetInRoute(existing,context.languageRouteId))continue;
    yield {enrollment,member,entry,targetId,existing};
   }
  }
  return [candidates()];
 });
 const ids:string[]=[];
 while(slots&&iterators.length){
  let progressed=false;
  for(let index=0;index<iterators.length&&slots;){
   const next=iterators[index]!.next();
   if(next.done){iterators.splice(index,1);continue;}
   progressed=true;index++;
   const {enrollment,member,entry,targetId,existing}=next.value;
   const hydrated=await hydratedPackage(tx,member.key,hydratedPackages);
   const hydratedEntry=hydrated.content.entries.find(candidate=>candidate.senseVersionId===entry.senseVersionId&&candidate.bindingVersionId===entry.bindingVersionId);
   if(!hydratedEntry)throw new Error('localFlow.resourceInvalid');
   byId.set(targetId,await admitPublishedTarget(tx,{operationId,owner,context,enrollment,member,pack:hydrated,entry:hydratedEntry,existing,at}));
   ids.push(targetId);slots--;
  }
  if(!progressed)break;
 }
 return ids;
}

/** Rebind only Targets that already exist. Book updates may refresh a current
 * unacted Step, but they must not eagerly create Targets for every new member. */
async function refreshMaterializedEnrollmentMembers(
 tx:LibraryTransaction,
 operationId:string,
 enrollmentId:string,
 members:readonly PublishedEnrollmentMember[],
 context:SensaFormalPinnedLanguageContext,
 at:string,
):Promise<string[]> {
 const owner=await learningOwner(tx),targets=await tx.all<LocalLearningTarget>('learningTargets');
 const byId=new Map(targets.map(target=>[target.id,target]));
 const hydratedPackages=new Map<string,InstalledPackage>();
 const refreshed:string[]=[];
 for(const member of members)for(const entry of member.pack.content.entries){
  const targetId=stableUuid(`sensa-learning-target:${owner.learnerId}:${entry.senseVersionId}:${entry.bindingVersionId}`),existing=byId.get(targetId);
  if(!existing)continue;
  const hadEnrollment=existing.curriculumMemberships.some(candidate=>candidate.provenance.curriculumEnrollmentId===enrollmentId);
  if(existing.identity.learnerUserId!==owner.learnerId||existing.identity.senseVersionId!==entry.senseVersionId||existing.identity.bindingVersionId!==entry.bindingVersionId||existing.targetLanguageTag!==member.pack.content.targetLanguage||existing.expression!==entry.expression)throw new Error('localFlow.invalidTarget');
   const hydrated=await hydratedPackage(tx,member.key,hydratedPackages);
   const hydratedEntry=hydrated.content.entries.find(candidate=>candidate.senseVersionId===entry.senseVersionId&&candidate.bindingVersionId===entry.bindingVersionId);
   if(!hydratedEntry)throw new Error('localFlow.resourceInvalid');
   const material=materializePublishedEntry({learnerUserId:owner.learnerId,learningTargetId:targetId,packageKey:member.key,installedPackage:hydrated,entry:hydratedEntry,createdAt:at});
  const source={kind:'sense_learning_package',curriculumEnrollmentId:enrollmentId,bookId:member.bookId,bookVersionId:member.bookVersionId,contentReleaseId:member.contentReleaseId,packageVersion:member.packageVersion,packageDigest:member.pack.digest,...(member.publication?{publicationArchiveSha256:member.publication.bookArchiveSha256}:{})};
  const prior=existing.curriculumMemberships.find(candidate=>candidate.id===stableUuid(`local-curriculum-membership:${targetId}:${context.languageRouteId}:sense_learning_package:${member.key}`));
  const membership=curriculumMembership({operationId,targetId,sourceKey:member.key,languageContext:context,sourceKind:'sense_learning_package',provenance:source,packageKey:member.key,assurancePackageKey:entry.assurancePackageKey,material,at,previous:prior});
  const updated=upsertLocalCurriculumMembership(existing,membership);
  tx.put('learningTargets',targetId,updated);byId.set(targetId,updated);refreshed.push(targetId);
  if(hadEnrollment)await refreshCurrentStepsForMaterial(tx,targetId,at,operationId);
 }
 return refreshed;
}

async function enrollInstalledPackages(
 tx:LibraryTransaction,
 operationId:string,
 packageKeys:readonly string[],
 languageContext:SensaFormalPinnedLanguageContext,
 publicationArchiveSha256?:string,
 availablePackages?:readonly InstalledPackageSummary[],
):Promise<string[]>{
 const uniqueKeys=[...new Set(packageKeys)];
 if(!uniqueKeys.length||uniqueKeys.length!==packageKeys.length)throw new Error('localFlow.catalogMismatch');
 const owner=await learningOwner(tx),context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);
 const available=availablePackages??await tx.packageCacheProjection({kind:'summaries'});
 const byKey=new Map(available.map(pack=>[pack.key,pack]));
 const latestVersions=new Map<string,number>();
 for(const pack of available){
  const family=versionFamily(pack),version=pack.portableOrigin.manifest.metadata.version;
  latestVersions.set(family,Math.max(latestVersions.get(family)??version,version));
 }
 const selected:PublishedEnrollmentMember[]=uniqueKeys.map(key=>{
  const pack=byKey.get(key);if(!pack)throw new Error('localFlow.downloadFirst');
  if(pack.content.targetLanguage!==context.targetLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
  if(pack.content.supportLanguage!==context.supportLanguageTag)throw new Error('localFlow.routeSupportMismatch');
  const publications=pack.portableOrigin.publications;
  const publication=publicationArchiveSha256
   ?publications.find(candidate=>candidate.bookArchiveSha256===publicationArchiveSha256)
   :[...publications].sort((left,right)=>right.book.versionNumber-left.book.versionNumber)[0];
  if(publicationArchiveSha256&&!publication)throw new Error('localFlow.catalogMismatch');
  if(pack.portableOrigin.manifest.metadata.version<(latestVersions.get(versionFamily(pack))??0))throw new Error('localFlow.packageVersionChanged');
  return {
   key,pack,publication,
   bookId:publication?.book.bookId??pack.portableOrigin.manifest.metadata.packageId,
   bookVersionId:publication?.book.bookVersionId??null,
   contentReleaseId:publication?.contentRelease.contentReleaseId??null,
   packageVersion:String(pack.portableOrigin.manifest.metadata.version),
  };
 });
 if(publicationArchiveSha256){
  const reference=selected[0]!.publication!;
  if(reference.memberCount!==selected.length||selected.some(item=>{
   const publication=item.publication!;
   return publication.bookArchiveSha256!==publicationArchiveSha256
    ||publication.publisher.namespace!==reference.publisher.namespace
    ||publication.book.bookId!==reference.book.bookId
    ||publication.book.bookVersionId!==reference.book.bookVersionId
    ||publication.contentRelease.contentReleaseId!==reference.contentRelease.contentReleaseId
    ||publication.memberCount!==reference.memberCount;
  }))throw new Error('localFlow.catalogMismatch');
 }
 const now=new Date().toISOString(),reference=selected[0]!;
 const source:CurriculumEnrollmentSource=publicationArchiveSha256?{
  kind:'published_book',
  publisherNamespace:reference.publication!.publisher.namespace,
  bookId:reference.publication!.book.bookId,
  bookVersionId:reference.publication!.book.bookVersionId,
  bookVersionNumber:reference.publication!.book.versionNumber,
  contentReleaseId:reference.publication!.contentRelease.contentReleaseId,
  publicationArchiveSha256,
  memberCount:reference.publication!.memberCount,
 }:{
  kind:'portable_package',
  packageId:reference.pack.portableOrigin.manifest.metadata.packageId,
  packageVersion:reference.pack.portableOrigin.manifest.metadata.version,
  packageKey:reference.key,
 };
 if(source.kind==='portable_package'&&selected.length!==1)throw new Error('localFlow.catalogMismatch');
 const id=curriculumEnrollmentId(owner.learnerId,context.languageRouteId,source);
 const previous=await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',id);
 const changed=!previous||!backupEqual(previous.source,source)||previous.status!=='active'||!backupEqual(previous.languageContext,context);
 if(changed){
  const enrollment=curriculumEnrollmentSchema.parse({format:'sensa-curriculum-enrollment-v1',id,revision:(previous?.revision??0)+1,learnerUserId:owner.learnerId,languageContext:context,source,status:'active',createdByOperationId:previous?.createdByOperationId??operationId,createdAt:previous?.createdAt??now,updatedAt:now});
  tx.put('curriculumEnrollments',id,enrollment);
  if(previous&&source.kind==='published_book'){
   const nextTargetIds=new Set(selected.flatMap(item=>item.pack.content.entries.map(entry=>stableUuid(`sensa-learning-target:${owner.learnerId}:${entry.senseVersionId}:${entry.bindingVersionId}`))));
   for(const target of await tx.all<LocalLearningTarget>('learningTargets')){
    let revised=false;
    const curriculumMemberships=target.curriculumMemberships.map(membership=>{
     if(membership.status==='superseded'||membership.provenance.curriculumEnrollmentId!==id||nextTargetIds.has(target.id))return membership;
     revised=true;
     return {...membership,status:'superseded' as const,revision:membership.revision+1,updatedAt:now};
    });
    if(revised)tx.put('learningTargets',target.id,{...target,curriculumMemberships});
   }
  }
 }
 const plans=await readStudyPlans(tx);
 const refreshed=changed&&previous?await refreshMaterializedEnrollmentMembers(tx,operationId,id,selected,context,now):[];
 const materialized=await materializeCurriculumWindow(tx,operationId,context,plans[context.languageRouteId]?.dailyNewSenseLimit??20,now,available);
 return [...new Set([...refreshed,...materialized])];
}

/** Prepare only the explicitly selected connection, never the containing Book. */
export function prepareDirectPublishedLearning(operationId:string,enrollmentId:string){
 return learningCommand({id:operationId,kind:'learning.prepareDirect',input:{enrollmentId}},async tx=>{
  const owner=await learningOwner(tx),raw=await tx.get('curriculumEnrollments',enrollmentId);
  if(!raw)throw new Error('localFlow.enrollFirst');const enrollment=curriculumEnrollmentSchema.parse(raw);
  if(enrollment.source.kind!=='stable_sense'||enrollment.status!=='active'||enrollment.learnerUserId!==owner.learnerId)throw new Error('localFlow.enrollFirst');
  const context=enrollment.languageContext;await requireLanguageRouteContext(tx,context);
  const {selection}=enrollment.source,targetId=stableUuid(`sensa-learning-target:${owner.learnerId}:${selection.reference.senseVersionId}:${selection.reference.bindingVersionId}`);
  const existing=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(existing)assertDirectTargetIdentity(existing,selection,owner.learnerId);
  if(existing&&localCurriculumMembershipForContext(existing,context))return {targetId,status:'already_in_scope' as const};
  const source=await resolveDirectLearningSource(tx,selection.reference,selection.sourceDigest);
  if(!source.publishedContent||source.publishedContent.supportLanguageTag!==context.supportLanguageTag)return {targetId,status:'needs_generation' as const};
  const pack=await tx.get<InstalledPackage>('packageCache',source.publishedContent.packageKey);
  if(!pack)throw new Error('localFlow.resourceInvalid');
  const entry=pack.content.entries.find(row=>row.senseVersionId===source.reference.senseVersionId&&row.bindingVersionId===source.reference.bindingVersionId);
  if(!entry)throw new Error('localFlow.resourceInvalid');
  const metadata=pack.portableOrigin.manifest.metadata;
  const member:PublishedEnrollmentMember={key:pack.key,pack:createPackageCacheSummary(pack),publication:undefined,bookId:metadata.packageId,bookVersionId:null,contentReleaseId:null,packageVersion:String(metadata.version)};
  await admitPublishedTarget(tx,{operationId,owner,context,enrollment,member,pack,entry,existing,at:new Date().toISOString()});
  return {targetId,status:'ready' as const};
 });
}

export async function enrollPackage(operationId:string,key:string,languageContext:SensaFormalPinnedLanguageContext,publicationArchiveSha256?:string){return learningCommand({id:operationId,kind:'learning.enroll',input:{key,languageContext,...(publicationArchiveSha256?{publicationArchiveSha256}:{})}},tx=>enrollInstalledPackages(tx,operationId,[key],languageContext,publicationArchiveSha256));}

export async function enrollBook(operationId:string,languageContext:SensaFormalPinnedLanguageContext,publicationArchiveSha256:string){return learningCommand({id:operationId,kind:'learning.enroll',input:{languageContext,publicationArchiveSha256}},async tx=>{
 const packages=await tx.packageCacheProjection({kind:'summaries'});
 const packageKeys=packages.flatMap(pack=>pack.portableOrigin.publications.some(publication=>publication.bookArchiveSha256===publicationArchiveSha256)?[pack.key]:[]);
 return enrollInstalledPackages(tx,operationId,packageKeys,languageContext,publicationArchiveSha256,packages);
});}
const learningOverviewFrom=async(tx:LibraryTransaction)=>({
 targets:await tx.all<LocalLearningTarget>('learningTargets'),
 enrollments:await tx.all<LocalCurriculumEnrollment>('curriculumEnrollments'),
 runs:await tx.all<LocalLearningRun>('learningRuns'),
 active:await tx.get<string>('meta','learning-active'),
 studyPlans:await readStudyPlans(tx),
});
/** One coherent read for the always-visible queue and learning screens. */
export const readLearningOverview=()=>readLibrary(learningOverviewFrom);
/** Small projection for callers that only need Target facts. */
export const learningTargetsSnapshot=()=>readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'));
export const readLearning=()=>readLibrary(async tx=>({targets:await tx.all<LocalLearningTarget>('learningTargets'),runs:await tx.all<LocalLearningRun>('learningRuns'),events:await tx.all<LearningEvent>('learningEvents'),active:await tx.get<string>('meta','learning-active'),studyPlans:await readStudyPlans(tx)}));
export async function confirmLearningQuantity(operationId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number){return learningCommand({id:operationId,kind:'learning.quantity',input:{languageContext,dailyLimit}},async tx=>{await learningOwner(tx);const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw new Error('localFlow.quantityRange');const plans=await readStudyPlans(tx),previous=plans[context.languageRouteId],at=new Date().toISOString();plans[context.languageRouteId]={languageRouteId:context.languageRouteId,routeRevision:context.languageRouteRevision,revision:(previous?.revision??0)+1,dailyNewSenseLimit:dailyLimit,updatedAt:at};writeStudyPlans(tx,plans);await materializeCurriculumWindow(tx,operationId,context,dailyLimit,at);return true;});}

export async function prepareLearningQueue(languageContext:SensaFormalPinnedLanguageContext,at=new Date().toISOString(),trigger='daily'){
 const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);
 const fingerprint=await readLibrary(async tx=>{
  const plans=await readStudyPlans(tx),enrollments=(await tx.all<LocalCurriculumEnrollment>('curriculumEnrollments')).filter(item=>enrollmentMatchesContext(item,context));
  const packages=await tx.packageCacheProjection({kind:'identities'});
  return JSON.stringify({trigger,day:new Date(at).toDateString(),languageContext:context,dailyLimit:plans[context.languageRouteId]?.dailyNewSenseLimit??20,enrollments:enrollments.map(item=>[item.id,item.revision]),packages:packages.map(item=>[item.key,item.digest]).sort()});
 });
 const operationId=stableUuid(`local-learning-queue-window:${fingerprint}`);
 return learningCommand({id:operationId,kind:'learning.materialize',input:{languageContext:context,day:new Date(at).toDateString(),trigger}},async tx=>{
  await learningOwner(tx);await requireLanguageRouteContext(tx,context);
  const plans=await readStudyPlans(tx);
  return materializeCurriculumWindow(tx,operationId,context,plans[context.languageRouteId]?.dailyNewSenseLimit??20,at);
 });
}
async function startLearningInTransaction(tx:LibraryTransaction,operationId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number,at:string):Promise<LocalLearningRun>{
 const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100||!Number.isFinite(Date.parse(at)))throw new Error('localFlow.confirmQuantity');
 const plan=(await readStudyPlans(tx))[context.languageRouteId];if(plan?.dailyNewSenseLimit!==dailyLimit)throw new Error('localFlow.confirmNewQuantity');
 const active=await tx.get<string>('meta','learning-active');if(active){const run=await tx.get<LocalLearningRun>('learningRuns',active);if(run)return run;}
 const t=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!t)throw new Error('localFlow.enrollFirst');if(hasDeclaredMasteryOverride(t))throw new Error('localFlow.stepChanged');
 const selectedMembership=localCurriculumMembershipForContext(t,context);if(!selectedMembership)throw new Error('localFlow.routeMembershipMissing');
 const unfinishedId=(await tx.learningRunIdsForTarget(targetId,{openOnly:true}))[0];
 const unfinished=unfinishedId?await tx.get<LocalLearningRun>('learningRuns',unfinishedId):undefined;if(unfinished){
  for(const id of localRunTargetIds(unfinished)){const member=await tx.get<LocalLearningTarget>('learningTargets',id);if(member&&hasDeclaredMasteryOverride(member))throw new Error('localFlow.stepChanged');}
  const interruption=localRunOpenPlanningInterruption(unfinished);
  if(!interruption)throw new Error('localFlow.stepChanged');
  if(Date.parse(at)<Date.parse(interruption.at))throw new Error('localFlow.clockChanged');
  unfinished.lifecycleEvents.push({eventId:stableUuid(`local-run-resume:${unfinished.id}:${operationId}`),kind:'resumed_after_planning_override',operationId,interruptionEventId:interruption.eventId,at});unfinished.revision++;tx.put('learningRuns',unfinished.id,unfinished);
  tx.put('meta','learning-active',unfinished.id);return unfinished;
 }
 const now=new Date(at),purpose=localLearningPurpose(t);
 const dayStart=new Date(now);dayStart.setHours(0,0,0,0);const dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1);
 const introducedToday=await tx.countIntroducedLearningTargets(context.languageRouteId,dayStart.toISOString(),dayEnd.toISOString());
 const pack=selectedMembership.packageKey?await tx.get<InstalledPackage>('packageCache',selectedMembership.packageKey):undefined;
 const readiness=requireLocalTargetReadiness(t,selectedMembership,pack,purpose);
 const profileId=readiness.profileId,profile=learningPolicyProfileRegistry.get(profileId,readiness.profileVersion),runner=learningRuntimeCoordinator.localExecutionForBinding(readiness.binding,purpose);
 if(t.relearnAt&&now<new Date(t.relearnAt)||purpose==='retention_review'&&(!t.memory||now<t.memory.dueAt))throw new Error('localFlow.notDue');
 if(purpose==='initial_learning'&&!t.startedAt&&introducedToday>=dailyLimit)throw new Error('localFlow.dailyLimit');
 const binding=profile.protocols[purpose],schedulingPolicy=profile.lifecycle.schedulingPolicy;if(!binding.localProtocolVersion||!schedulingPolicy)throw new Error('localFlow.resourceInvalid');
 let participants=[t];
 if(runner.cohort){
  const targets=await tx.all<LocalLearningTarget>('learningTargets');
  const remaining=Math.max(0,dailyLimit-introducedToday),openTargetIds=new Set(await tx.openLearningTargetIds());
  const broadlyCompatible=[t,...targets.filter(v=>v.id!==t.id)].filter(v=>!hasDeclaredMasteryOverride(v)&&!!localCurriculumMembershipForContext(v,context)&&localTargetPolicy(v)===profileId&&localLearningPurpose(v)===purpose&&!openTargetIds.has(v.id)&&(purpose==='initial_learning'||(v.relearnAt?now>=new Date(v.relearnAt):!!v.memory&&now>=v.memory.dueAt)));
  const compatible:LocalLearningTarget[]=[];
  for(const candidate of broadlyCompatible){
   const candidateMembership=localCurriculumMembershipForContext(candidate,context)!;
   const candidateResource=candidateMembership.packageKey?await tx.get<InstalledPackage>('packageCache',candidateMembership.packageKey):undefined;
   if(inspectLocalTargetReadiness(candidate,candidateMembership,candidateResource,purpose).status==='ready')compatible.push(candidate);
  }
  const selected=new Set(compatible.filter(v=>!v.startedAt).slice(0,remaining).map(v=>v.id));
  const candidates=compatible.filter(v=>v.startedAt||selected.has(v.id)).map(v=>({targetId:v.id,profileId,ready:true,executable:true}));
  const launch=purpose==='initial_learning'
   ?learningRuntimeCoordinator.planInitial(t.id,candidates)
   :(purpose==='retention_review'?learningRuntimeCoordinator.planRetention(candidates):learningRuntimeCoordinator.planRelearning(candidates)).find(v=>v.targetIds.includes(t.id));
  if(!launch?.targetIds.includes(t.id))throw new Error('localFlow.dailyLimit');
  participants=launch.targetIds.map(id=>targets.find(v=>v.id===id)!);
 }
 const sessionId=crypto.randomUUID();
 const participantSnapshots:LocalLearningRun['participants']=Object.fromEntries(participants.map(participant=>{
  const membership=localCurriculumMembershipForContext(participant,context);if(!membership)throw new Error('localFlow.routeMembershipMissing');
  const protocolRunId=stableUuid(`local-protocol-run:${sessionId}:${participant.id}`);
  const policyCommitment=commitPolicy(participant,protocolRunId,at);
  if(policyCommitment.profileId!==profileId||policyCommitment.profileVersion!==profile.profileVersion)throw new Error('localFlow.resourceInvalid');
  const material=materialForProtocolRun(membership.material,purpose,protocolRunId,at);
  const resolvedPlan=resolveRunPlan(participant,policyCommitment,purpose,material,at);
  participant.committedPolicy=policyCommitment;
  return [participant.id,{protocolRunId,curriculumMembershipId:membership.id,languageContext:context,startReason:{kind:purpose==='initial_learning'?'initial_learning_ready':purpose==='retention_review'?'due_review':'relearning_ready',selectionReason:participant.id===targetId?'requested_target':'cohort_candidate',triggerAt:at,triggerMemoryRevision:participant.memoryRevision},outcomePermissions:localProtocolOutcomePermissions(purpose,binding),material,presentedMaterials:{},policyCommitment,resolvedPlan,progress:createLocalProtocolProgress(protocolRunId,binding),memoryRevision:participant.memoryRevision,dueAt:participant.memory?.dueAt.toISOString()??null,evidenceIds:[]}];
 }));
 const run:LocalLearningRun={
  id:sessionId,targetId,targetIds:participants.map(v=>v.id),
  participants:participantSnapshots,
  targetCompletions:{},languageContext:context,purpose,policyProfileId:profileId,policyProfileVersion:profile.profileVersion,
  protocolBinding:structuredClone(binding),protocolVersion:binding.localProtocolVersion,
  protocolState:createLocalProtocolState(binding.runtimeAdapterId,null),
  schedulingPolicyId:profile.lifecycle.schedulingPolicyId,schedulingPolicy:structuredClone(schedulingPolicy),
  learnerVisibleClaimBoundary:profile.lifecycle.learnerVisibleClaimBoundary,
  ordinal:1,revision:1,lifecycleEvents:[],startedAt:at,completedAt:null,
 };
 for(const participant of participants){
  const membership=localCurriculumMembershipForContext(participant,context)!;
  const resources=membership.packageKey?await tx.get<InstalledPackage>('packageCache',membership.packageKey):undefined;
  requireLocalTargetReadiness(participant,membership,resources,purpose);
 }
 run.protocolState=initializeLocalProtocolState({execution:runner,target:localExecutableTarget(t,selectedMembership),resource:pack,purpose,run});
 await bindCurrentStepMaterial(tx,run,at);
 for(const participant of participants)if(!participant.startedAt){participant.startedAt=at;participant.introducedLanguageRouteId=context.languageRouteId;tx.put('learningTargets',participant.id,participant);}
 tx.put('learningRuns',run.id,run);tx.put('meta','learning-active',run.id);return run;
}
export async function startLearning(operationId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number,at=new Date().toISOString()){return learningCommand({id:operationId,kind:'learning.start',input:{targetId,languageContext,dailyLimit,at}},async tx=>{await learningOwner(tx);return startLearningInTransaction(tx,operationId,targetId,languageContext,dailyLimit,at);});}
export async function actLearning(operationId:string,runId:string,revision:number,action:LocalLearningAction,at=new Date().toISOString()){return learningCommand({id:operationId,kind:'learning.act',input:{runId,revision,action,at}},async tx=>{
 await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);
 if(!run||run.revision!==revision||run.completedAt||await tx.get('meta','learning-active')!==runId)throw new Error('localFlow.stepChanged');
 const execution=localExecutionForRun(run);
 const activeTargetId=localProtocolActiveTargetId(execution,run);
 const t=(await tx.get<LocalLearningTarget>('learningTargets',activeTargetId))!;
 await bindCurrentStepMaterial(tx,run,at);
 const stepId=localProtocolStepId(execution,run),participant=run.participants[activeTargetId]!,presentedMaterial=participant.presentedMaterials[stepId];
 if(!presentedMaterial)throw new Error('localFlow.resourceInvalid');
 const executable=localExecutableTargetForParticipant(t,participant,presentedMaterial);
 const scene:PersonalLearningScene|undefined=await readPersonalLearningSceneForAction(tx,t.id,participant.languageContext.languageRouteId);
 const sceneRevision=scene?.revisions.find(candidate=>candidate.revision===scene.currentRevision);
 const personalLearningScene=scene&&sceneRevision?{sceneId:scene.sceneId,revisionId:sceneRevision.revisionId,revision:sceneRevision.revision}:null;
 if(hasDeclaredMasteryOverride(t)||localRunOpenPlanningInterruption(run))throw new Error('localFlow.stepChanged');
 if(!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(run.startedAt))throw new Error('localFlow.clockChanged');
 const pack=executable.packageKey?await tx.get<InstalledPackage>('packageCache',executable.packageKey):undefined;validateLocalProtocolResources(execution,executable,pack);
 const executed=reduceLocalProtocolAction({operationId,stepKey:stepId,execution,target:executable,run,resource:pack,action,at});
 const nextRun=executed.run;
 const applied=applyLocalProtocolTransition({operationId,stepId,at,target:t,run:nextRun,transition:executed.transition});
 nextRun.ordinal++;nextRun.revision++;if(!nextRun.completedAt)await bindCurrentStepMaterial(tx,nextRun,at);tx.put('learningRuns',nextRun.id,nextRun);tx.put('learningTargets',applied.target.id,applied.target);
 tx.put('learningEvents',operationId,{id:operationId,runId,targetId:t.id,kind:action.kind,at,detail:{stepId,materializationId:presentedMaterial.snapshot.learningMaterializationId,personalLearningScene,action,formalEvaluation:executed.facts,transition:applied.record}} satisfies LearningEvent);return nextRun;
});}
export async function finishLearning(operationId:string,runId:string){const result=await learningCommand({id:operationId,kind:'learning.finish',input:{runId}},async tx=>{await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);if(!run?.completedAt)throw new Error('localFlow.finishFirst');if(await tx.get('meta','learning-active')===runId)tx.delete('meta','learning-active');return true;});requestCloudCheckpoint();return result;}
/** Complete one Run and start its successor as one published library state.
 * Observers must never see an empty active-Run gap while the learner is moving
 * directly to the next target. */
export async function continueLearning(operationId:string,runId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number,at=new Date().toISOString()){
 const result=await learningCommand({id:operationId,kind:'learning.continue',input:{runId,targetId,languageContext,dailyLimit,at}},async tx=>{
  await learningOwner(tx);
  const completed=await tx.get<LocalLearningRun>('learningRuns',runId);if(!completed?.completedAt)throw new Error('localFlow.finishFirst');
  if(await tx.get('meta','learning-active')===runId)tx.delete('meta','learning-active');
  return startLearningInTransaction(tx,operationId,targetId,languageContext,dailyLimit,at);
 });
 requestCloudCheckpoint();return result;
}

/** The same runtime target is committed only after independent material validation. */
export async function commitPersonalMaterial(tx:LibraryTransaction,owner:LibraryIdentity,source:ContentProvisioningSource,languageContext:SensaFormalPinnedLanguageContext,content:LightweightInitialLearningMaterialization['content'],attemptId:string,grantId:string|null,replace=false){
 const {reference}=source,id=stableUuid(`sensa-learning-target:${owner.learnerId}:${reference.senseVersionId}:${reference.bindingVersionId}`);
 const existing=await tx.get<LocalLearningTarget>('learningTargets',id);
 const now=new Date().toISOString();
 const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext),targetLanguageTag=source.targetLanguageTag;
 if(targetLanguageTag!==context.targetLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
 const material=materializeOnDemandContent({learnerUserId:owner.learnerId,learningTargetId:id,source,content,attemptId,personalAnchorUseGrantId:grantId,createdAt:now});
 const membershipId=provisioningMembershipId(reference,id,context.languageRouteId);
 const previous=existing?.curriculumMemberships.find(candidate=>candidate.id===membershipId);
 if(existing&&previous&&!replace)return existing;
 const provenance=source.sourceKind==='stable_sense'?{kind:'stable_sense',curriculumEnrollmentId:source.reference.enrollmentId,sourceDigest:source.reference.sourceDigest}
   :{kind:'personal_meaning_alignment',personalMeaningId:source.reference.personalMeaningId,personalMeaningRevisionId:source.reference.personalMeaningRevisionId,alignmentBasisReferenceId:source.reference.alignmentBasisReferenceId,alignmentId:source.reference.personalMeaningAlignmentId};
 const membership=curriculumMembership({operationId:attemptId,targetId:id,sourceKey:source.sourceKind==='stable_sense'?source.reference.enrollmentId:source.reference.personalMeaningAlignmentId,languageContext:context,sourceKind:source.sourceKind,provenance,packageKey:null,material,at:now,previous});
 if(existing){const next=upsertLocalCurriculumMembership(existing,membership);tx.put('learningTargets',id,next);if(replace)await refreshCurrentStepsForMaterial(tx,id,now,attemptId);return next;}
 const target:LocalLearningTarget={id,retentionId:stableUuid(`sensa-retention:${id}`),identity:{learnerUserId:owner.learnerId,senseId:reference.senseId,senseVersionId:reference.senseVersionId,senseExpressionBindingId:reference.bindingId,bindingVersionId:reference.bindingVersionId,targetLanguageTag},curriculumMemberships:[membership],expression:source.expression.surfaceForm,policyAssignment:createPolicyAssignment({operationId:attemptId,targetId:id,profileId:'lightweight',scope:'system_default',at:now,provenance:{kind:source.sourceKind}}),committedPolicy:null,planningOverrides:[],targetLanguageTag,introducedLanguageRouteId:null,createdAt:now,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
 tx.put('learningTargets',id,target);return target;
}

/** A reversible learner declaration changes planning eligibility, never evidence or schedules. */
export async function setLocalDeclaredMastery(operationId:string,targetId:string,active:boolean,at=new Date().toISOString()){
 return learningCommand({id:operationId,kind:'learning.declareMastery',input:{targetId,active,at}},async tx=>{
  await learningOwner(tx);
  if(!Number.isFinite(Date.parse(at)))throw new Error('localFlow.clockChanged');
  const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(!target)throw new Error('localFlow.enrollFirst');
  const declared=hasDeclaredMasteryOverride(target);
  if(active&&!declared){target.planningOverrides.push({kind:'declared_mastery',source:'learner',operationId,createdAt:at});tx.put('learningTargets',target.id,target);}
  else if(!active&&declared){target.planningOverrides=target.planningOverrides.filter(override=>override.kind!=='declared_mastery');tx.put('learningTargets',target.id,target);}
  const runId=await tx.get<string>('meta','learning-active');
  const run=runId?await tx.get<LocalLearningRun>('learningRuns',runId):null;
  if(active&&run&&localRunTargetIds(run).includes(targetId)){
   if(Date.parse(at)<Date.parse(run.startedAt))throw new Error('localFlow.clockChanged');
   if(!localRunOpenPlanningInterruption(run)){run.lifecycleEvents.push({eventId:stableUuid(`local-run-interruption:${run.id}:${operationId}`),kind:'interrupted_by_planning_override',operationId,targetId,overrideKind:'declared_mastery',at});run.revision++;tx.put('learningRuns',run.id,run);}
   tx.delete('meta','learning-active');
  }
  return true;
 });
}

/** Assignment is allowed only before any run; histories and running bindings are immutable. */
export async function selectLocalLearningPolicy(operationId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,profileId:LearningPolicyId){
 return learningCommand({id:operationId,kind:'learning.policy',input:{targetId,languageContext,profileId}},async tx=>{
  await learningOwner(tx);const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(!target||target.startedAt||(await tx.learningRunIdsForTarget(targetId)).length)throw new Error('localFlow.stepChanged');
  const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);
  const membership=localCurriculumMembershipForContext(target,context);if(!membership)throw new Error('localFlow.routeMembershipMissing');
  const profile=learningPolicyProfileRegistry.get(profileId);
  if(!profile.localSelectable||!membership.assurancePackageKey)throw new Error('localFlow.resourceInvalid');
  const pack=membership.packageKey?await tx.get<InstalledPackage>('packageCache',membership.packageKey):undefined;
  validateLocalProtocolResources(learningRuntimeCoordinator.localExecutionFor(profileId,'initial_learning'),localExecutableTarget(target,membership),pack);
  target.policyAssignment={assignmentId:target.policyAssignment.assignmentId,revision:target.policyAssignment.revision+1,scope:'target_override',profileId,assignedByOperationId:operationId,assignedAt:new Date().toISOString(),provenance:{kind:'learner_target_override'}};tx.put('learningTargets',target.id,target);return target;
 });
}

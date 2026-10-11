import {stableLearningTargetId,materialSourcePin} from '../../learning/runtime/learningIdentity';
import {materialForNextStep} from '../../contentSupply/provisioning/hybridMaterialization';
import {assertMaterialAvailableAt} from '../../contentSupply/provisioning/materialReadiness';
import {
  materializeOnDemandContent,
  materializePublishedEntry,
} from '../../contentSupply/provisioning/materialization';
import {provisioningMembershipId,type ContentProvisioningSource} from '../../contentSupply/provisioning/contracts';
import {inspectLocalTargetReadiness,localExecutionForRun,learningRuntimeCoordinator,requireLocalTargetReadiness,type LocalLearningAction} from '../../learning/runtime/runtimeCoordinator';
import {localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {planningMembershipForContext} from '../../learning/runtime/curriculumEligibility';
import {assertSupplementalMembershipActive,supplementalSourceDescriptor} from './supplementalMemberships';
import {learningPolicyProfileRegistry,type LearningPolicyId} from '../../learning/runtime/policyProfiles';
import {stableUuid} from '@sensa/learning-kernel';
import {sensaFormalPinnedLanguageContextSchema,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {readLibrary,requestCloudCheckpoint,type LibraryTransaction,type LibraryIdentity} from './store';
import {learningCommand} from './learningAdmission';
import {learningRunReceipt,readVerifiedLearningRunReceipt,sameLearningSessionDirection,assertLearningContinuationPurpose} from './learningCommandReceipt';
import {publishedCurriculumSourceKey,publishedCurriculumMembershipId} from './publishedCurriculumSources';
import {runBaselineMaterial,runStepMaterial,runMaterialDigest,pinRunStepMaterial} from '../../learning/runtime/runMaterialPins';
import {learningOwner} from './libraryOwnership';
import {retentionBaseline} from '../../learning/runtime/retentionBaseline';
import type {InstalledPackage,InstalledPackageSummary,PackageInstallation} from './packageRecords';
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
  localRunOpenSessionPause,
  localRunSessionIntent,
  reduceLocalProtocolAction,
  localLearningPurpose,
  localRunTargetIds,
  type LocalCommittedLearningPolicy,
  type LocalCurriculumMembership,
  type LocalLearningRun,
  type LocalLearningSessionIntent,
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
import {readStudyPlans,writeStudyPlans,DEFAULT_DAILY_NEW_SENSE_LIMIT} from './studyPlans';
import {backupEqual} from './backupCodec';
import {resolveDirectLearningSource} from '../../learning/system/directLearningSource';
import {createPackageCacheSummary} from './packageCacheProjection';
import {assertDirectTargetIdentity,directSourceAlreadyCovered} from './directLearningEnrollment';
import {captureStudyScope,currentStudyMembership,readActiveLearningSessionHeader,createLearningSession,focusLearningSession,endLearningSession,type LocalStudyScope} from './studyScopes';
import {resolveBookPlan,reviseBookMode,bookRangeSelectionSchema,type BookEnrollmentMode,type BookRangeSelection} from './bookPlans';
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
export type LearningStepPresentation={targetId:string;stepId:string;material:string};
export type LearningEvent={id:string;runId:string;targetId:string;kind:string;at:string;detail:{runRevision:number;nextPresentation:LearningStepPresentation|null;stepId:string;materializationId:string;personalLearningScene:{sceneId:string;revisionId:string;revision:number}|null;action:LocalLearningAction;formalEvaluation:LocalProtocolEvaluationFacts|null;transition:LocalLearningTransitionRecord}};

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
 sourcePin:materialSourcePin(input.material),provenance:structuredClone(input.provenance),packageKey:input.packageKey,
 ...(input.assurancePackageKey?{assurancePackageKey:input.assurancePackageKey}:{}),material:structuredClone(input.material),
 createdByOperationId:input.previous?.createdByOperationId??input.operationId,createdAt:input.previous?.createdAt??input.at,updatedAt:input.at,
});

const materialForProtocolRun=(material:LocalLearningMaterialization,purpose:LocalLearningRun['purpose'],protocolRunId:string,at:string):LocalLearningMaterialization=>{
 assertMaterialAvailableAt(material,at);
 return {
 snapshot:{...structuredClone(material.snapshot),learningMaterializationId:stableUuid(`local-run-materialization:${protocolRunId}:${material.snapshot.learningMaterializationId}`),protocolPurpose:purpose,createdAt:at},
 content:structuredClone(material.content),
 };
};

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
 const previous=participant.presentedMaterials[stepId]?runStepMaterial(participant,stepId):undefined;
 if(!replace&&previous)return false;
 const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!target)throw new Error('localFlow.enrollFirst');
 const pinnedMembership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId&&sameRunLanguagePair(candidate.languageContext,participant.languageContext));
 const enrollmentId=pinnedMembership?.provenance.curriculumEnrollmentId;
 const enrollment=typeof enrollmentId==='string'?await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',enrollmentId):undefined;
 // A Book Version belongs to the pinned curriculum. A compatible publication
 // of an independently enrolled package may still refresh unacted material.
 const compatiblePackageLineage=pinnedMembership?.sourceKind==='sense_learning_package'&&enrollment?.source.kind==='portable_package';
 const independentPublications=new Set<string>();
 const directPackage=pinnedMembership?.sourceKind==='stable_sense'&&pinnedMembership.packageKey
  ?await tx.get<PackageInstallation>('packageInstallations',pinnedMembership.packageKey):undefined;
 const directPackageFamily=directPackage?.artifact.packageId;
 if(pinnedMembership?.packageKey===null||directPackageFamily){
  // Preserve explicit on-demand → independently published material updates.
  // A different Book admission is not a compatible update of that source.
  const sourceIds=new Set(target.curriculumMemberships.flatMap(candidate=>candidate.sourceKind==='sense_learning_package'&&typeof candidate.provenance.curriculumEnrollmentId==='string'?[candidate.provenance.curriculumEnrollmentId]:[]));
  for(const id of sourceIds){
   const source=(await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',id))?.source;
   if(source?.kind==='portable_package'&&(!directPackageFamily||source.packageId===directPackageFamily))independentPublications.add(id);
  }
 }
 const currentMembership=localCurriculumMembershipForContext({...target,curriculumMemberships:target.curriculumMemberships.filter(candidate=>candidate.id===pinnedMembership?.id||candidate.sourceKind==='sense_learning_package'&&(compatiblePackageLineage&&candidate.provenance.curriculumEnrollmentId===enrollmentId||independentPublications.has(String(candidate.provenance.curriculumEnrollmentId))&&(!directPackage||Number(candidate.provenance.packageVersion)>directPackage.artifact.version)))},participant.languageContext);
 const currentPack=currentMembership?.packageKey?await tx.get<InstalledPackage>('packageCache',currentMembership.packageKey):undefined;
 // Unfinished Steps may adopt material from the currently active Portable membership.
 const membership=currentPack?currentMembership:pinnedMembership;
 const baseline=runBaselineMaterial(participant),source=membership?(replace?membership.material:materialForNextStep(baseline,membership.material)):baseline;
 let material=source===baseline?structuredClone(baseline):materialForProtocolRun(source,run.purpose,participant.protocolRunId,at);
 // One materialization identity has one creation instant. Binding another
 // Step to it must reuse that snapshot, not mint a timestamp-only revision.
 const adopted=Object.values(participant.materializations).find(candidate=>candidate.snapshot.learningMaterializationId===material.snapshot.learningMaterializationId);
 if(adopted){material={...material,snapshot:{...material.snapshot,createdAt:adopted.snapshot.createdAt}};if(!backupEqual(adopted,material))throw new Error('localFlow.resourceInvalid');material=structuredClone(adopted);}
 if(replace&&previous&&backupEqual(previous,material))return false;
 assertLocalTargetMaterialIdentity(target,material);validateLightweightInitialMaterialization(material);
 const executable=localExecutableTargetForParticipant(target,participant,material),pack=executable.packageKey?await tx.get<InstalledPackage>('packageCache',executable.packageKey):undefined;
 validateLocalProtocolResources(execution,executable,pack);
 pinRunStepMaterial(participant,stepId,material);
 if(replace){
  if(!previous||!operationId)throw new Error('localFlow.resourceInvalid');
  run.lifecycleEvents.push({runRevision:run.revision,eventId:stableUuid(`local-run-material-refresh:${run.id}:${operationId}:${stepId}`),kind:'current_step_material_refreshed',operationId,targetId,stepId,materializationId:material.snapshot.learningMaterializationId,at});
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

const commitPolicy=(target:LocalLearningTarget,protocolRunId:string,at:string,profileVersion?:string):LocalCommittedLearningPolicy=>{
 if(target.committedPolicy)return target.committedPolicy;
 const profile=learningPolicyProfileRegistry.get(target.policyAssignment.profileId,profileVersion);
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
 const targetId=stableLearningTargetId(owner.learnerId,entry.senseId,entry.expressionId);
 const source={kind:enrollment.source.kind==='stable_sense'?'stable_sense':'sense_learning_package',curriculumEnrollmentId:enrollment.id,
  bookId:member.bookId,bookVersionId:member.bookVersionId,contentReleaseId:member.contentReleaseId,packageVersion:member.packageVersion,packageDigest:pack.digest,
  ...(member.publication?{publicationArchiveSha256:member.publication.bookArchiveSha256}:{})};
 const sourceKind=enrollment.source.kind==='stable_sense'?'stable_sense':'sense_learning_package',sourceKey=sourceKind==='stable_sense'?enrollment.id:publishedCurriculumSourceKey(enrollment.id,member.key,context,enrollment.source.kind==='published_book'?member.publication?.bookArchiveSha256:undefined);
 const membershipId=stableUuid(`local-curriculum-membership:${targetId}:${context.languageRouteId}:${sourceKind}:${sourceKey}`);
 const priorMembership=existing?.curriculumMemberships.find(candidate=>candidate.id===membershipId);
 const material=priorMembership?.material??materializePublishedEntry({learnerUserId:owner.learnerId,learningTargetId:targetId,curriculumMembershipId:membershipId,materializationOperationId:operationId,curriculumSource:source,packageKey:member.key,installedPackage:pack,entry,createdAt:at});
 const membership=curriculumMembership({operationId,targetId,sourceKey,languageContext:context,sourceKind,provenance:source,packageKey:member.key,assurancePackageKey:entry.assurancePackageKey,material,at,previous:priorMembership});
 if(existing){
  if(existing.identity.learnerUserId!==owner.learnerId||existing.identity.senseId!==entry.senseId||existing.identity.expressionId!==entry.expressionId||existing.targetLanguageTag!==pack.content.targetLanguage)throw new Error('localFlow.invalidTarget');
  const updated=upsertLocalCurriculumMembership(existing,membership);tx.put('learningTargets',targetId,updated);return updated;
 }
 const profileId=entry.assurancePackageKey?'high_assurance':'lightweight';
 const target:LocalLearningTarget={id:targetId,retentionId:stableUuid(`sensa-retention:${targetId}`),identity:{learnerUserId:owner.learnerId,senseId:entry.senseId,expressionId:entry.expressionId,targetLanguageTag:pack.content.targetLanguage},curriculumMemberships:[membership],expression:entry.expression,policyAssignment:createPolicyAssignment({operationId,targetId,profileId,scope:'curriculum_source',at,provenance:{curriculumEnrollmentId:enrollment.id,bookId:member.bookId,bookVersionId:member.bookVersionId,contentReleaseId:member.contentReleaseId,packageVersion:member.packageVersion}}),committedPolicy:null,planningOverrides:[],targetLanguageTag:pack.content.targetLanguage,introducedLanguageRouteId:null,createdAt:at,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
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
 }).sort((left,right)=>typeof left.publication.memberIndex==='number'&&typeof right.publication.memberIndex==='number'?left.publication.memberIndex-right.publication.memberIndex:left.key.localeCompare(right.key));
 if(matches.length!==source.memberCount)return [];
 const range=enrollment.bookPlan?.range;
 if(!range||range.selection.kind==='all')return matches;
 const selected=new Set(range.members.map(member=>JSON.stringify([member.packageKey,member.senseVersionId,member.bindingVersionId])));
 return matches.flatMap(member=>{
  const entries=member.pack.content.entries.filter(entry=>selected.has(JSON.stringify([member.key,entry.senseVersionId,entry.bindingVersionId])));
  return entries.length?[{...member,pack:{...member.pack,content:{...member.pack.content,entries}}}]:[];
 });
};

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
 const enrollmentMap=new Map(enrollments.map(enrollment=>[enrollment.id,enrollment]));
 const removed=Object.fromEntries((await tx.all<import('./supplementalMemberships').SupplementalMembershipState>('supplementalMembershipStates')).filter(state=>state.status==='removed').map(state=>[state.id,{introduce:false,ongoing:false}]));
 const routeTargets=targets.filter(target=>!!planningMembershipForContext(target,context,enrollmentMap,()=>true,removed));
 const startedToday=targets.filter(target=>target.introducedLanguageRouteId===context.languageRouteId&&target.startedAt&&sameLocalDay(target.startedAt,at)).length;
 const pending=routeTargets.filter(target=>!target.startedAt&&!target.completedAt&&!hasDeclaredMasteryOverride(target));
 let slots=Math.max(0,dailyLimit-startedToday-pending.length);
 if(!slots)return [];
 const packages=availablePackages??await tx.packageCacheProjection({kind:'summaries'});
 const byId=new Map(targets.map(target=>[target.id,target]));
 const hydratedPackages=new Map<string,InstalledPackage>();
 const active=enrollments.filter(enrollment=>enrollmentMatchesContext(enrollment,context)&&(enrollment.source.kind!=='published_book'||!enrollment.bookPlan||enrollment.bookPlan.mode==='active')).sort((left,right)=>left.id.localeCompare(right.id));
 const iterators=active.flatMap(enrollment=>{
  const members=enrollmentPackages(enrollment,packages);
  if(!members.length)return [];
  function* candidates(){
   for(const member of members)for(const entry of member.pack.content.entries){
    const targetId=stableLearningTargetId(owner.learnerId,entry.senseId,entry.expressionId);
    const existing=byId.get(targetId);
    if(existing&&existing.curriculumMemberships.some(source=>source.languageContext.languageRouteId===context.languageRouteId&&source.languageContext.targetLanguageTag===context.targetLanguageTag&&source.languageContext.supportLanguageTag===context.supportLanguageTag&&source.provenance.curriculumEnrollmentId===enrollment.id&&source.packageKey===member.key&&(enrollment.source.kind!=='published_book'||source.provenance.publicationArchiveSha256===enrollment.source.publicationArchiveSha256)&&source.status!=='superseded'))continue;
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
   const consumesNewSlot=!existing||!existing.startedAt&&!planningMembershipForContext(existing,context,enrollmentMap,()=>true,removed);
   const hydrated=await hydratedPackage(tx,member.key,hydratedPackages);
   const hydratedEntry=hydrated.content.entries.find(candidate=>candidate.senseVersionId===entry.senseVersionId&&candidate.bindingVersionId===entry.bindingVersionId);
   if(!hydratedEntry)throw new Error('localFlow.resourceInvalid');
   byId.set(targetId,await admitPublishedTarget(tx,{operationId,owner,context,enrollment,member,pack:hydrated,entry:hydratedEntry,existing,at}));
   ids.push(targetId);if(consumesNewSlot)slots--;
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
 const enrollment=await tx.get<LocalCurriculumEnrollment>('curriculumEnrollments',enrollmentId);if(!enrollment)throw new Error('localFlow.enrollFirst');
 const byId=new Map(targets.map(target=>[target.id,target]));
 const hydratedPackages=new Map<string,InstalledPackage>();
 const refreshed:string[]=[];
 for(const member of members)for(const entry of member.pack.content.entries){
  const targetId=stableLearningTargetId(owner.learnerId,entry.senseId,entry.expressionId),existing=byId.get(targetId);
  if(!existing)continue;
  const hadEnrollment=existing.curriculumMemberships.some(candidate=>candidate.provenance.curriculumEnrollmentId===enrollmentId);
  if(existing.identity.learnerUserId!==owner.learnerId||existing.identity.senseId!==entry.senseId||existing.identity.expressionId!==entry.expressionId||existing.targetLanguageTag!==member.pack.content.targetLanguage)throw new Error('localFlow.invalidTarget');
   const hydrated=await hydratedPackage(tx,member.key,hydratedPackages);
   const hydratedEntry=hydrated.content.entries.find(candidate=>candidate.senseVersionId===entry.senseVersionId&&candidate.bindingVersionId===entry.bindingVersionId);
   if(!hydratedEntry)throw new Error('localFlow.resourceInvalid');
  const source={kind:'sense_learning_package',curriculumEnrollmentId:enrollmentId,bookId:member.bookId,bookVersionId:member.bookVersionId,contentReleaseId:member.contentReleaseId,packageVersion:member.packageVersion,packageDigest:member.pack.digest,...(member.publication?{publicationArchiveSha256:member.publication.bookArchiveSha256}:{})};
  const archiveSha256=enrollment.source.kind==='published_book'?member.publication?.bookArchiveSha256:undefined;
  const membershipId=publishedCurriculumMembershipId(targetId,context,enrollmentId,member.key,archiveSha256);
  const prior=existing.curriculumMemberships.find(candidate=>candidate.id===membershipId);
  const material=prior?.material??materializePublishedEntry({learnerUserId:owner.learnerId,learningTargetId:targetId,curriculumMembershipId:membershipId,materializationOperationId:operationId,curriculumSource:source,packageKey:member.key,installedPackage:hydrated,entry:hydratedEntry,createdAt:at});
  const membership=curriculumMembership({operationId,targetId,sourceKey:publishedCurriculumSourceKey(enrollmentId,member.key,context,archiveSha256),languageContext:context,sourceKind:'sense_learning_package',provenance:source,packageKey:member.key,assurancePackageKey:entry.assurancePackageKey,material,at,previous:prior});
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
  title:reference.publication!.book.title,
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
  const bookPlan=source.kind==='published_book'?resolveBookPlan({operationId,at:now,mode:previous?.bookPlan?.mode??'active',selection:previous?.bookPlan?.range.selection??{kind:'all'},archiveSha256:source.publicationArchiveSha256,packages:available,previous:previous?.bookPlan}):undefined;
  if(bookPlan?.mode==='active')await maintainOtherBooks(tx,id,context.languageRouteId,operationId,now);
  const enrollment=curriculumEnrollmentSchema.parse({format:'sensa-curriculum-enrollment-v1',id,revision:(previous?.revision??0)+1,learnerUserId:owner.learnerId,languageContext:context,source,status:'active',...(bookPlan?{bookPlan}:{}),createdByOperationId:previous?.createdByOperationId??operationId,createdAt:previous?.createdAt??now,updatedAt:now});
  tx.put('curriculumEnrollments',id,enrollment);
  if(previous&&source.kind==='published_book'){
   const nextTargetIds=new Set(selected.flatMap(item=>item.pack.content.entries.map(entry=>stableLearningTargetId(owner.learnerId,entry.senseId,entry.expressionId))));
   for(const target of await tx.all<LocalLearningTarget>('learningTargets')){
    let revised=false;
    const curriculumMemberships=target.curriculumMemberships.map(membership=>{
     if(membership.status==='superseded'||membership.provenance.curriculumEnrollmentId!==id||nextTargetIds.has(target.id)&&membership.provenance.publicationArchiveSha256===source.publicationArchiveSha256)return membership;
     revised=true;
     return {...membership,status:'superseded' as const,revision:membership.revision+1,updatedAt:now};
    });
    if(revised)tx.put('learningTargets',target.id,{...target,curriculumMemberships});
   }
  }
 }
 const plans=await readStudyPlans(tx);
 const refreshed=changed?await refreshMaterializedEnrollmentMembers(tx,operationId,id,selected,context,now):[];
 const materialized=await materializeCurriculumWindowUnlessReviewOnly(tx,operationId,context,plans[context.languageRouteId]?.dailyNewSenseLimit??20,now,available);
 return [...new Set([...refreshed,...materialized])];
}

/** Prepare only the explicitly selected connection, never the containing Book. */
export function prepareDirectPublishedLearning(operationId:string,enrollmentId:string){
 return learningCommand({id:operationId,kind:'learning.prepareDirect',input:{enrollmentId}},async tx=>{
  const owner=await learningOwner(tx),raw=await tx.get('curriculumEnrollments',enrollmentId);
  if(!raw)throw new Error('localFlow.enrollFirst');const enrollment=curriculumEnrollmentSchema.parse(raw);
  if(enrollment.source.kind!=='stable_sense'||enrollment.status!=='active'||enrollment.learnerUserId!==owner.learnerId)throw new Error('localFlow.enrollFirst');
  const context=enrollment.languageContext;await requireLanguageRouteContext(tx,context);
  await assertSupplementalMembershipActive(tx,supplementalSourceDescriptor({kind:'stable_sense',id:enrollmentId},enrollment,owner.learnerId).id);
  const {selection}=enrollment.source,targetId=stableLearningTargetId(owner.learnerId,selection.reference.senseId,selection.reference.expressionId);
  const existing=await tx.get<LocalLearningTarget>('learningTargets',targetId);
  if(existing)assertDirectTargetIdentity(existing,selection,owner.learnerId);
  if(existing&&await directSourceAlreadyCovered(tx,targetId,context,selection,owner.learnerId))return {targetId,status:'already_in_scope' as const};
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

async function maintainOtherBooks(tx:LibraryTransaction,selectedId:string,routeId:string,operationId:string,at:string):Promise<void>{
 for(const other of await tx.all<LocalCurriculumEnrollment>('curriculumEnrollments')){
  if(other.id===selectedId||other.status!=='active'||other.source.kind!=='published_book'||other.languageContext.languageRouteId!==routeId||(other.bookPlan?.mode??'active')!=='active')continue;
  const bookPlan=reviseBookMode({operationId,at,mode:'maintenance',source:other.source,previous:other.bookPlan});
  tx.put('curriculumEnrollments',other.id,curriculumEnrollmentSchema.parse({...other,revision:other.revision+1,updatedAt:at,bookPlan}));
 }
}

/** Future arrangement only. Existing Sessions retain their original Scope. */
export async function changeBookPlan(input:{operationId:string;enrollmentId:string;expectedRevision:number;languageContext:SensaFormalPinnedLanguageContext;mode:BookEnrollmentMode;selection:BookRangeSelection}){
 return learningCommand({id:input.operationId,kind:'learning.bookPlan',input},async tx=>{
  const owner=await learningOwner(tx),context=sensaFormalPinnedLanguageContextSchema.parse(input.languageContext);await requireLanguageRouteContext(tx,context);
  const raw=await tx.get('curriculumEnrollments',input.enrollmentId);if(!raw)throw new Error('localFlow.enrollFirst');
  const previous=curriculumEnrollmentSchema.parse(raw);
  if(previous.source.kind!=='published_book'||previous.learnerUserId!==owner.learnerId||previous.status!=='active'||previous.revision!==input.expectedRevision||!sameLearningSessionDirection(previous.languageContext,context))throw new Error('localFlow.stepChanged');
  const selection=bookRangeSelectionSchema.parse(input.selection),at=new Date().toISOString();
  const unchanged=backupEqual(selection,previous.bookPlan?.range.selection??{kind:'all'});
  const bookPlan=unchanged?reviseBookMode({operationId:input.operationId,at,mode:input.mode,source:previous.source,previous:previous.bookPlan}):resolveBookPlan({operationId:input.operationId,at,mode:input.mode,selection,archiveSha256:previous.source.publicationArchiveSha256,packages:await tx.packageCacheProjection({kind:'summaries'}),previous:previous.bookPlan});
  if(input.mode==='active')await maintainOtherBooks(tx,previous.id,context.languageRouteId,input.operationId,at);
  tx.put('curriculumEnrollments',previous.id,curriculumEnrollmentSchema.parse({...previous,revision:previous.revision+1,bookPlan,updatedAt:at}));
  return true;
 });
}
/** Small projection for callers that only need Target facts. */
export const learningTargetsSnapshot=()=>readLibrary(tx=>tx.all<LocalLearningTarget>('learningTargets'));
export const readLearning=()=>readLibrary(async tx=>({targets:await tx.all<LocalLearningTarget>('learningTargets'),runs:await tx.all<LocalLearningRun>('learningRuns'),events:await tx.all<LearningEvent>('learningEvents'),active:await tx.get<string>('meta','learning-active'),studyPlans:await readStudyPlans(tx)}));
export async function confirmLearningQuantity(operationId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number){return learningCommand({id:operationId,kind:'learning.quantity',input:{languageContext,dailyLimit}},async tx=>{await learningOwner(tx);const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw new Error('localFlow.quantityRange');const plans=await readStudyPlans(tx),previous=plans[context.languageRouteId],at=new Date().toISOString();plans[context.languageRouteId]={languageRouteId:context.languageRouteId,routeRevision:context.languageRouteRevision,revision:(previous?.revision??0)+1,dailyNewSenseLimit:dailyLimit,updatedAt:at};writeStudyPlans(tx,plans);await materializeCurriculumWindowUnlessReviewOnly(tx,operationId,context,dailyLimit,at);return true;});}
async function materializeCurriculumWindowUnlessReviewOnly(tx:LibraryTransaction,operationId:string,context:SensaFormalPinnedLanguageContext,dailyLimit:number,at:string,availablePackages?:readonly InstalledPackageSummary[]){
 const active=await tx.get<string>('meta','learning-active'),run=active?await tx.get<LocalLearningRun>('learningRuns',active):null;
 if(run?.languageContext.languageRouteId===context.languageRouteId&&localRunSessionIntent(run)==='review_only')return [];
 return materializeCurriculumWindow(tx,operationId,context,dailyLimit,at,availablePackages);
}

export async function prepareLearningQueue(languageContext:SensaFormalPinnedLanguageContext,at=new Date().toISOString(),trigger='daily'){
 const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);
 const reviewOnly=await readLibrary(async tx=>{const active=await tx.get<string>('meta','learning-active');const run=active?await tx.get<LocalLearningRun>('learningRuns',active):null;return !!run&&run.languageContext.languageRouteId===context.languageRouteId&&localRunSessionIntent(run)==='review_only';});
 if(reviewOnly)return [];
 const fingerprint=await readLibrary(async tx=>{
  const plans=await readStudyPlans(tx),enrollments=(await tx.all<LocalCurriculumEnrollment>('curriculumEnrollments')).filter(item=>enrollmentMatchesContext(item,context));
  // Reading an empty Home must not leave a materialization receipt or pending
  // content revision when there is no Curriculum to prepare.
  if(!enrollments.some(item=>item.source.kind!=='published_book'||!item.bookPlan||item.bookPlan.mode==='active'))return null;
  const packages=await tx.packageCacheProjection({kind:'identities'});
  return JSON.stringify({trigger,day:new Date(at).toDateString(),languageContext:context,dailyLimit:plans[context.languageRouteId]?.dailyNewSenseLimit??20,enrollments:enrollments.map(item=>[item.id,item.revision]),packages:packages.map(item=>[item.key,item.digest]).sort()});
 });
 if(fingerprint===null)return [];
 const operationId=stableUuid(`local-learning-queue-window:${fingerprint}`);
 return learningCommand({id:operationId,kind:'learning.materialize',input:{languageContext:context,day:new Date(at).toDateString(),trigger}},async tx=>{
  await learningOwner(tx);await requireLanguageRouteContext(tx,context);
  const plans=await readStudyPlans(tx);
  return materializeCurriculumWindowUnlessReviewOnly(tx,operationId,context,plans[context.languageRouteId]?.dailyNewSenseLimit??20,at);
 });
}
export const readActiveLearningSessionIntent=()=>readLibrary(async tx=>{const active=await tx.get<string>('meta','learning-active');const run=active?await tx.get<LocalLearningRun>('learningRuns',active):null;return run?localRunSessionIntent(run):'mixed' as const;});
async function startLearningInTransaction(tx:LibraryTransaction,operationId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number,at:string,sessionIntent:LocalLearningSessionIntent='mixed',continuedFromRunId?:string):Promise<LocalLearningRun>{
 const requested=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,requested);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100||!Number.isFinite(Date.parse(at)))throw new Error('localFlow.confirmQuantity');
 let activity=await readActiveLearningSessionHeader(tx);
 const active=await tx.get<string>('meta','learning-active'),activeRun=active?await tx.get<LocalLearningRun>('learningRuns',active):null;
 if(continuedFromRunId&&activity&&(activity.activeRunId!==continuedFromRunId||active!==continuedFromRunId||activity.intent!==sessionIntent||!sameLearningSessionDirection(activity.languageContext,requested)))throw new Error('localFlow.stepChanged');
 const resuming=!!activeRun&&!activeRun.completedAt&&localRunTargetIds(activeRun).includes(targetId)&&sameLearningSessionDirection(activeRun.languageContext,requested);
 const reuse=!!activity&&(!!continuedFromRunId||resuming&&activity.intent===sessionIntent);
 const context=reuse?activity!.languageContext:requested;
 const plans=await readStudyPlans(tx);let plan=plans[context.languageRouteId];
 const initializePlan=!plan&&!reuse;
 if(initializePlan){
  if(dailyLimit!==DEFAULT_DAILY_NEW_SENSE_LIMIT)throw new Error('localFlow.confirmNewQuantity');
  // The default is configuration, not an outcome or a second user decision.
  // It commits atomically with a successful start; existing preferences stay.
  plan={languageRouteId:context.languageRouteId,routeRevision:context.languageRouteRevision,revision:1,dailyNewSenseLimit:DEFAULT_DAILY_NEW_SENSE_LIMIT,updatedAt:at};
  plans[context.languageRouteId]=plan;
 }
 if((reuse?activity!.dailyNewSenseLimit:plan?.dailyNewSenseLimit)!==dailyLimit&&!resuming)throw new Error('localFlow.confirmNewQuantity');
 let scope:LocalStudyScope|null=null;
 if(!reuse&&activity){endLearningSession(tx,activity,operationId,at,'session_switch');activity=null;}
 const memberFor=(target:LocalLearningTarget,purpose:LocalLearningRun['purpose'])=>currentStudyMembership(tx,target,context,purpose);
 const publishActivity=async(run:LocalLearningRun)=>{
  if(!reuse&&!scope){
   const targets:LocalLearningTarget[]=[],memberships=new Map<string,LocalCurriculumMembership>();
   for(const id of localRunTargetIds(run)){
    const target=await tx.get<LocalLearningTarget>('learningTargets',id);if(!target)throw new Error('localFlow.enrollFirst');
    const membership=await memberFor(target,run.purpose);if(!membership)throw new Error('localFlow.routeMembershipMissing');
    targets.push(target);memberships.set(id,membership);
   }
   scope=await captureStudyScope(tx,{operationId,learnerId:(await learningOwner(tx)).learnerId,context,dailyLimit,at,targets,memberships});
  }
  if(initializePlan)writeStudyPlans(tx,plans);
  if(reuse)focusLearningSession(tx,activity!,run);else createLearningSession(tx,scope!,run,operationId,sessionIntent,at);
 };
 if(!['mixed','review_only'].includes(sessionIntent))throw new Error('localFlow.resourceInvalid');
 const t=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!t)throw new Error('localFlow.enrollFirst');if(hasDeclaredMasteryOverride(t))throw new Error('localFlow.stepChanged');
 if(sessionIntent==='review_only'&&localLearningPurpose(t)==='initial_learning')throw new Error('localFlow.notDue');
 if(activeRun&&!activeRun.completedAt&&localRunTargetIds(activeRun).includes(targetId)&&activeRun.languageContext.languageRouteId===context.languageRouteId){
   if(Date.parse(at)<Date.parse(activeRun.startedAt))throw new Error('localFlow.stepChanged');
   if(!sameLearningSessionDirection(activeRun.languageContext,context))throw new Error('localFlow.stepChanged');
   activeRun.lifecycleEvents.push({runRevision:activeRun.revision,eventId:stableUuid(`local-run-intent:${activeRun.id}:${operationId}`),kind:'session_intent_selected',operationId,sessionIntent,requestedLanguageContext:context,...(continuedFromRunId?{continuedFromRunId}:{}),at});activeRun.revision++;tx.put('learningRuns',activeRun.id,activeRun);
  await publishActivity(activeRun);return activeRun;
 }
 const selectedMembership=await memberFor(t,localLearningPurpose(t));if(!selectedMembership)throw new Error('localFlow.routeMembershipMissing');
 if(activeRun&&!activeRun.completedAt){
  if(Date.parse(at)<Date.parse(activeRun.startedAt)||localRunOpenSessionPause(activeRun)||localRunOpenPlanningInterruption(activeRun))throw new Error('localFlow.clockChanged');
  activeRun.lifecycleEvents.push({runRevision:activeRun.revision,eventId:stableUuid(`local-run-session-pause:${activeRun.id}:${operationId}`),kind:'paused_for_session_switch',operationId,selectedTargetId:targetId,at});activeRun.revision++;tx.put('learningRuns',activeRun.id,activeRun);
 }
 const unfinishedId=(await tx.learningRunIdsForTarget(targetId,{openOnly:true}))[0];
 const unfinished=unfinishedId?await tx.get<LocalLearningRun>('learningRuns',unfinishedId):undefined;if(unfinished){
  for(const id of localRunTargetIds(unfinished)){const member=await tx.get<LocalLearningTarget>('learningTargets',id);if(!member||hasDeclaredMasteryOverride(member)||!await memberFor(member,unfinished.purpose))throw new Error('localFlow.stepChanged');}
  const interruption=localRunOpenPlanningInterruption(unfinished);
  const pause=localRunOpenSessionPause(unfinished);
  if(!interruption&&!pause)throw new Error('localFlow.stepChanged');
  if(!sameLearningSessionDirection(unfinished.languageContext,context))throw new Error('localFlow.stepChanged');
  if(Date.parse(at)<Date.parse((interruption??pause)!.at))throw new Error('localFlow.clockChanged');
  const selection={runRevision:unfinished.revision,eventId:stableUuid(`local-run-resume:${unfinished.id}:${operationId}`),operationId,sessionIntent,requestedLanguageContext:context,...(continuedFromRunId?{continuedFromRunId}:{}),at};
  unfinished.lifecycleEvents.push(pause?{...selection,kind:pause.kind==='paused_for_session_end'?'resumed_after_session_end':'resumed_after_session_switch',interruptionEventId:pause.eventId}:{...selection,kind:'resumed_after_planning_override',interruptionEventId:interruption!.eventId});unfinished.revision++;tx.put('learningRuns',unfinished.id,unfinished);
  tx.put('meta','learning-active',unfinished.id);await publishActivity(unfinished);return unfinished;
 }
 const now=new Date(at),purpose=localLearningPurpose(t);
 const dayStart=new Date(now);dayStart.setHours(0,0,0,0);const dayEnd=new Date(dayStart);dayEnd.setDate(dayEnd.getDate()+1);
 const introducedToday=await tx.countIntroducedLearningTargets(context.languageRouteId,dayStart.toISOString(),dayEnd.toISOString());
 const pack=selectedMembership.packageKey?await tx.get<InstalledPackage>('packageCache',selectedMembership.packageKey):undefined;
 const pinnedProfileVersion=learningPolicyProfileRegistry.get(t.committedPolicy?.profileId??t.policyAssignment.profileId,t.committedPolicy?.profileVersion).profileVersion;
 const readiness=requireLocalTargetReadiness(t,selectedMembership,pack,purpose,pinnedProfileVersion);
 const profileId=readiness.profileId,profile=learningPolicyProfileRegistry.get(profileId,readiness.profileVersion),runner=learningRuntimeCoordinator.localExecutionForBinding(readiness.binding,purpose);
 if(t.relearnAt&&now<new Date(t.relearnAt)||purpose==='retention_review'&&(!t.memory||now<t.memory.dueAt))throw new Error('localFlow.notDue');
 if(purpose==='initial_learning'&&!t.startedAt&&introducedToday>=dailyLimit)throw new Error('localFlow.dailyLimit');
 const binding=profile.protocols[purpose],schedulingPolicy=profile.lifecycle.schedulingPolicy;if(!binding.localProtocolVersion||!schedulingPolicy)throw new Error('localFlow.resourceInvalid');
 let participants=[t];
 const memberships=new Map<string,LocalCurriculumMembership>([[t.id,selectedMembership]]);
 if(runner.cohort){
  const targets=await tx.all<LocalLearningTarget>('learningTargets');
  const remaining=Math.max(0,dailyLimit-introducedToday),openTargetIds=new Set(await tx.openLearningTargetIds());
  const broadlyCompatible=[t,...targets.filter(v=>v.id!==t.id)].filter(v=>!hasDeclaredMasteryOverride(v)&&localTargetPolicy(v)===profileId&&localLearningPurpose(v)===purpose&&!openTargetIds.has(v.id)&&(purpose==='initial_learning'||(v.relearnAt?now>=new Date(v.relearnAt):!!v.memory&&now>=v.memory.dueAt)));
  const compatible:LocalLearningTarget[]=[];
  for(const candidate of broadlyCompatible){
   const candidateMembership=await memberFor(candidate,purpose);if(!candidateMembership)continue;
   const candidateResource=candidateMembership.packageKey?await tx.get<InstalledPackage>('packageCache',candidateMembership.packageKey):undefined;
   const candidateVersion=learningPolicyProfileRegistry.get(candidate.committedPolicy?.profileId??candidate.policyAssignment.profileId,candidate.committedPolicy?.profileVersion).profileVersion;
   if(candidateVersion===pinnedProfileVersion&&inspectLocalTargetReadiness(candidate,candidateMembership,candidateResource,purpose,candidateVersion).status==='ready'){compatible.push(candidate);memberships.set(candidate.id,candidateMembership);}
  }
  const selected=new Set(compatible.filter(v=>!v.startedAt).slice(0,remaining).map(v=>v.id));
  const candidates=compatible.filter(v=>v.startedAt||selected.has(v.id)).map(v=>({targetId:v.id,profileId,ready:true,executable:true}));
  const launch=purpose==='initial_learning'
   ?learningRuntimeCoordinator.planInitial(t.id,candidates)
   :(purpose==='retention_review'?learningRuntimeCoordinator.planRetention(candidates):learningRuntimeCoordinator.planRelearning(candidates)).find(v=>v.targetIds.includes(t.id));
  if(!launch?.targetIds.includes(t.id))throw new Error('localFlow.dailyLimit');
  participants=launch.targetIds.map(id=>targets.find(v=>v.id===id)!);
 }
 scope=await captureStudyScope(tx,{operationId,learnerId:(await learningOwner(tx)).learnerId,context,dailyLimit,at,targets:participants,memberships});
 const sessionId=crypto.randomUUID();
 const participantSnapshots:LocalLearningRun['participants']=Object.fromEntries(participants.map(participant=>{
  const membership=memberships.get(participant.id);if(!membership)throw new Error('localFlow.routeMembershipMissing');
  const protocolRunId=stableUuid(`local-protocol-run:${sessionId}:${participant.id}`);
  const policyCommitment=commitPolicy(participant,protocolRunId,at,pinnedProfileVersion);
  if(policyCommitment.profileId!==profileId||policyCommitment.profileVersion!==profile.profileVersion)throw new Error('localFlow.resourceInvalid');
  const material=materialForProtocolRun(membership.material,purpose,protocolRunId,at);
  const resolvedPlan=resolveRunPlan(participant,policyCommitment,purpose,material,at);
  participant.committedPolicy=policyCommitment;
  const materialReference=runMaterialDigest(material);
  return [participant.id,{retentionBaseline:retentionBaseline(participant),protocolRunId,curriculumMembershipId:membership.id,languageContext:context,startReason:{kind:purpose==='initial_learning'?'initial_learning_ready':purpose==='retention_review'?'due_review':'relearning_ready',selectionReason:participant.id===targetId?'requested_target':'cohort_candidate',triggerAt:at,triggerMemoryRevision:participant.memoryRevision},outcomePermissions:localProtocolOutcomePermissions(purpose,binding),material:materialReference,materializations:{[materialReference]:material},presentedMaterials:{},presentationOrder:[],policyCommitment,resolvedPlan,progress:createLocalProtocolProgress(protocolRunId,binding),memoryRevision:participant.memoryRevision,dueAt:participant.memory?.dueAt.toISOString()??null,evidenceIds:[]}];
 }));
 const run:LocalLearningRun={
  id:sessionId,startedByOperationId:operationId,...(continuedFromRunId?{continuedFromRunId}:{}),learningSessionId:reuse?activity!.id:stableUuid(`local-learning-session:${operationId}`),studyScopeRevisionId:scope.id,targetId,targetIds:participants.map(v=>v.id),
  participants:participantSnapshots,
  targetCompletions:{},languageContext:context,sessionIntent,purpose,policyProfileId:profileId,policyProfileVersion:profile.profileVersion,
  protocolBinding:structuredClone(binding),protocolVersion:binding.localProtocolVersion,
  protocolState:createLocalProtocolState(binding.runtimeAdapterId,null),
  schedulingPolicyId:profile.lifecycle.schedulingPolicyId,schedulingPolicy:structuredClone(schedulingPolicy),
  learnerVisibleClaimBoundary:profile.lifecycle.learnerVisibleClaimBoundary,
  ordinal:1,revision:1,lifecycleEvents:[],startedAt:at,completedAt:null,
 };
 for(const participant of participants){
  const membership=memberships.get(participant.id)!;
  const resources=membership.packageKey?await tx.get<InstalledPackage>('packageCache',membership.packageKey):undefined;
  requireLocalTargetReadiness(participant,membership,resources,purpose,pinnedProfileVersion);
 }
 run.protocolState=initializeLocalProtocolState({execution:runner,target:localExecutableTarget(t,selectedMembership),resource:pack,purpose,run});
 await bindCurrentStepMaterial(tx,run,at);
 for(const participant of participants)if(!participant.startedAt){participant.startedAt=at;participant.introducedLanguageRouteId=context.languageRouteId;tx.put('learningTargets',participant.id,participant);}
 tx.put('learningRuns',run.id,run);tx.put('meta','learning-active',run.id);await publishActivity(run);return run;
}
export async function startLearning(operationId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number,at=new Date().toISOString(),sessionIntent:LocalLearningSessionIntent='mixed'){
 const operation={id:operationId,kind:'learning.start',input:{targetId,languageContext,dailyLimit,at,sessionIntent}};
 const receipt=await learningCommand(operation,async tx=>{await learningOwner(tx);return learningRunReceipt(await startLearningInTransaction(tx,operationId,targetId,languageContext,dailyLimit,at,sessionIntent));});
 return readVerifiedLearningRunReceipt(operation,receipt);
}
export async function actLearning(operationId:string,runId:string,revision:number,action:LocalLearningAction,at=new Date().toISOString()){
 const operation={id:operationId,kind:'learning.act',input:{runId,revision,action,at}};
 const receipt=await learningCommand(operation,async tx=>{
 await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);
 if(!run||run.revision!==revision||run.completedAt||await tx.get('meta','learning-active')!==runId)throw new Error('localFlow.stepChanged');
 const execution=localExecutionForRun(run);
 const activeTargetId=localProtocolActiveTargetId(execution,run);
 const t=(await tx.get<LocalLearningTarget>('learningTargets',activeTargetId))!;
 await bindCurrentStepMaterial(tx,run,at);
 const stepId=localProtocolStepId(execution,run),participant=run.participants[activeTargetId]!,presentedMaterial=runStepMaterial(participant,stepId);
 if(!presentedMaterial)throw new Error('localFlow.resourceInvalid');
 if(Date.parse(presentedMaterial.snapshot.createdAt)>Date.parse(at))throw new Error('localFlow.clockChanged');
 const executable=localExecutableTargetForParticipant(t,participant,presentedMaterial);
 const scene:PersonalLearningScene|undefined=await readPersonalLearningSceneForAction(tx,t.id,participant.languageContext.languageRouteId);
 const sceneRevision=scene?.revisions.find(candidate=>candidate.revision===scene.currentRevision);
 const personalLearningScene=scene&&sceneRevision?{sceneId:scene.sceneId,revisionId:sceneRevision.revisionId,revision:sceneRevision.revision}:null;
 if(hasDeclaredMasteryOverride(t)||localRunOpenPlanningInterruption(run)||localRunOpenSessionPause(run))throw new Error('localFlow.stepChanged');
 if(!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(run.startedAt))throw new Error('localFlow.clockChanged');
 const pack=executable.packageKey?await tx.get<InstalledPackage>('packageCache',executable.packageKey):undefined;validateLocalProtocolResources(execution,executable,pack);
 const executed=reduceLocalProtocolAction({operationId,stepKey:stepId,execution,target:executable,run,resource:pack,action,at});
 const nextRun=executed.run;
 const applied=applyLocalProtocolTransition({operationId,stepId,at,target:t,run:nextRun,transition:executed.transition});
 nextRun.ordinal++;nextRun.revision++;if(!nextRun.completedAt)await bindCurrentStepMaterial(tx,nextRun,at);tx.put('learningRuns',nextRun.id,nextRun);tx.put('learningTargets',applied.target.id,applied.target);
 const nextTargetId=nextRun.completedAt?null:localProtocolActiveTargetId(execution,nextRun),nextStepId=nextTargetId?localProtocolStepId(execution,nextRun):null;
 const nextPresentation=nextTargetId&&nextStepId?{targetId:nextTargetId,stepId:nextStepId,material:nextRun.participants[nextTargetId]!.presentedMaterials[nextStepId]!}:null;
 tx.put('learningEvents',operationId,{id:operationId,runId,targetId:t.id,kind:action.kind,at,detail:{runRevision:revision,nextPresentation,stepId,materializationId:presentedMaterial.snapshot.learningMaterializationId,personalLearningScene,action,formalEvaluation:executed.facts,transition:applied.record}} satisfies LearningEvent);return learningRunReceipt(nextRun);
 });return readVerifiedLearningRunReceipt(operation,receipt);
}
export async function finishLearning(operationId:string,runId:string){const result=await learningCommand({id:operationId,kind:'learning.finish',input:{runId}},async tx=>{await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);if(!run?.completedAt)throw new Error('localFlow.finishFirst');if(await tx.get('meta','learning-active')===runId){tx.delete('meta','learning-active');const activity=await readActiveLearningSessionHeader(tx);if(activity){if(activity.activeRunId!==runId)throw new Error('localFlow.stepChanged');endLearningSession(tx,activity,operationId,new Date().toISOString(),'learner_finished');}}return true;});requestCloudCheckpoint();return result;}
/** End this activity, not its Protocol work or Introduction. A later explicit
 * start resumes the saved Run within a newly captured future arrangement. */
export async function endLearningActivity(operationId:string,runId:string,expectedRevision:number,at=new Date().toISOString()){
 const result=await learningCommand({id:operationId,kind:'learning.endSession',input:{runId,expectedRevision,at}},async tx=>{
  await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId),activity=await readActiveLearningSessionHeader(tx);
  if(!run||run.completedAt||run.revision!==expectedRevision||await tx.get('meta','learning-active')!==runId||!activity||activity.activeRunId!==runId||localRunOpenSessionPause(run)||localRunOpenPlanningInterruption(run))throw new Error('localFlow.stepChanged');
  const latestActionAt=await tx.latestLearningActionAt(runId);
  if(!Number.isFinite(Date.parse(at))||Date.parse(at)<Math.max(Date.parse(activity.startedAt),Date.parse(run.startedAt),latestActionAt?Date.parse(latestActionAt):0,...run.lifecycleEvents.map(event=>Date.parse(event.at))))throw new Error('localFlow.clockChanged');
  run.lifecycleEvents.push({runRevision:run.revision,eventId:stableUuid(`local-run-session-end:${run.id}:${operationId}`),kind:'paused_for_session_end',operationId,learningSessionId:activity.id,at});run.revision++;
  tx.put('learningRuns',run.id,run);endLearningSession(tx,activity,operationId,at,'learner_ended');tx.delete('meta','learning-active');return true;
 });requestCloudCheckpoint();return result;
}
/** Complete one Run and start its successor as one published library state.
 * Observers must never see an empty active-Run gap while the learner is moving
 * directly to the next target. */
export async function continueLearning(operationId:string,runId:string,targetId:string,languageContext:SensaFormalPinnedLanguageContext,dailyLimit:number,at=new Date().toISOString(),requiredPurpose?:'relearning'){
 const operation={id:operationId,kind:'learning.continue',input:{runId,targetId,languageContext,dailyLimit,at,...(requiredPurpose!==undefined?{requiredPurpose}:{})}};
 const result=await learningCommand(operation,async tx=>{
  await learningOwner(tx);
  const completed=await tx.get<LocalLearningRun>('learningRuns',runId);if(!completed?.completedAt)throw new Error('localFlow.finishFirst');
  if(Date.parse(at)<Date.parse(completed.completedAt))throw new Error('localFlow.clockChanged');
  if(!sameLearningSessionDirection(completed.languageContext,languageContext))throw new Error('localFlow.stepChanged');
  if(requiredPurpose!==undefined){
   assertLearningContinuationPurpose(operation.input,completed);
   const target=await tx.get<LocalLearningTarget>('learningTargets',targetId);
   if(await tx.get('meta','learning-active')!==runId||!target?.relearnAt||target.memoryRevision!==completed.participants[targetId]?.memoryRevision)throw new Error('localFlow.stepChanged');
  }
  return learningRunReceipt(await startLearningInTransaction(tx,operationId,targetId,languageContext,dailyLimit,at,localRunSessionIntent(completed),completed.id));
 });
 requestCloudCheckpoint();return readVerifiedLearningRunReceipt(operation,result);
}

/** The same runtime target is committed only after independent material validation. */
export async function commitPersonalMaterial(tx:LibraryTransaction,owner:LibraryIdentity,source:ContentProvisioningSource,languageContext:SensaFormalPinnedLanguageContext,content:LightweightInitialLearningMaterialization['content'],attemptId:string,grantId:string|null,replace=false,now=new Date().toISOString()){
 const {reference}=source,id=stableLearningTargetId(owner.learnerId,reference.senseId,reference.expressionId);
 const existing=await tx.get<LocalLearningTarget>('learningTargets',id);
 const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext),targetLanguageTag=source.targetLanguageTag;
 if(targetLanguageTag!==context.targetLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
 const material=materializeOnDemandContent({learnerUserId:owner.learnerId,learningTargetId:id,source,content,attemptId,personalAnchorUseGrantId:grantId,createdAt:now});
 const membershipId=provisioningMembershipId(reference,id,context.languageRouteId);
 await assertSupplementalMembershipActive(tx,membershipId);
 const previous=existing?.curriculumMemberships.find(candidate=>candidate.id===membershipId);
 if(existing&&previous&&!replace)return existing;
 const provenance=source.sourceKind==='stable_sense'?{kind:'stable_sense',curriculumEnrollmentId:source.reference.enrollmentId,sourceDigest:source.reference.sourceDigest}
   :{kind:'personal_meaning_alignment',personalMeaningId:source.reference.personalMeaningId,personalMeaningRevisionId:source.reference.personalMeaningRevisionId,alignmentBasisReferenceId:source.reference.alignmentBasisReferenceId,alignmentId:source.reference.personalMeaningAlignmentId};
 const membership=curriculumMembership({operationId:attemptId,targetId:id,sourceKey:source.sourceKind==='stable_sense'?source.reference.enrollmentId:source.reference.personalMeaningAlignmentId,languageContext:context,sourceKind:source.sourceKind,provenance,packageKey:null,material,at:now,previous});
 if(existing){const next=upsertLocalCurriculumMembership(existing,membership);tx.put('learningTargets',id,next);if(replace)await refreshCurrentStepsForMaterial(tx,id,now,attemptId);return next;}
 const target:LocalLearningTarget={id,retentionId:stableUuid(`sensa-retention:${id}`),identity:{learnerUserId:owner.learnerId,senseId:reference.senseId,expressionId:reference.expressionId,targetLanguageTag},curriculumMemberships:[membership],expression:source.expression.surfaceForm,policyAssignment:createPolicyAssignment({operationId:attemptId,targetId:id,profileId:'lightweight',scope:'system_default',at:now,provenance:{kind:source.sourceKind}}),committedPolicy:null,planningOverrides:[],targetLanguageTag,introducedLanguageRouteId:null,createdAt:now,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null,relearningState:null};
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
   if(!localRunOpenPlanningInterruption(run)){run.lifecycleEvents.push({runRevision:run.revision,eventId:stableUuid(`local-run-interruption:${run.id}:${operationId}`),kind:'interrupted_by_planning_override',operationId,targetId,overrideKind:'declared_mastery',at});run.revision++;tx.put('learningRuns',run.id,run);}
   tx.delete('meta','learning-active');
   const activity=await readActiveLearningSessionHeader(tx);if(activity)endLearningSession(tx,activity,operationId,at,'planning_override');
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

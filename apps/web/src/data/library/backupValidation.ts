import {localExecutionForRun} from '../../learning/runtime/runtimeCoordinator';
import {localRunBinding,localRunPolicy,localTargetPolicy} from '../../learning/runtime/localRuntimeBindings';
import {learningPolicyProfileRegistry} from '../../learning/runtime/policyProfiles';
import {localRunTargetIds,type LocalLearningRun,type LocalLearningTarget,type LearningEvent} from './learning';
import {z} from 'zod';
import {defaultSensaLanguageRouteCollection,sensaFormalPinnedLanguageContextSchema,sensaLanguageRouteCollectionSchema,sensaLearningMaterializationSnapshotSchema,sensaReadingGlossarySchema,semanticProposalSchema,sensaContentGenerationRequestSchema,sensaMaterialCandidateBundleSchema,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {stableUuid} from '@sensa/learning-kernel';
import {libraryTables,type Table} from './store';
import {validatePackage,packageKey} from './packages';
import {validateLightweightInitialMaterialization} from '../../learning/runtime/lightweightInitialContent';
import {providerInputSchema} from './providers';
import {conversationImagesSchema} from './conversationImages';
import {backupEqual} from './backupCodec';
import {applyLocalProtocolTransition} from './learningSettlement';
import {localLearningPurpose,localProtocolActiveTargetId,localProtocolOutcomePermissions,localProtocolStepId,localRunOpenPlanningInterruption,reduceLocalProtocolAction,replayLocalProtocolRun,validateLocalProtocolResources} from '../../learning/runtime/localProtocol';
import {hasDeclaredMasteryOverride} from '../../learning/runtime/targetPlanningOverrides';
import {personalLearningSceneRowId,type ContentAnnotation} from './contentAnnotations';
import {localExecutableTargetForParticipant} from '../../learning/runtime/localCurriculum';
export type BackupRows=Record<Table,{key:string;value:any}[]>;
const uuid=z.string().uuid(),timestamp=z.string().datetime({offset:true});
const identitySchema=z.object({id:uuid,learnerId:uuid,deviceId:uuid,createdAt:timestamp,schemaVersion:z.literal(1)}).strict();
export const backupOwnerSchema=z.object({subject:uuid,accountId:uuid,email:z.string().max(500).optional()}).strict();
const fail=():never=>{throw new Error('libraryBackup.errors.inconsistent');};
export function validateBackupRows(rows:BackupRows){
 const maps=Object.fromEntries(libraryTables.map(t=>[t,new Map(rows[t].map(r=>[r.key,r.value]))])) as Record<Table,Map<string,any>>;
 const requireRow=(table:Table,id:string)=>maps[table].get(id)??fail();
 const routeCollection=sensaLanguageRouteCollectionSchema.parse(maps.settings.get('language-learning-routes')??defaultSensaLanguageRouteCollection);
 const routes=new Map(routeCollection.routes.map(route=>[route.id,route]));
 const validateLanguageContext=(value:unknown)=>{const context=sensaFormalPinnedLanguageContextSchema.parse(value);const route=routes.get(context.languageRouteId);if(!route||route.targetLanguageTag!==context.targetLanguageTag||context.languageRouteRevision>route.revision)fail();return context;};
 const glossary=maps.settings.get('reading-glossary');if(glossary!==undefined)sensaReadingGlossarySchema.parse(glossary);
 const identity=identitySchema.parse(requireRow('meta','identity'));
 for(const table of ['drafts','sessions','meanings','learningTargets','learningRuns','learningEvents','personalLearning','contentAttempts','providers'] as Table[])for(const {key,value:v} of rows[table]){if(!v||key!==v.id)fail();uuid.parse(key);}
 for(const {value:d} of rows.drafts){uuid.parse(d.id);z.number().int().positive().parse(d.revision);z.string().max(16000).parse(d.text);if(d.images)conversationImagesSchema.parse(d.images);timestamp.parse(d.createdAt);timestamp.parse(d.updatedAt);}
 for(const {value:s} of rows.sessions){const d=requireRow('drafts',s.draftId);if(s.draftRevision>d.revision)fail();if(s.candidate)semanticProposalSchema.parse(s.candidate);if(s.inputImages)conversationImagesSchema.parse(s.inputImages);if(s.contextSummary!==undefined)z.string().min(1).max(16000).parse(s.contextSummary);if(Array.isArray(s.messages))conversationImagesSchema.parse([...(s.inputImages??[]),...s.messages.flatMap((m:any)=>m.images??[])]);if(!Array.isArray(s.messages)||!Number.isInteger(s.revision)||s.revision<1)fail();if(!['idle','waiting','proposal','inflight','failed','stopped','accepted'].includes(s.status))fail();if(s.status==='accepted'&&requireRow('meanings',s.meaningId).sessionId!==s.id)fail();}
 for(const {key,value:v} of rows.identities){z.string().regex(/^[a-f0-9]{64}$/u).parse(key);for(const field of ['senseId','senseVersionId','bindingId','bindingVersionId'])uuid.parse(v[field]);}
 for(const {value:m} of rows.meanings){z.string().max(16000).parse(m.context);const revision=z.number().int().positive().parse(m.contextRevision??1);if((m.contextHistory?.length??0)!==revision-1)fail();if(m.contextImages)conversationImagesSchema.parse(m.contextImages);if(m.contextHistory)for(const [index,h] of m.contextHistory.entries()){if(h.revision!==index+1)fail();z.string().max(16000).parse(h.text);conversationImagesSchema.parse(h.images);}semanticProposalSchema.parse(m.proposal);for(const key of ['id','senseId','senseVersionId','bindingId','bindingVersionId','contextAnchorId','expressionAnchorId','alignmentId','acceptanceId'])uuid.parse(m[key]);const d=requireRow('drafts',m.draftId),s=requireRow('sessions',m.sessionId);if(m.draftRevision>d.revision||s.meaningId!==m.id||s.status!=='accepted'||!backupEqual(m.proposal,s.candidate)||(m.contextHistory?.[0]?.text??m.context)!==(s.contextSummary??s.input)||!rows.identities.some(({value:v})=>['senseId','senseVersionId','bindingId','bindingVersionId'].every(k=>v[k]===m[k])))fail();}
 for(const {key,value:p} of rows.packages){validatePackage(p.bundle);if(key!==p.key||key!==packageKey(p.bundle))fail();z.string().regex(/^[a-f0-9]{64}$/u).parse(p.digest);}
 for(const {value:p} of rows.providers){const {revision,...fields}=p;providerInputSchema.parse({...fields,expectedRevision:revision-1});}
 for(const {key,value:op} of rows.operations){uuid.parse(key);if(typeof op?.input!=='string')fail();const input=JSON.parse(op.input);if(canonicalConsumerJson(input)!==op.input||typeof input.kind!=='string'||input.kind.startsWith('service.'))fail();timestamp.parse(op.committedAt);if(op.cloudReceipt!==undefined&&(op.cloudReceipt!==true||op.result!==null||['library.create','intake.receive'].includes(input.kind)))fail();}
 const operationInput=(id:string)=>{const operation=maps.operations.get(id);return operation?JSON.parse(operation.input):undefined;};
 // Manual backups still carry the complete device ledger and therefore retain its
 // creation receipt. Cloud Checkpoints intentionally contain no operation rows.
 if(rows.operations.length){const creation=maps.operations.get('00000000-0000-4000-8000-000000000001');if(!creation||operationInput('00000000-0000-4000-8000-000000000001').kind!=='library.create'||!backupEqual(creation.result,identity))fail();}
 for(const {value:t} of rows.personalLearning){const current=requireRow('meanings',t.meaningId);if(current.id!==t.meaning.id)fail();const context=validateLanguageContext(t.languageContext);if(current.targetLanguageTag!==context.targetLanguageTag||t.id!==stableUuid(`sensa-personal-learning:${t.meaningId}:${context.languageRouteId}`))fail();uuid.parse(t.curriculumMembershipId);const version=(current.contextRevision??1)===(t.meaning.contextRevision??1)?{text:current.context,images:current.contextImages??[]}:current.contextHistory?.find((v:any)=>v.revision===(t.meaning.contextRevision??1));if(!version||version.text!==t.meaning.context||!backupEqual(version.images,t.meaning.contextImages??[]))fail();if(current.senseVersionId!==t.meaning.senseVersionId||current.bindingVersionId!==t.meaning.bindingVersionId||!backupEqual(current.proposal,t.meaning.proposal))fail();if(t.attemptId&&requireRow('contentAttempts',t.attemptId).taskId!==t.id)fail();if(t.status==='ready'&&!requireRow('learningTargets',t.targetId).curriculumMemberships.some((membership:any)=>membership.id===t.curriculumMembershipId))fail();if(!['waiting','generating','reviewing','failed','rejected','stopped','ready'].includes(t.status))fail();}
 for(const {value:a} of rows.contentAttempts){requireRow('personalLearning',a.taskId);if(a.request)sensaContentGenerationRequestSchema.parse(a.request);if(a.bundle){sensaMaterialCandidateBundleSchema.parse(a.bundle);if(!a.request||a.bundle.contentGenerationRequestId!==a.request.contentGenerationRequestId)fail();}if(a.resumedFrom)requireRow('contentAttempts',a.resumedFrom);}
 for(const {key,value:a} of rows.annotations as {key:string;value:ContentAnnotation}[]){
  if(!a||a.id!==key||!['word_note','sense_note','saved_sense','saved_example','semantic_anchor','learning_scene'].includes(a.kind))fail();
  if(a.kind==='word_note'){z.string().min(1).max(500).parse(a.word);z.string().min(1).max(1000).parse(a.body);z.number().int().nonnegative().parse(a.updatedAt);}
  if(a.kind==='sense_note'){z.string().min(1).max(2000).parse(a.senseId);z.string().min(1).max(1000).parse(a.body);z.number().int().nonnegative().parse(a.updatedAt);}
  if(a.kind==='saved_sense'){z.string().min(1).max(2000).parse(a.senseId);z.number().int().nonnegative().parse(a.createdAt);}
  if(a.kind==='saved_example'){z.string().min(1).max(2000).parse(a.exampleId);z.number().int().nonnegative().parse(a.createdAt);}
  if(a.kind==='semantic_anchor'){uuid.parse(a.anchorId);z.string().min(1).max(2000).parse(a.senseId);z.string().max(1000).parse(a.body);z.number().int().nonnegative().parse(a.createdAt);z.number().int().nonnegative().parse(a.updatedAt);z.array(z.object({mediaId:uuid,kind:z.literal('image'),dataUrl:z.string().startsWith('data:image/').max(8*1024*1024),mimeType:z.string().min(1).max(200),fileName:z.string().min(1).max(500),altText:z.string().max(80)}).strict()).max(3).parse(a.media);if(!a.body.trim()&&!a.media.length)fail();}
  if(a.kind==='learning_scene'){
   uuid.parse(a.sceneId);uuid.parse(a.learningTargetId);uuid.parse(a.languageRouteId);uuid.parse(a.senseId);uuid.parse(a.senseVersionId);uuid.parse(a.bindingVersionId);z.number().int().positive().parse(a.currentRevision);z.number().int().nonnegative().parse(a.createdAt);z.number().int().nonnegative().parse(a.updatedAt);
   const target=requireRow('learningTargets',a.learningTargetId),membershipIds=new Set(target.curriculumMemberships.filter((membership:any)=>membership.languageContext.languageRouteId===a.languageRouteId).map((membership:any)=>membership.id));
   if(target.identity.senseId!==a.senseId||target.identity.senseVersionId!==a.senseVersionId||target.identity.bindingVersionId!==a.bindingVersionId||a.revisions.length!==a.currentRevision||new Set(a.revisions.map((revision:any)=>revision.revisionId)).size!==a.revisions.length)fail();
   for(const [index,revision] of a.revisions.entries()){uuid.parse(revision.revisionId);if(revision.revision!==index+1||!membershipIds.has(revision.curriculumMembershipId))fail();z.string().max(1000).parse(revision.body);z.number().int().nonnegative().parse(revision.createdAt);z.array(z.object({mediaId:uuid,kind:z.literal('image'),dataUrl:z.string().startsWith('data:image/').max(8*1024*1024),mimeType:z.string().min(1).max(200),fileName:z.string().min(1).max(500),altText:z.string().max(80)}).strict()).max(3).parse(revision.media);if(!revision.body.trim()&&!revision.media.length)fail();}
   if((a.acceptedRevisionId===null)!==(a.acceptedPersonalMeaningId===null)||a.acceptedRevisionId!==null&&!a.revisions.some((revision:any)=>revision.revisionId===a.acceptedRevisionId))fail();
   if(a.acceptedPersonalMeaningId!==null)uuid.parse(a.acceptedPersonalMeaningId);
  }
 }
 for(const {value:t} of rows.learningTargets){
  learningPolicyProfileRegistry.get(localTargetPolicy(t));
  const assignment=t.policyAssignment;
  uuid.parse(assignment.assignmentId);z.number().int().positive().parse(assignment.revision);timestamp.parse(assignment.assignedAt);learningPolicyProfileRegistry.get(assignment.profileId);
  const identityFields=['learnerUserId','senseId','senseVersionId','senseExpressionBindingId','bindingVersionId','targetLanguageTag'] as const;
  for(const field of identityFields)z.string().min(1).parse(t.identity[field]);
  if(t.identity.learnerUserId!==identity.learnerId||t.identity.targetLanguageTag!==t.targetLanguageTag||t.id!==stableUuid(`sensa-learning-target:${identity.learnerId}:${t.identity.senseVersionId}:${t.identity.bindingVersionId}`)||t.retentionId!==stableUuid(`sensa-retention:${t.id}`))fail();
  if(t.committedPolicy){const commitment=t.committedPolicy;uuid.parse(commitment.commitmentId);uuid.parse(commitment.committedByProtocolRunId);z.number().int().positive().parse(commitment.revision);timestamp.parse(commitment.committedAt);const profile=learningPolicyProfileRegistry.get(commitment.profileId,commitment.profileVersion);if(!t.startedAt||commitment.assignmentId!==assignment.assignmentId||commitment.assignmentRevision!==assignment.revision||profile.profileId!==commitment.profileId)fail();}else if(t.startedAt)fail();
  z.array(z.object({kind:z.literal('declared_mastery'),source:z.literal('learner'),operationId:uuid,createdAt:timestamp}).strict()).max(1).parse(t.planningOverrides);
  for(const override of t.planningOverrides){const op=operationInput(override.operationId);if(op&&(op.kind!=='learning.declareMastery'||op.input.targetId!==t.id||op.input.active!==true||op.input.at!==override.createdAt))fail();}
  if(!Array.isArray(t.curriculumMemberships)||!t.curriculumMemberships.length||new Set(t.curriculumMemberships.map((membership:any)=>membership.id)).size!==t.curriculumMemberships.length)fail();
  for(const membership of t.curriculumMemberships){
   uuid.parse(membership.id);z.number().int().positive().parse(membership.revision);if(membership.status!==undefined&&!['active','superseded'].includes(membership.status))fail();uuid.parse(membership.createdByOperationId);timestamp.parse(membership.createdAt);timestamp.parse(membership.updatedAt);if(Date.parse(membership.updatedAt)<Date.parse(membership.createdAt))fail();
   const context=validateLanguageContext(membership.languageContext);if(context.targetLanguageTag!==t.targetLanguageTag)fail();
   sensaLearningMaterializationSnapshotSchema.parse(membership.material.snapshot);validateLightweightInitialMaterialization(membership.material);
   const p=membership.material.snapshot.provenance;
   if(membership.material.snapshot.learnerUserId!==identity.learnerId||membership.material.snapshot.learningTargetId!==t.id||p.senseId!==t.identity.senseId||p.senseVersionId!==t.identity.senseVersionId||p.bindingId!==t.identity.senseExpressionBindingId||p.bindingVersionId!==t.identity.bindingVersionId)fail();
   if(t.expression!==membership.material.content.resources.find((r:any)=>r.materialRoleKey==='target_expression')?.contentPayload.surface)fail();
   if(membership.sourceKind==='sense_learning_package'){
    if(!membership.packageKey||membership.id!==stableUuid(`local-curriculum-membership:${t.id}:${context.languageRouteId}:sense_learning_package:${membership.packageKey}`))fail();
    const pack=requireRow('packages',membership.packageKey),entry=pack.bundle.entries.find((e:any)=>e.senseVersionId===p.senseVersionId&&e.bindingVersionId===p.bindingVersionId);
    if(!entry||pack.bundle.targetLanguage!==context.targetLanguageTag||pack.bundle.supportLanguage!==context.supportLanguageTag||!backupEqual(entry.content,membership.material.content)||entry.assurancePackageKey!==membership.assurancePackageKey)fail();
   }else if(membership.sourceKind==='personal_meaning_alignment'){
    const provenance=membership.provenance as any;if(membership.packageKey!==null||membership.assurancePackageKey!==undefined||!provenance?.meaningId||!provenance?.alignmentId||membership.id!==stableUuid(`local-curriculum-membership:${t.id}:${context.languageRouteId}:personal_meaning_alignment:${provenance.alignmentId}`))fail();
    const meaning=requireRow('meanings',provenance.meaningId),attempt=requireRow('contentAttempts',p.attemptId);
    if(meaning.alignmentId!==provenance.alignmentId||attempt.status!=='ready'||!(attempt.review?.accepted||(attempt.reviewProvider===null&&attempt.review===null&&attempt.validation?.review===null&&attempt.validation?.validations?.length>0&&attempt.validation.validations.every((v:any)=>v.status==='accepted')))||!backupEqual(attempt.validation?.content,membership.material.content))fail();
   }else fail();
  }
  if(t.introducedLanguageRouteId!==null&&!t.curriculumMemberships.some((membership:any)=>membership.languageContext.languageRouteId===t.introducedLanguageRouteId))fail();
 }
 // Replay each run once, including every participating Target in a shared cohort.
 const targets=new Map<string,LocalLearningTarget>(rows.learningTargets.map(({value:t})=>[t.id,{...t,memory:null,memoryRevision:0,completedAt:null,relearnAt:null,relearningState:null,startedAt:null}]));
 const unfinished=new Set<string>();
 const runs:LocalLearningRun[]=rows.learningRuns.map(r=>r.value).sort((a,b)=>a.startedAt.localeCompare(b.startedAt));
 const knownProtocolRunIds=new Set<string>();
 for(const saved of runs){
  const runLanguageContext=validateLanguageContext(saved.languageContext);
  const ids=localRunTargetIds(saved);
  if(!Array.isArray(saved.lifecycleEvents))fail();
  let openInterruption:ReturnType<typeof localRunOpenPlanningInterruption>=null;
  const lifecycleEventIds=new Set<string>();
  for(const event of saved.lifecycleEvents){
   uuid.parse(event.eventId);uuid.parse(event.operationId);timestamp.parse(event.at);if(lifecycleEventIds.has(event.eventId)||Date.parse(event.at)<Date.parse(saved.startedAt))fail();lifecycleEventIds.add(event.eventId);
   const op=operationInput(event.operationId);
   if(event.kind==='interrupted_by_planning_override'){
    if(openInterruption||event.overrideKind!=='declared_mastery'||!ids.includes(event.targetId)||op&&(op.kind!=='learning.declareMastery'||op.input.targetId!==event.targetId||op.input.active!==true||op.input.at!==event.at))fail();
    openInterruption=event;
   }else if(event.kind==='resumed_after_planning_override'){
    if(!openInterruption||event.interruptionEventId!==openInterruption.eventId||op&&(op.kind!=='learning.start'||op.input.at!==event.at||!ids.includes(op.input.targetId)))fail();
    openInterruption=null;
   }else if(event.kind==='current_step_material_refreshed'){
    const participant=saved.participants[event.targetId]??fail(),target=requireRow('learningTargets',event.targetId),membership=target.curriculumMemberships.find((candidate:any)=>candidate.id===participant.curriculumMembershipId),attempt=requireRow('contentAttempts',event.operationId),task=requireRow('personalLearning',attempt.taskId),sourceMaterializationId=stableUuid(`sensa-personal-material:${event.operationId}`);
    if(attempt.status!=='ready'||task.targetId!==event.targetId||membership?.sourceKind!=='personal_meaning_alignment'||!ids.includes(event.targetId)||!participant.presentedMaterials?.[event.stepId]||op&&(op.kind!=='personal.prepare'||attempt.taskId!==op.input.id)||event.eventId!==stableUuid(`local-run-material-refresh:${saved.id}:${event.operationId}:${event.stepId}`)||event.materializationId!==stableUuid(`local-run-materialization:${participant.protocolRunId}:${sourceMaterializationId}`))fail();
   }else fail();
  }
  if(localRunOpenPlanningInterruption(saved)?.eventId!==openInterruption?.eventId)fail();
  if(!ids.length||new Set(ids).size!==ids.length||!ids.includes(saved.targetId)||!Object.keys(saved.targetCompletions).every(id=>ids.includes(id)))fail();
  const execution=localExecutionForRun(saved),binding=localRunBinding(saved);
  const profile=learningPolicyProfileRegistry.get(localRunPolicy(saved),saved.policyProfileVersion);
  if(!backupEqual(saved.protocolBinding,profile.protocols[saved.purpose]))fail();
  if(!backupEqual(saved.schedulingPolicy,profile.lifecycle.schedulingPolicy)||saved.schedulingPolicyId!==profile.lifecycle.schedulingPolicyId||saved.learnerVisibleClaimBoundary!==profile.lifecycle.learnerVisibleClaimBoundary)fail();
  if(ids.length>1&&!execution.cohort||!backupEqual(Object.keys(saved.participants).sort(),[...ids].sort()))fail();
  for(const [id,participant] of Object.entries(saved.participants)){
   const target=targets.get(id)??fail();
   const membership=target.curriculumMemberships.find(candidate=>candidate.id===participant.curriculumMembershipId)??fail(),samePair=(left:any,right:any)=>left.languageRouteId===right.languageRouteId&&left.targetLanguageTag===right.targetLanguageTag&&left.supportLanguageTag===right.supportLanguageTag;if(!backupEqual(participant.languageContext,runLanguageContext)||!samePair(membership.languageContext,participant.languageContext))fail();
   uuid.parse(participant.protocolRunId);if(knownProtocolRunIds.has(participant.protocolRunId))fail();knownProtocolRunIds.add(participant.protocolRunId);
   const validateRunMaterial=(material:typeof participant.material)=>{
    validateLightweightInitialMaterialization(material);const materialProvenance=material.snapshot.provenance as any;
    if(material.snapshot.learningTargetId!==id||material.snapshot.learnerUserId!==identity.learnerId||material.snapshot.protocolPurpose!==saved.purpose||materialProvenance.senseId!==target.identity.senseId||materialProvenance.senseVersionId!==target.identity.senseVersionId||materialProvenance.bindingId!==target.identity.senseExpressionBindingId||materialProvenance.bindingVersionId!==target.identity.bindingVersionId)fail();
    if(membership.sourceKind==='sense_learning_package'){
     const membershipPackageKey=z.string().min(1).parse(membership.packageKey),pack=requireRow('packages',membershipPackageKey),entry=pack.bundle.entries.find((candidate:any)=>candidate.senseVersionId===materialProvenance.senseVersionId&&candidate.bindingVersionId===materialProvenance.bindingVersionId);
     if(!entry||!backupEqual(entry.content,material.content))fail();
    }else{
     const attempt=requireRow('contentAttempts',materialProvenance.attemptId);if(attempt.status!=='ready'||!backupEqual(attempt.validation?.content,material.content))fail();
    }
   };
   validateRunMaterial(participant.material);if(!participant.presentedMaterials||typeof participant.presentedMaterials!=='object'||Array.isArray(participant.presentedMaterials))fail();for(const [stepId,material] of Object.entries(participant.presentedMaterials)){if(!stepId.trim())fail();validateRunMaterial(material);}
   const commitment=participant.policyCommitment,plan=participant.resolvedPlan;
   uuid.parse(commitment.commitmentId);uuid.parse(commitment.committedByProtocolRunId);uuid.parse(plan.resolvedLearningPlanRevisionId);
   if(!backupEqual(commitment,target.committedPolicy)||plan.learningTargetId!==id||plan.retentionTargetId!==target.retentionId||plan.purpose!==saved.purpose||plan.profileId!==commitment.profileId||plan.profileVersion!==commitment.profileVersion||plan.readiness!=='ready'||!backupEqual(plan.protocolBinding,saved.protocolBinding)||!backupEqual(plan.contentDemands,saved.protocolBinding.contentDemands)||!backupEqual(plan.learningMaterializationIds,[participant.material.snapshot.learningMaterializationId]))fail();
   const progress=participant.progress;
   if(progress.protocolRunId!==participant.protocolRunId||progress.protocolId!==saved.protocolBinding.protocolId||progress.protocolVersion!==saved.protocolBinding.protocolVersion||!backupEqual(Object.keys(progress.checkpointCredits).sort(),[...saved.protocolBinding.checkpointDefinitionIds].sort()))fail();
   if(progress.completed!==Object.hasOwn(saved.targetCompletions,id))fail();
   const expectedStartKind=saved.purpose==='initial_learning'?'initial_learning_ready':saved.purpose==='retention_review'?'due_review':'relearning_ready';
   if(participant.startReason.kind!==expectedStartKind||participant.startReason.selectionReason!==(id===saved.targetId?'requested_target':'cohort_candidate')||participant.startReason.triggerAt!==saved.startedAt||participant.startReason.triggerMemoryRevision!==participant.memoryRevision||!backupEqual(participant.outcomePermissions,localProtocolOutcomePermissions(saved.purpose,saved.protocolBinding)))fail();
   if(saved.policyProfileId!==commitment.profileId||saved.policyProfileVersion!==commitment.profileVersion||!Array.isArray(participant.evidenceIds)||participant.evidenceIds.some(id=>!uuid.safeParse(id).success))fail();
  }
  timestamp.parse(saved.startedAt);
  if(saved.protocolVersion!==binding.localProtocolVersion)fail();
  for(const id of ids){
   const target=targets.get(id)??fail(),trigger=saved.participants[id]??fail();
   if(unfinished.has(id)||localLearningPurpose(target)!==saved.purpose||trigger.memoryRevision!==target.memoryRevision||trigger.dueAt!==(target.memory?.dueAt.toISOString()??null))fail();
   if(saved.purpose==='retention_review'&&(!target.memory||Date.parse(saved.startedAt)<target.memory.dueAt.getTime())||target.relearnAt&&Date.parse(saved.startedAt)<Date.parse(target.relearnAt))fail();
   target.startedAt??=saved.startedAt;
   const executable=localExecutableTargetForParticipant(target,trigger),pack=executable.packageKey?requireRow('packages',executable.packageKey):undefined;
   validateLocalProtocolResources(execution,executable,pack);
  }
  const primary=targets.get(saved.targetId)??fail();
  const primaryExecutable=localExecutableTargetForParticipant(primary,saved.participants[saved.targetId]??fail());
  let run=replayLocalProtocolRun({execution,target:primaryExecutable,resource:primaryExecutable.packageKey?requireRow('packages',primaryExecutable.packageKey):undefined,saved});
  if(!Object.hasOwn(saved,'completionKind'))delete run.completionKind;
  const events:LearningEvent[]=rows.learningEvents.map(r=>r.value).filter(e=>e.runId===saved.id);
  const byStep=new Map(events.map(e=>[(e.detail as any)?.stepId,e]));if(byStep.size!==events.length)fail();
  for(let index=0;index<events.length;index++){
   const event=byStep.get(localProtocolStepId(execution,run))??fail();
   const targetId=localProtocolActiveTargetId(execution,run);
   if(!ids.includes(targetId)||event.targetId!==targetId||run.completedAt)fail();
   const target=targets.get(targetId)??fail(),participant=run.participants[targetId]??fail();
   timestamp.parse(event.at);if(Date.parse(event.at)<Date.parse(run.startedAt))fail();
   const detail=event.detail as any,presented=participant.presentedMaterials[detail.stepId]??fail();if(event.kind!==detail.action?.kind||detail.materializationId!==presented.snapshot.learningMaterializationId||!Object.hasOwn(detail,'personalLearningScene'))fail();
   if(detail.personalLearningScene!==null){
    const scene=requireRow('annotations',personalLearningSceneRowId(targetId,participant.languageContext.languageRouteId));
    const pinned=z.object({sceneId:uuid,revisionId:uuid,revision:z.number().int().positive()}).strict().parse(detail.personalLearningScene),sceneRevision=scene.kind==='learning_scene'&&scene.sceneId===pinned.sceneId?scene.revisions.find((candidate:any)=>candidate.revisionId===pinned.revisionId):undefined;
    if(!sceneRevision||sceneRevision.revision!==pinned.revision||sceneRevision.createdAt>Date.parse(event.at))fail();
   }
   const executable=localExecutableTargetForParticipant(target,participant,presented);
   const executed=reduceLocalProtocolAction({operationId:event.id,stepKey:detail.stepId,execution,target:executable,run,resource:executable.packageKey?requireRow('packages',executable.packageKey):undefined,action:detail.action,at:event.at});
   const applied=applyLocalProtocolTransition({operationId:event.id,stepId:detail.stepId,at:event.at,target,run:executed.run,transition:executed.transition});
   if(!backupEqual(executed.facts,detail.formalEvaluation)||!backupEqual(applied.record,detail.transition)||executed.facts&&!backupEqual(executed.facts.step.learningMaterializationIds,[detail.materializationId]))fail();targets.set(targetId,applied.target);run=executed.run;run.ordinal++;run.revision++;
  }
  if(!backupEqual(run,saved))fail();if(!run.completedAt)ids.forEach(id=>unfinished.add(id));
 }
 for(const {value:t} of rows.learningTargets)if(t.committedPolicy&&!knownProtocolRunIds.has(t.committedPolicy.committedByProtocolRunId))fail();
 for(const {value:t} of rows.learningTargets)for(const key of ['memory','memoryRevision','startedAt','completedAt','relearnAt','relearningState'] as const)if(!backupEqual(targets.get(t.id)![key],t[key]))fail();
 for(const {value:r} of rows.learningRuns){const context=validateLanguageContext(r.languageContext);requireRow('learningTargets',r.targetId);for(const [id,participant] of Object.entries(r.participants as LocalLearningRun['participants'])){const target=requireRow('learningTargets',id);validateLightweightInitialMaterialization(participant.material);if(participant.material.snapshot.learningTargetId!==id||participant.material.snapshot.learnerUserId!==identity.learnerId||!backupEqual(participant.languageContext,context)||!target.curriculumMemberships.some((membership:any)=>membership.id===participant.curriculumMembershipId&&membership.languageContext.languageRouteId===context.languageRouteId&&membership.languageContext.targetLanguageTag===context.targetLanguageTag&&membership.languageContext.supportLanguageTag===context.supportLanguageTag))fail();}}
 for(const {key,value:e} of rows.learningEvents){
  const eventRun=requireRow('learningRuns',e.runId),op=operationInput(key),presented=eventRun.participants[e.targetId]?.presentedMaterials?.[e.detail.stepId];if(!presented||e.detail.materializationId!==presented.snapshot.learningMaterializationId||op&&(op.kind!=='learning.act'||op.input.runId!==e.runId||op.input.at!==e.at||!backupEqual(op.input.action,e.detail.action)))fail();
  const facts=e.detail.formalEvaluation;if(facts){
   for(const id of [facts.step.protocolStepInstanceId,facts.step.protocolRunId,facts.action.actionId,facts.attempt.attemptId,facts.observation.observationId,facts.evaluation.evaluationId,facts.transitionDecision.transitionDecisionId])uuid.parse(id);
   if(!backupEqual(facts.step.learningMaterializationIds,[e.detail.materializationId])||facts.step.protocolRunId!==eventRun.participants[e.targetId]?.protocolRunId||facts.action.protocolStepInstanceId!==facts.step.protocolStepInstanceId||facts.attempt.actionId!==facts.action.actionId||facts.observation.attemptId!==facts.attempt.attemptId||facts.evaluation.observationId!==facts.observation.observationId||facts.evaluation.protocolRunId!==facts.step.protocolRunId||facts.evaluation.evaluationPolicyId!==eventRun.protocolBinding.evaluationPolicyId||facts.transitionDecision.observationId!==facts.observation.observationId||!backupEqual(facts.observation.evidenceIds,facts.evidence.map((v:any)=>v.learningEvidenceId)))fail();
   for(const evidence of facts.evidence){uuid.parse(evidence.learningEvidenceId);if(evidence.observationId!==facts.observation.observationId||evidence.attemptId!==facts.attempt.attemptId||evidence.protocolRunId!==facts.step.protocolRunId||evidence.learningTargetId!==e.targetId)fail();}
  }
 }
 const active=maps.meta.get('learning-active');if(active)requireRow('learningRuns',active);if(active&&(localRunOpenPlanningInterruption(requireRow('learningRuns',active))||localRunTargetIds(requireRow('learningRuns',active)).some(id=>hasDeclaredMasteryOverride(requireRow('learningTargets',id)))))fail();for(const {key,value:r} of rows.learningRuns)if(!r.completedAt&&key!==active&&!localRunOpenPlanningInterruption(r))fail();
 const studyPlans=maps.settings.get('language-route-study-plans');if(studyPlans!==undefined){if(!studyPlans||typeof studyPlans!=='object'||Array.isArray(studyPlans))fail();for(const [routeId,plan] of Object.entries(studyPlans as Record<string,any>)){const route=routes.get(routeId);if(!route||plan.languageRouteId!==routeId||plan.routeRevision>route.revision)fail();z.number().int().positive().parse(plan.routeRevision);z.number().int().positive().parse(plan.revision);z.number().int().min(1).max(100).parse(plan.dailyNewSenseLimit);timestamp.parse(plan.updatedAt);}}
 return identity;
}

import {generateLearningCandidate,type ContentGenerationStep} from './contentGenerationLoop';
import {z} from 'zod';
import {stableUuid} from '@sensa/learning-kernel';
import {makeRequest,validateBundle,modelFacts,independentReviewSystem,requestLanguages,SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND,canonicalConsumerJson,sensaFormalPinnedLanguageContextSchema,type SensaContentGenerationRequest,type SensaMaterialCandidateBundle,type ContentReviewer,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction} from './store';
import {learningOwner} from './libraryOwnership';
import {commitPersonalMaterial,type LocalLearningTarget} from './learning';
import {
 personalLearningSourceKey,
 personalLearningSourceRevision,
 type PersonalMeaningLearningReference,
 type PersonalMeaningLearningSource,
} from './personalLearningSource';
import {defaultSensaProvider,type Provider,type ProviderSettings} from './providers';
import {complete,digest} from './transport';
import {requireLanguageRouteContext} from './language';
export type PersonalLearning={replacing?:boolean;id:string;source:PersonalMeaningLearningReference;targetId:string;curriculumMembershipId:string;languageContext:SensaFormalPinnedLanguageContext;planRevision:string;useContext:boolean;status:'waiting'|'generating'|'reviewing'|'failed'|'rejected'|'stopped'|'ready';attemptId:string|null;leaseUntil:number;notice:string;createdAt:string};
export type ContentAttempt={generationSteps?:ContentGenerationStep[];id:string;taskId:string;createdAt:string;contentProvider:Provider;reviewProvider:Provider|null;request:SensaContentGenerationRequest|null;bundle:SensaMaterialCandidateBundle|null;review:Awaited<ReturnType<ContentReviewer>>|null;validation:Awaited<ReturnType<typeof validateBundle>>|null;status:string;resumedFrom:string|null;grant:{id:string;contextDigest:string;recipients:string[]}|null};
export const personalLearningSnapshot=()=>readLibrary(tx=>tx.all<PersonalLearning>('personalLearning'));
/** The UI controller consumes one transactionally coherent preparation view. */
export const personalLearningControlSnapshot=()=>readLibrary(async tx=>{
 const tasks=await tx.all<PersonalLearning>('personalLearning');
 const targets=await tx.all<LocalLearningTarget>('learningTargets');
 const settings=await tx.get<ProviderSettings>('settings','providers')??{revision:0,assignments:{}};
 const providers=[defaultSensaProvider,...await tx.all<Provider>('providers')];
 const selected=(purpose:'content'|'review')=>{
  const id=settings.assignments[purpose]??defaultSensaProvider.id;
  const provider=providers.find(candidate=>candidate.id===id);
  if(!provider)throw new Error('localFlow.selectProvider');
  return provider;
 };
 return {tasks,targets,providers:{content:selected('content'),review:settings.modelReviewEnabled===true?selected('review'):null}};
});
const currentSource=(task:PersonalLearning,source:PersonalMeaningLearningSource)=>{
 if(canonicalConsumerJson(task.source)!==canonicalConsumerJson(source.reference))throw new Error('localFlow.meaningChanged');
};
export async function enrollPersonal(operationId:string,source:PersonalMeaningLearningSource,languageContext:SensaFormalPinnedLanguageContext,useContext:boolean){return command({id:operationId,kind:'personal.enroll',input:{source:source.reference,languageContext,useContext}},async tx=>{
 const owner=await learningOwner(tx),context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);
 if(source.targetLanguageTag!==context.targetLanguageTag)throw new Error('localFlow.routeLanguageMismatch');
 const sourceKey=personalLearningSourceKey(source.reference),taskId=stableUuid(`sensa-personal-learning:${sourceKey}:${context.languageRouteId}`),existing=await tx.get<PersonalLearning>('personalLearning',taskId);if(existing){currentSource(existing,source);return existing;}
 const targetId=stableUuid(`sensa-learning-target:${owner.learnerId}:${source.reference.senseVersionId}:${source.reference.bindingVersionId}`);
 const curriculumMembershipId=stableUuid(`local-curriculum-membership:${targetId}:${context.languageRouteId}:personal_meaning_alignment:${source.reference.personalMeaningAlignmentId}`);
 const target=await tx.get<LocalLearningTarget>('learningTargets',targetId),ready=target?.curriculumMemberships.some(membership=>membership.id===curriculumMembershipId);
 const task:PersonalLearning={id:taskId,source:structuredClone(source.reference),targetId,curriculumMembershipId,languageContext:context,planRevision:crypto.randomUUID(),useContext,status:ready?'ready':'waiting',attemptId:null,leaseUntil:0,notice:'',createdAt:new Date().toISOString()};tx.put('personalLearning',task.id,task);return task;
});}
async function checkProvider(tx:LibraryTransaction,purpose:'content'|'review',provider:Provider){const settings=await tx.get<ProviderSettings>('settings','providers');const id=settings?.assignments[purpose]??defaultSensaProvider.id;const current=id===defaultSensaProvider.id?defaultSensaProvider:await tx.get<Provider>('providers',id);if(canonicalConsumerJson(current??null)!==canonicalConsumerJson(provider))throw new Error('localFlow.providerChanged');}
async function checkReviewPolicy(tx:LibraryTransaction,review:Provider|null){
 const settings=await tx.get<ProviderSettings>('settings','providers');
 if((settings?.modelReviewEnabled===true)!==(review!==null))throw new Error('localFlow.providerChanged');
}
async function active(tx:LibraryTransaction,id:string,attemptId:string,source:PersonalMeaningLearningSource,content:Provider,review:Provider|null){
 const owner=await learningOwner(tx),task=await tx.get<PersonalLearning>('personalLearning',id);
 if(!task||task.attemptId!==attemptId||!['generating','reviewing'].includes(task.status)||task.leaseUntil<Date.now())throw new Error('localFlow.preparationExpired');
 currentSource(task,source);await checkReviewPolicy(tx,review);await checkProvider(tx,'content',content);if(review)await checkProvider(tx,'review',review);return {owner,task};
}
export async function stopPersonalPreparation(operationId:string,id:string){return command({id:operationId,kind:'personal.stop',input:{id}},async tx=>{await learningOwner(tx);const task=await tx.get<PersonalLearning>('personalLearning',id);if(task&&task.status!=='ready'){task.status='stopped';task.leaseUntil=0;task.notice='localFlow.preparationStopped';tx.put('personalLearning',id,task);if(task.attemptId){const attempt=await tx.get<ContentAttempt>('contentAttempts',task.attemptId);if(attempt){attempt.status='stopped';tx.put('contentAttempts',attempt.id,attempt);}}}return true;});}
/** Explicit invocation only. Reloading reads saved states and never starts a model request. */
export async function preparePersonal(id:string,source:PersonalMeaningLearningSource,contentProvider:Provider,reviewProvider:Provider|null,signal:AbortSignal,onSaved:()=>void){
 const attemptId=crypto.randomUUID();
 const begun=await command({id:attemptId,kind:'personal.prepare',input:{id,contentProvider,reviewProvider}},async tx=>{
  const owner=await learningOwner(tx),task=await tx.get<PersonalLearning>('personalLearning',id);if(!task)throw new Error('localFlow.enrollFirst');currentSource(task,source);
  await checkReviewPolicy(tx,reviewProvider);await checkProvider(tx,'content',contentProvider);if(reviewProvider)await checkProvider(tx,'review',reviewProvider);
  if(task.status==='ready')return null;
  const target=await tx.get<LocalLearningTarget>('learningTargets',task.targetId);
  if(!task.replacing&&target?.curriculumMemberships.some(membership=>membership.id===task.curriculumMembershipId)){task.status='ready';task.leaseUntil=0;tx.put('personalLearning',id,task);return null;}
  if(['generating','reviewing'].includes(task.status)&&task.leaseUntil>Date.now())throw new Error('localFlow.preparationBusy');
  const attempts=(await tx.all<ContentAttempt>('contentAttempts')).filter(a=>a.taskId===id&&Date.parse(a.createdAt)>Date.now()-86400000);if(import.meta.env.VITE_SENSA_UNLIMITED_PREPARATION!=='true'&&attempts.length>=6)throw new Error('localFlow.preparationLimit');
  const prior=task.attemptId?await tx.get<ContentAttempt>('contentAttempts',task.attemptId):undefined;
  // Continue a saved candidate after transport interruption without repeating generation.
  const reuse=prior?.bundle&&prior.request&&task.status!=='rejected'&&canonicalConsumerJson(prior.contentProvider)===canonicalConsumerJson(contentProvider)&&(reviewProvider===null||canonicalConsumerJson(prior.reviewProvider)===canonicalConsumerJson(reviewProvider))?prior:null;
  const attempt:ContentAttempt={id:attemptId,taskId:id,createdAt:new Date().toISOString(),contentProvider,reviewProvider,request:reuse?.request??null,bundle:reuse?.bundle??null,review:null,validation:null,status:reuse?'reviewing':'generating',resumedFrom:reuse?.id??null,grant:reuse?.grant??null};
  task.attemptId=attemptId;task.status=reuse?'reviewing':'generating';task.leaseUntil=Date.now()+120000;task.notice='';tx.put('personalLearning',id,task);tx.put('contentAttempts',attemptId,attempt);return {task,attempt,owner};
 });if(!begun)return;onSaved();
 const runSignal=AbortSignal.any([signal,AbortSignal.timeout(100000)]);
 const save=async(work:(tx:LibraryTransaction,task:PersonalLearning,attempt:ContentAttempt)=>Promise<void>)=>command({id:crypto.randomUUID(),kind:'personal.progress',input:{id,attemptId,nonce:crypto.randomUUID()}},async tx=>{const {task}=await active(tx,id,attemptId,source,contentProvider,reviewProvider);if(runSignal.aborted)throw new Error('localFlow.requestStopped');const attempt=(await tx.get<ContentAttempt>('contentAttempts',attemptId))!;await work(tx,task,attempt);tx.put('personalLearning',id,task);tx.put('contentAttempts',attemptId,attempt);});
 try{
  let {request,bundle,grant}=begun.attempt;const m=source;
  if(!request||!bundle){
   grant=begun.task.useContext?{id:crypto.randomUUID(),contextDigest:await digest(m.context),recipients:[...new Set([contentProvider.endpoint,...(reviewProvider?[reviewProvider.endpoint]:[])])]}:null;
   request=await makeRequest({id,learner_user_id:begun.owner.learnerId,learning_target_id:begun.task.targetId,fixed_input:{targetLanguageTag:begun.task.languageContext.targetLanguageTag,supportLanguageTag:begun.task.languageContext.supportLanguageTag,senseId:m.reference.senseId,senseVersionId:m.reference.senseVersionId,bindingId:m.reference.bindingId,bindingVersionId:m.reference.bindingVersionId,planRevision:begun.task.planRevision,expression:m.expression.surfaceForm,expressionKind:m.expression.expressionType==='word'?'word':'phrase',meaning:m.semanticSpec.coreMeaningFocus,prototype:m.semanticSpec.prototypeScenes[0].summary,...(grant?{anchor:{sentence:m.context.text,images:m.context.images,contextVersion:grant.contextDigest,grantId:grant.id}}:{}),demand:SENSA_LIGHTWEIGHT_INITIAL_CONTENT_DEMAND}},attemptId,new Date());
   request={...request,attemptBudget:{...request.attemptBudget,maxModelTurns:3}};
   await save(async(_tx,_task,a)=>{a.request=request;a.grant=grant;});
   bundle=await generateLearningCandidate(request,contentProvider,!!grant,runSignal,async step=>{await save(async(_tx,_task,a)=>{a.generationSteps=[...(a.generationSteps??[]),step];});});
   await save(async(_tx,task,a)=>{a.bundle=bundle;task.status='reviewing';a.status='reviewing';});onSaved();
  }
  let review:ContentAttempt['review']=null;
  if(reviewProvider){
  const {images:reviewImages,...reviewCue}=bundle.candidates.find(c=>c.materialRoleKey==='experience_recall_cue')!.contentPayload;
  const reviewed=await complete(reviewProvider,'review',crypto.randomUUID(),[{role:'system',content:independentReviewSystem(requestLanguages(request))+' The candidate may use attached context images and offline declarative HTML to evoke experience. Judge the combined content. scene may be empty when images or interaction convey it. No image OCR or cropping requirement is imposed.'},{role:'user',images:reviewImages as import('./conversationImages').ConversationImage[]|undefined,content:JSON.stringify({facts:modelFacts(request),cue:reviewCue})}],[],runSignal);
  const message=reviewed.choices[0]!.message;if(message.tool_calls?.length)throw new Error('localFlow.reviewToolDenied');
  review={...z.object({accepted:z.boolean(),reason:z.string().max(2000)}).strict().parse(JSON.parse(message.content??'null')),provider:reviewProvider.id,model:reviewed.model};
  }
  const checked=await validateBundle(request,bundle,review,new Date());
  await save(async(tx,task,a)=>{a.review=review;a.validation=checked;task.leaseUntil=0;if(checked.content){await commitPersonalMaterial(tx,begun.owner,source,task.languageContext,checked.content,attemptId,grant?.id??null,task.replacing);task.replacing=false;task.status='ready';a.status='ready';task.notice='localFlow.materialReady';}else{task.status='rejected';a.status='rejected';task.notice=review?'localFlow.reviewRejected'+review.reason:'localFlow.validationRejected';}});onSaved();
 }catch(error){
  await command({id:crypto.randomUUID(),kind:'personal.fail',input:{id,attemptId}},async tx=>{const task=await tx.get<PersonalLearning>('personalLearning',id);if(task?.attemptId===attemptId&&['generating','reviewing'].includes(task.status)){task.status='failed';task.leaseUntil=0;task.notice=signal.aborted?'localFlow.preparationInterrupted':error instanceof Error&&error.message.startsWith('localFlow.')?error.message:'localFlow.preparationFailed';tx.put('personalLearning',id,task);const a=await tx.get<ContentAttempt>('contentAttempts',attemptId);if(a){a.status='failed';tx.put('contentAttempts',attemptId,a);}}return null;});onSaved();throw error;
 }
}

export async function requestPersonalResourceUpdate(operationId:string,taskId:string,source:PersonalMeaningLearningSource,languageContext:SensaFormalPinnedLanguageContext,useContext:boolean){return command({id:operationId,kind:'personal.update-resources',input:{taskId,source:source.reference,languageContext,useContext}},async tx=>{
 await learningOwner(tx);const context=sensaFormalPinnedLanguageContextSchema.parse(languageContext);await requireLanguageRouteContext(tx,context);
 const task=await tx.get<PersonalLearning>('personalLearning',taskId);if(!task)throw Error('localFlow.enrollFirst');
 if(['generating','reviewing'].includes(task.status)&&task.leaseUntil>Date.now())throw Error('localFlow.preparationBusy');
 if(task.languageContext.languageRouteId!==context.languageRouteId)throw Error('localFlow.routeMembershipMissing');
 if(source.targetLanguageTag!==context.targetLanguageTag)throw Error('localFlow.routeLanguageMismatch');
 const unchanged=personalLearningSourceRevision(task.source)===personalLearningSourceRevision(source.reference)&&task.languageContext.languageRouteRevision===context.languageRouteRevision&&task.languageContext.supportLanguageTag===context.supportLanguageTag&&task.useContext===useContext;
 if(unchanged)throw Error('localFlow.resourcesUnchanged');
 task.source=structuredClone(source.reference);task.languageContext=context;task.useContext=useContext;task.replacing=true;task.planRevision=crypto.randomUUID();task.attemptId=null;task.status='waiting';task.notice='';tx.put('personalLearning',task.id,task);return task;
});}

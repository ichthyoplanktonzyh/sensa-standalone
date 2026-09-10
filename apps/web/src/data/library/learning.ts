import {stableUuid,canonicalJsonDigest,consumerRunStepId,transitionConsumerRun,decideConsumerSettlement,type ReviewSchedule} from '@sensa/learning-kernel';
import {sensaLearningMaterializationSnapshotSchema,sensaLearningConnectionContractVersion,LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction,type LibraryIdentity} from './store';
import {learningOwner,type InstalledPackage} from './packages';
import {validateLightweightInitialMaterialization,type LightweightInitialLearningMaterialization} from '../../experience/learningRuntime/lightweightInitialContent';
export type LocalLearningTarget={id:string;retentionId:string;packageKey:string|null;expression:string;meaning:string;material:LightweightInitialLearningMaterialization;createdAt:string;startedAt:string|null;completedAt:string|null;memory:ReviewSchedule|null;memoryRevision:number;relearnAt:string|null};
export type LocalLearningRun={id:string;targetId:string;purpose:'initial_learning'|'retention_review'|'relearning';protocolVersion:string;phase:'recall'|'reveal';ordinal:number;revision:number;startedAt:string;completedAt:string|null;memoryRevision:number;dueAt:string|null;completionKind?:string};
export type LearningEvent={id:string;runId:string;targetId:string;kind:string;at:string;detail:unknown};
export async function enrollPackage(operationId:string,key:string){return command({id:operationId,kind:'learning.enroll',input:{key}},async tx=>{
 const owner=await learningOwner(tx),pack=await tx.get<InstalledPackage>('packages',key);if(!pack)throw new Error('请先下载完整学习包。');
 const ids:string[]=[];
 for(const e of pack.bundle.entries){
  const id=stableUuid(`sensa-learning-target:${owner.learnerId}:${e.senseVersionId}:${e.bindingVersionId}`);ids.push(id);
  if(await tx.get('learningTargets',id))continue;
  const snapshot=sensaLearningMaterializationSnapshotSchema.parse({contractVersion:sensaLearningConnectionContractVersion,learningMaterializationId:stableUuid(`sensa-material:${owner.learnerId}:${key}:${id}`),learnerUserId:owner.learnerId,learningTargetId:id,protocolPurpose:'initial_learning',provisioningPath:'published',contentSchemaVersion:LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,contentPayload:e.content,contentDigest:canonicalJsonDigest(e.content),validationStatus:'validated',validatorVersion:'sensa-web-package-v1',provenance:{packageId:pack.bundle.id,packageVersion:pack.bundle.version,packageDigest:pack.digest,senseId:e.senseId,senseVersionId:e.senseVersionId,bindingId:e.bindingId,bindingVersionId:e.bindingVersionId},personalAnchorUseGrantIds:[],createdAt:new Date().toISOString()});
  const target:LocalLearningTarget={id,retentionId:stableUuid(`sensa-retention:${id}`),packageKey:key,expression:e.expression,meaning:e.meaning,material:{snapshot,content:e.content},createdAt:snapshot.createdAt,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null};
  tx.put('learningTargets',id,target);
 }
 return ids;
});}
export const readLearning=()=>readLibrary(async tx=>({targets:await tx.all<LocalLearningTarget>('learningTargets'),runs:await tx.all<LocalLearningRun>('learningRuns'),events:await tx.all<LearningEvent>('learningEvents'),active:await tx.get<string>('meta','learning-active'),dailyLimit:await tx.get<number>('settings','learning-daily-limit')}));
export async function confirmLearningQuantity(operationId:string,dailyLimit:number){return command({id:operationId,kind:'learning.quantity',input:{dailyLimit}},async tx=>{await learningOwner(tx);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)throw new Error('每日数量应在 1 至 100 之间。');tx.put('settings','learning-daily-limit',dailyLimit);return true;});}
const day=(date:Date)=>`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
export async function startLearning(operationId:string,targetId:string,dailyLimit:number,at=new Date().toISOString()){return command({id:operationId,kind:'learning.start',input:{targetId,dailyLimit,at}},async tx=>{
 await learningOwner(tx);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100||!Number.isFinite(Date.parse(at)))throw new Error('请确认每日学习数量。');
 if(await tx.get('settings','learning-daily-limit')!==dailyLimit)throw new Error('请先确认每日新学数量。');
 const active=await tx.get<string>('meta','learning-active');if(active){const run=await tx.get<LocalLearningRun>('learningRuns',active);if(run)return run;}
 const t=await tx.get<LocalLearningTarget>('learningTargets',targetId);if(!t)throw new Error('请先加入学习。');validateLightweightInitialMaterialization(t.material);
 const unfinished=(await tx.all<LocalLearningRun>('learningRuns')).find(r=>r.targetId===targetId&&!r.completedAt);if(unfinished){tx.put('meta','learning-active',unfinished.id);return unfinished;}
 const now=new Date(at),purpose=t.relearnAt?'relearning':t.completedAt?'retention_review':'initial_learning';
 if(t.relearnAt&&now<new Date(t.relearnAt)||purpose==='retention_review'&&(!t.memory||now<t.memory.dueAt))throw new Error('这项内容尚未到复习时间。');
 if(purpose==='initial_learning'&&!t.startedAt&&(await tx.all<LocalLearningTarget>('learningTargets')).filter(v=>v.startedAt&&day(new Date(v.startedAt))===day(now)).length>=dailyLimit)throw new Error('今天的新学数量已达上限，已下载内容仍然保留。');
 const run:LocalLearningRun={id:crypto.randomUUID(),targetId,purpose,protocolVersion:purpose==='initial_learning'?'consumer-initial-v1':purpose==='retention_review'?'consumer-review-v1':'consumer-relearning-v1',phase:'recall',ordinal:1,revision:1,startedAt:at,completedAt:null,memoryRevision:t.memoryRevision,dueAt:t.memory?.dueAt.toISOString()??null};
 if(!t.startedAt){t.startedAt=at;tx.put('learningTargets',t.id,t);}
 tx.put('learningRuns',run.id,run);tx.put('meta','learning-active',run.id);return run;
});}
export async function actLearning(operationId:string,runId:string,revision:number,action:{kind:'reveal'}|{kind:'rate';rating:'again'|'hard'|'good'},at=new Date().toISOString()){return command({id:operationId,kind:'learning.act',input:{runId,revision,action,at}},async tx=>{
 await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);
 if(!run||run.revision!==revision||run.completedAt||await tx.get('meta','learning-active')!==runId)throw new Error('学习步骤已改变，请读取最新进度。');
 const t=(await tx.get<LocalLearningTarget>('learningTargets',run.targetId))!;
 if(!Number.isFinite(Date.parse(at))||Date.parse(at)<Date.parse(run.startedAt))throw new Error('设备时间有变化，请检查后重试。');
 const stepId=consumerRunStepId(run.id,run.ordinal,run.phase,run.protocolVersion);
 const next=transitionConsumerRun(run.protocolVersion,run.phase,action);let settlement:unknown=null;
 if(action.kind==='rate'){
  const common={retentionTargetId:t.retentionId,protocolVersion:run.protocolVersion,rating:action.rating,occurredAt:new Date(at)};
  const result=run.purpose==='retention_review'?decideConsumerSettlement({...common,purpose:'retention_review',memory:{revision:String(t.memoryRevision),dueAt:t.memory!.dueAt,schedule:{...t.memory!,cardId:t.retentionId}},trigger:{memoryRevision:String(run.memoryRevision),dueAt:new Date(run.dueAt!)}}):decideConsumerSettlement({...common,purpose:run.purpose});settlement=result;
  if(result.kind==='study_completion'||result.kind==='review_completed'){t.memory=result.schedule;t.memoryRevision++;if(result.kind==='study_completion')t.completedAt=at;else t.relearnAt=result.nextEligibleAt?.toISOString()??null;}
  if(result.kind==='wait_relearning')t.relearnAt=result.nextEligibleAt.toISOString();
  if(result.kind==='relearning_completion')t.relearnAt=null;
  if(next==='completed'||next==='waiting')run.completionKind=result.kind;
  tx.put('learningTargets',t.id,t);
 }
 if(next==='completed'||next==='waiting')run.completedAt=at;else run.phase=next;
 run.ordinal++;run.revision++;tx.put('learningRuns',run.id,run);
 tx.put('learningEvents',operationId,{id:operationId,runId,targetId:t.id,kind:action.kind,at,detail:{stepId,action,settlement}} satisfies LearningEvent);return run;
});}
export async function finishLearning(operationId:string,runId:string){return command({id:operationId,kind:'learning.finish',input:{runId}},async tx=>{await learningOwner(tx);const run=await tx.get<LocalLearningRun>('learningRuns',runId);if(!run?.completedAt)throw new Error('请先完成当前学习。');if(await tx.get('meta','learning-active')===runId)tx.delete('meta','learning-active');return true;});}

/** The same runtime target is committed only after independent material validation. */
export async function commitPersonalMaterial(tx:LibraryTransaction,owner:LibraryIdentity,meaning:import('./teacher').LocalMeaning,content:LightweightInitialLearningMaterialization['content'],attemptId:string,grantId:string|null){
 const id=stableUuid(`sensa-learning-target:${owner.learnerId}:${meaning.senseVersionId}:${meaning.bindingVersionId}`);
 const existing=await tx.get<LocalLearningTarget>('learningTargets',id);if(existing)return existing;
 const now=new Date().toISOString();
 const snapshot=sensaLearningMaterializationSnapshotSchema.parse({contractVersion:sensaLearningConnectionContractVersion,learningMaterializationId:stableUuid(`sensa-personal-material:${attemptId}`),learnerUserId:owner.learnerId,learningTargetId:id,protocolPurpose:'initial_learning',provisioningPath:'on_demand',contentSchemaVersion:LIGHTWEIGHT_INITIAL_MATERIALIZATION_SCHEMA_VERSION,contentPayload:content,contentDigest:canonicalJsonDigest(content),validationStatus:'validated',validatorVersion:'sensa-web-content-v1',provenance:{meaningId:meaning.id,acceptanceId:meaning.acceptanceId,senseId:meaning.senseId,senseVersionId:meaning.senseVersionId,bindingId:meaning.bindingId,bindingVersionId:meaning.bindingVersionId,attemptId},personalAnchorUseGrantIds:grantId?[grantId]:[],createdAt:now});
 const target:LocalLearningTarget={id,retentionId:stableUuid(`sensa-retention:${id}`),packageKey:null,expression:meaning.proposal.expression.surface,meaning:meaning.proposal.semanticSpec.coreMeaningFocus,material:{snapshot,content},createdAt:now,startedAt:null,completedAt:null,memory:null,memoryRevision:0,relearnAt:null};
 validateLightweightInitialMaterialization(target.material);tx.put('learningTargets',id,target);return target;
}

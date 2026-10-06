import {z} from 'zod';
import {sensaFormalPinnedLanguageContextSchema,type SensaFormalPinnedLanguageContext} from '@sensa/contracts/sensa';
import type {LocalLearningRun} from '../../learning/runtime/localProtocol';
import {localRunSessionIntent} from '../../learning/runtime/localProtocol';
import {backupEqual} from './backupCodec';
import {readLibrary,type Operation,type LibraryTransaction} from './store';

const receiptSchema=z.object({
 format:z.literal('sensa-learning-run-receipt-v1'),id:z.string().uuid(),targetId:z.string().uuid(),revision:z.number().int().positive(),
 languageContext:sensaFormalPinnedLanguageContextSchema,purpose:z.enum(['initial_learning','retention_review','relearning']),
 startedAt:z.string().datetime({offset:true}),completedAt:z.string().datetime({offset:true}).nullable(),
}).strict();
export type LearningRunReceipt=z.infer<typeof receiptSchema>;

/** A newer Route revision may resume its pinned language direction, but an
 * implicit continuation must not transfer a Session to another direction. */
export const sameLearningSessionDirection=(pinned:SensaFormalPinnedLanguageContext,requested:SensaFormalPinnedLanguageContext)=>
 pinned.languageRouteId===requested.languageRouteId&&pinned.targetLanguageTag===requested.targetLanguageTag&&pinned.supportLanguageTag===requested.supportLanguageTag&&requested.languageRouteRevision>=pinned.languageRouteRevision;
export const lawfulLearningPredecessor=(previous:LocalLearningRun|undefined,context:SensaFormalPinnedLanguageContext,at:string,intent:string,childId:string)=>
 !!previous?.completedAt&&previous.id!==childId&&Date.parse(at)>=Date.parse(previous.completedAt)&&sameLearningSessionDirection(previous.languageContext,context)&&localRunSessionIntent(previous)===intent;
/** Explicit repair retry cannot be reinterpreted as another purpose. */
export function assertLearningContinuationPurpose(input:{requiredPurpose?:unknown;targetId?:string},previous?:LocalLearningRun,child?:LocalLearningRun):void{
 if(input.requiredPurpose!==undefined&&(input.requiredPurpose!=='relearning'||previous?.purpose!=='relearning'||previous.completionKind!=='wait_relearning'||previous.targetId!==input.targetId||previous.targetIds.length!==1||child&&(child.purpose!=='relearning'||child.targetId!==input.targetId)))throw new Error('localFlow.stepChanged');
}
export function verifyLearningSelectionWitness(run:LocalLearningRun,event:{at:string;sessionIntent?:string;requestedLanguageContext?:SensaFormalPinnedLanguageContext;continuedFromRunId?:string},previous?:LocalLearningRun):void{
 const requested=sensaFormalPinnedLanguageContextSchema.parse(event.requestedLanguageContext);
 if(Object.hasOwn(event,'continuedFromRunId'))z.string().uuid().parse(event.continuedFromRunId);
 if(!sameLearningSessionDirection(run.languageContext,requested)||!['mixed','review_only'].includes(event.sessionIntent??'')||event.continuedFromRunId!==undefined&&(previous?.id!==event.continuedFromRunId||!lawfulLearningPredecessor(previous,requested,event.at,event.sessionIntent!,run.id)))throw new Error('localFlow.progressReadFailed');
}

/** An operation result is not a second copy of its Run/material/history. */
export const learningRunReceipt=(run:LocalLearningRun):LearningRunReceipt=>({
 format:'sensa-learning-run-receipt-v1',id:run.id,targetId:run.targetId,revision:run.revision,languageContext:run.languageContext,
 purpose:run.purpose,startedAt:run.startedAt,completedAt:run.completedAt,
});

/** Verify immutable referenced facts, not current active focus. A later Run
 * revision may exist, but the receipt still reports its original revision. */
export function verifyLearningRunReceiptFacts(operation:Operation,raw:unknown,run:LocalLearningRun|undefined,event?:any,previous?:LocalLearningRun):LearningRunReceipt{
 const receipt=receiptSchema.parse(raw);
 if(!run||run.revision<receipt.revision||run.targetId!==receipt.targetId||run.purpose!==receipt.purpose||run.startedAt!==receipt.startedAt||!backupEqual(run.languageContext,receipt.languageContext)||receipt.completedAt!==null&&run.completedAt!==receipt.completedAt)throw new Error('localFlow.progressReadFailed');
 const input=operation.input as {runId?:string;targetId?:string;revision?:number;action?:unknown;at?:string;languageContext?:unknown;sessionIntent?:string;requiredPurpose?:unknown};
 if(operation.kind==='learning.act'){
  if(input.runId!==run.id||!Number.isSafeInteger(input.revision)||Number(input.revision)<1||receipt.revision!==Number(input.revision)+1||!event||event.runId!==run.id||event.detail.runRevision!==input.revision||event.at!==input.at||!backupEqual(event.detail.action,input.action)||receipt.completedAt!==(event.detail.nextPresentation===null?event.at:null))throw new Error('localFlow.progressReadFailed');
 }else{
  if(!['learning.start','learning.continue'].includes(operation.kind)||!input.targetId||!run.targetIds.includes(input.targetId))throw new Error('localFlow.progressReadFailed');
  const continuing=operation.kind==='learning.continue';
  if(continuing)assertLearningContinuationPurpose(input,previous,run);
  const requested=sensaFormalPinnedLanguageContextSchema.parse(input.languageContext);
  const intent=continuing&&previous?localRunSessionIntent(previous):input.sessionIntent??'mixed';
  if(!sameLearningSessionDirection(run.languageContext,requested)||continuing&&(previous?.id!==input.runId||!lawfulLearningPredecessor(previous,requested,input.at!,intent,run.id)))throw new Error('localFlow.progressReadFailed');
  if(run.startedByOperationId===operation.id){
   if(receipt.revision!==1||receipt.completedAt!==null||run.startedAt!==input.at||!(run.learningSessionId?sameLearningSessionDirection(run.languageContext,requested):backupEqual(run.languageContext,input.languageContext))||(run.sessionIntent??'mixed')!==intent||run.continuedFromRunId!==(continuing?input.runId:undefined))throw new Error('localFlow.progressReadFailed');
  }else{
   const selection=run.lifecycleEvents.find(event=>event.operationId===operation.id&&['resumed_after_planning_override','resumed_after_session_switch','resumed_after_session_end','session_intent_selected'].includes(event.kind));
   if(!selection||receipt.revision!==selection.runRevision+1||receipt.completedAt!==null||!('sessionIntent' in selection)||selection.sessionIntent!==intent||selection.at!==input.at||!backupEqual(selection.requestedLanguageContext,input.languageContext)||selection.continuedFromRunId!==(continuing?input.runId:undefined))throw new Error('localFlow.progressReadFailed');
  }
 }
 return receipt;
}
export async function assertLearningRunReceipt(tx:Pick<LibraryTransaction,'get'>,operation:Operation,raw:unknown):Promise<LearningRunReceipt>{
 const receipt=receiptSchema.parse(raw),run=await tx.get<LocalLearningRun>('learningRuns',receipt.id);
 return verifyLearningRunReceiptFacts(operation,receipt,run,operation.kind==='learning.act'?await tx.get('learningEvents',operation.id):undefined,operation.kind==='learning.continue'?await tx.get<LocalLearningRun>('learningRuns',(operation.input as {runId:string}).runId):undefined);
}
export const readVerifiedLearningRunReceipt=(operation:Operation,receipt:unknown)=>readLibrary(tx=>assertLearningRunReceipt(tx,operation,receipt));

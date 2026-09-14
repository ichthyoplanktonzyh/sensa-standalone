import {canonicalConsumerJson,localIntakeReceiptSchema,localIntakeRequestSchema,type LocalIntakeReceipt,type LocalIntakeRequest} from '@sensa/contracts/sensa';
import {command,readLibrary,type LibraryTransaction,type LibraryIdentity} from './store';
import type {LocalDraft} from './drafts';
import type {LocalMeaning,TeacherSession} from './teacher';
const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalConsumerJson(value)))),b=>b.toString(16).padStart(2,'0')).join('');
async function authorize(tx:LibraryTransaction,accountId:string,libraryId:string){
 const owner=await tx.get<{accountId?:string}>('meta','service-owner');
 if(owner?.accountId!==accountId||await tx.get('meta','signed-out'))throw new Error('account_mismatch');
 if((await tx.get<LibraryIdentity>('meta','identity'))?.id!==libraryId)throw new Error('library_mismatch');
}
/** All source, acceptance and local identities commit together; no learning enrollment. */
export async function commitWebIntake(tx:LibraryTransaction,accountId:string,request:LocalIntakeRequest,requestDigest:string,identityDigest:string|null):Promise<LocalIntakeReceipt>{
 await authorize(tx,accountId,request.libraryId);
 if(request.resolution?.kind==='local_binding')throw new Error('unsupported_resolution');
 const now=new Date().toISOString(),draftId=request.operationId;
 if(await tx.get('drafts',draftId))throw new Error('operation_conflict');
 const draft:LocalDraft={id:draftId,revision:1,text:request.snapshot.sentence,startingPoint:'from_expression',createdAt:request.snapshot.source.capturedAt,updatedAt:now,intake:request};
 tx.put('drafts',draft.id,draft);
 const proposal=request.resolution?.proposal??null;
 if(proposal){
  const accepted=!!request.acceptance;
  const session:TeacherSession={id:crypto.randomUUID(),draftId,draftRevision:1,revision:1,languageContext:request.languageContext,input:draft.text,sourceExpression:proposal.expression.surface,messages:[],status:accepted?'accepted':'proposal',question:null,candidate:proposal,requests:0,toolCount:0,seenCalls:[],lease:null,provenance:[],meaningId:null};
  if(accepted){
   let identity=await tx.get<Pick<LocalMeaning,'senseId'|'senseVersionId'|'bindingId'|'bindingVersionId'>>('identities',identityDigest!);
   if(!identity){identity={senseId:crypto.randomUUID(),senseVersionId:crypto.randomUUID(),bindingId:crypto.randomUUID(),bindingVersionId:crypto.randomUUID()};tx.put('identities',identityDigest!,identity);}
   const meaning:LocalMeaning={id:crypto.randomUUID(),draftId,draftRevision:1,context:draft.text,proposal,supportLanguageTag:request.languageContext.supportLanguageTag,targetLanguageTag:request.languageContext.targetLanguageTag,...identity,contextAnchorId:crypto.randomUUID(),expressionAnchorId:crypto.randomUUID(),alignmentId:crypto.randomUUID(),acceptanceId:crypto.randomUUID(),acceptedAt:now,sessionId:session.id};
   session.meaningId=meaning.id;tx.put('meanings',meaning.id,meaning);
  }
  tx.put('sessions',session.id,session);
 }
 return {version:'sensa-intake-v1',libraryId:request.libraryId,clientId:request.clientId,operationId:request.operationId,requestDigest,status:proposal&&request.acceptance?'confirmed':'pending',entityId:draftId,committedAt:now};
}
export async function receiveWebIntake(accountId:string,raw:unknown){
 const request=localIntakeRequestSchema.parse(raw);
 if(request.resolution?.kind==='local_binding')throw new Error('unsupported_resolution');
 const requestDigest=await hash(request),identityDigest=request.resolution?.kind==='proposal'?await hash({semanticSpec:request.resolution.proposal.semanticSpec,expression:request.resolution.proposal.expression}):null;
 const existing=await readLibrary(async tx=>{await authorize(tx,accountId,request.libraryId);return {draft:await tx.get<LocalDraft>('drafts',request.operationId),operation:await tx.get('operations',request.operationId)};});
 // A Cloud Checkpoint restores the canonical Intake draft, not the source device's
 // command ledger. Derive the acknowledgement from that domain fact when a remote
 // delivery is retried after restore; a changed payload remains a hard conflict.
 if(existing.draft&&!existing.operation){
  if(!existing.draft.intake||canonicalConsumerJson(existing.draft.intake)!==canonicalConsumerJson(request))throw new Error('operation_conflict');
  return localIntakeReceiptSchema.parse({version:'sensa-intake-v1',libraryId:request.libraryId,clientId:request.clientId,operationId:request.operationId,requestDigest,status:request.resolution?.kind==='proposal'&&request.acceptance?'confirmed':'pending',entityId:request.operationId,committedAt:existing.draft.updatedAt});
 }
 return command({id:request.operationId,kind:'intake.receive',input:{accountId,request}},tx=>commitWebIntake(tx,accountId,request,requestDigest,identityDigest));
}

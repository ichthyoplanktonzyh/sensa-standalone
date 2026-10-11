/** Independent learner Context commands reuse the existing Anchor facts. */
import type {JourneyState} from './store';
import type {JourneyFactPorts} from './ports';
import type {SaveContextInput,SaveContextResult,ContextReference,MaterialBlockInput,ReviseSavedContextInput,ChangeContextLifecycleInput} from './types';
import {contextMaterialBlocks} from './contextRead';
import {backupEqual} from '../../data/library/backupCodec';
import type {ContextHead} from './contextRecords';
import {isUuid} from './ids';

export function contextBlocks(raw:readonly MaterialBlockInput[]):MaterialBlockInput[]{
 if(!raw.length||raw.filter(row=>row.kind==='image').length>3)throw Error('localFlow.sceneImageRequirements');
 return raw.map(row=>{if(row.kind==='text'){const bodyText=row.bodyText?.trim();if(!bodyText)throw Error('localFlow.messageRequired');return {kind:'text',bodyText};}if(row.kind!=='image'||!row.personalMediaObjectId||!isUuid(row.personalMediaObjectId))throw Error('localFlow.sceneImageRequirements');return {kind:'image',personalMediaObjectId:row.personalMediaObjectId};});
}
export function saveContextFacts(state:JourneyState,ports:JourneyFactPorts,input:SaveContextInput):Omit<SaveContextResult,'replayed'>{
 const blocks=contextBlocks(input.blocks),contextId=ports.newId(),revisionId=ports.newId(),now=ports.nowIso();
 const head:ContextHead={contractVersion:'sensa-personal-semantic-world-v3',personalSemanticAnchorId:contextId,learnerUserId:'sensa-local-learner',currentRevision:1,currentRevisionId:revisionId,lifecycleRevision:1,status:'active',createdAt:now,updatedAt:now,deletedAt:null,deletedByOperationId:null};
 state.contexts.anchors.push(head);
 state.contexts.anchorRevisions.push({contractVersion:'sensa-personal-semantic-world-v3',personalSemanticAnchorId:contextId,personalSemanticAnchorRevisionId:revisionId,revision:1,anchorKind:'scene',languageTag:input.languageTag??null,bodyText:blocks.flatMap(row=>row.bodyText?[row.bodyText]:[]).join('\n\n')||null,personalMediaObjectId:null,structuredPayload:{blocks,mediaReferenceIds:blocks.flatMap(row=>row.personalMediaObjectId?[row.personalMediaObjectId]:[])},provenance:{kind:'learner_authored',sourceReferenceIds:[contextId],createdByOperationId:input.operationId},createdAt:now});
 state.contexts.anchorRevisionParents[revisionId]=null;return {contextId,revisionId};
}
export function referencedContextFacts(state:JourneyState,ref:ContextReference){
 if(!isUuid(ref.contextId)||!isUuid(ref.revisionId))throw Error('localFlow.meaningChanged');
 const head=state.contexts.anchors.find(row=>row.personalSemanticAnchorId===ref.contextId);
 if(!head||head.status!=='active'||head.learnerUserId!=='sensa-local-learner')throw Error('localFlow.meaningChanged');
 const revisions=new Map(state.contexts.anchorRevisions.map(row=>[row.personalSemanticAnchorRevisionId,row])),chain:JourneyState['contexts']['anchorRevisions']=[];
 const seen=new Set<string>();let next:string|null=ref.revisionId;
 while(next){if(seen.has(next))throw Error('semantic_context_invalid');seen.add(next);const row=revisions.get(next);if(!row||row.personalSemanticAnchorId!==ref.contextId)throw Error('localFlow.meaningChanged');chain.unshift(row);next=state.contexts.anchorRevisionParents[next]??null;}
 if(!chain.length||chain[0]!.revision!==1)throw Error('semantic_context_invalid');
 return {head,revisions:chain,selected:chain.at(-1)!};
}

export function reviseSavedContextFacts(state:JourneyState,ports:JourneyFactPorts,input:ReviseSavedContextInput|ChangeContextLifecycleInput):Omit<SaveContextResult,'replayed'>&{changed:boolean}{
 const existing=state.contexts.anchors.find(row=>row.personalSemanticAnchorId===input.contextId),prior=state.contexts.anchorRevisions.find(row=>row.personalSemanticAnchorRevisionId===input.expectedRevisionId);
 if(!existing||existing.learnerUserId!=='sensa-local-learner'||!prior||existing.currentRevisionId!==input.expectedRevisionId||prior.personalSemanticAnchorId!==input.contextId)throw Error('localFlow.meaningChanged');
 const head={...existing};
 const lifecycle='action'in input;
 if(lifecycle){if((input.action==='delete')!==(head.status==='active'))throw Error('localFlow.meaningChanged');}
 else if(head.status!=='active')throw Error('localFlow.meaningChanged');
 if(!lifecycle&&state.contexts.anchorRevisions.some(row=>row.personalSemanticAnchorId===input.contextId&&row.structuredPayload.learningScene))throw Error('localFlow.meaningChanged');
 const blocks=lifecycle?contextMaterialBlocks(prior):contextBlocks(input.blocks);
 if(!lifecycle&&backupEqual(blocks,contextMaterialBlocks(prior)))return {contextId:input.contextId,revisionId:prior.personalSemanticAnchorRevisionId,changed:false};
 const revisionId=ports.newId(),now=ports.nowIso(),{lifecycle:_,...facts}=prior;
 const {learningScene:__,publishedSource:___,...lifecyclePayload}=prior.structuredPayload;
 const images=blocks.flatMap(row=>row.personalMediaObjectId?[row.personalMediaObjectId]:[]),inline=Array.isArray(prior.structuredPayload.media)?prior.structuredPayload.media.filter(row=>row&&typeof row==='object'&&'mediaId'in row&&images.includes(row.mediaId as string)):[];
 state.contexts.anchorRevisions.push(lifecycle?{...facts,personalSemanticAnchorRevisionId:revisionId,revision:prior.revision+1,structuredPayload:lifecyclePayload,lifecycle:{kind:input.action,revision:head.lifecycleRevision+1},provenance:{kind:'learner_authored',sourceReferenceIds:[prior.personalSemanticAnchorRevisionId],createdByOperationId:input.operationId},createdAt:now}:{...facts,personalSemanticAnchorRevisionId:revisionId,revision:prior.revision+1,anchorKind:'scene',bodyText:blocks.flatMap(row=>row.bodyText?[row.bodyText]:[]).join('\n\n')||null,personalMediaObjectId:null,structuredPayload:{blocks,...(prior.structuredPayload.intake?{intake:prior.structuredPayload.intake}:{}),...(inline.length?{media:inline}:{}),mediaReferenceIds:images.filter(id=>!inline.some(row=>row&&typeof row==='object'&&'mediaId'in row&&row.mediaId===id))},provenance:{kind:'learner_authored',sourceReferenceIds:[prior.personalSemanticAnchorRevisionId],createdByOperationId:input.operationId},createdAt:now});
 state.contexts.anchorRevisionParents[revisionId]=prior.personalSemanticAnchorRevisionId;
 state.contexts.anchors=state.contexts.anchors.map(row=>row===existing?head:row);
 head.currentRevision++;head.currentRevisionId=revisionId;head.updatedAt=now;
 if(lifecycle){head.lifecycleRevision++;head.status=input.action==='delete'?'deleted':'active';head.deletedAt=input.action==='delete'?now:null;head.deletedByOperationId=input.action==='delete'?input.operationId:null;}
 return {contextId:input.contextId,revisionId,changed:true};
}

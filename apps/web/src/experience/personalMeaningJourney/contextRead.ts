/** Private, bounded Context views; no semantic or learning outcomes. */
import {normalizeMeaningQuery} from './meaningLookupFacts';
import type {ContextHead,ContextRecord} from './contextRecords';
import {contextHeadSchema} from './contextRecords';
import {sensaPersonalSemanticAnchorRevisionSnapshotSchema,sensaContextMaterialBlockSchema} from '@sensa/contracts/sensa';
import {z} from 'zod';
import {isUuid} from './ids';
import type {MaterialBlockInput} from './types';
export interface ContextBrowseQuery {query:string;offset:number;limit:number;status?:'active'|'deleted'|'all';contextId?:string}
export interface ContextBrowseItem {contextId:string;revisionId:string;label:string;updatedAt:string;imageCount:number;meaningCount:number;status:'active'|'deleted'}
export interface ContextBrowsePage {items:ContextBrowseItem[];total:number}
export interface ContextDetail {head:ContextHead;revision:Extract<ContextRecord,{kind:'anchorRevisions'}>['value'];blocks:MaterialBlockInput[];meaningCount:number;sceneManaged:boolean}
export function validateContextQuery(query:ContextBrowseQuery):ContextBrowseQuery{
 if(typeof query.query!=='string'||query.query.length>200||!Number.isSafeInteger(query.offset)||query.offset<0||!Number.isSafeInteger(query.limit)||query.limit<1||query.limit>256||query.status!==undefined&&!['active','deleted','all'].includes(query.status)||query.contextId!==undefined&&!isUuid(query.contextId))throw Error('context_query_invalid');return {...query,query:normalizeMeaningQuery(query.query)};
}
export function contextMaterialBlocks(revision:ContextDetail['revision']):MaterialBlockInput[]{
 sensaPersonalSemanticAnchorRevisionSnapshotSchema.parse(revision);
 if(revision.structuredPayload.blocks!==undefined)return z.array(sensaContextMaterialBlockSchema).min(1).parse(revision.structuredPayload.blocks);
 return [...(revision.bodyText?[{kind:'text' as const,bodyText:revision.bodyText}]:[]),...(revision.personalMediaObjectId?[{kind:'image' as const,personalMediaObjectId:revision.personalMediaObjectId}]:[]),...(Array.isArray(revision.structuredPayload.media)?revision.structuredPayload.media.map((row:any)=>({kind:'image' as const,personalMediaObjectId:row.mediaId})):[])];
}
export function contextBrowseFacts(head:ContextHead,revision:ContextDetail['revision'],meaningCount=0){
 contextHeadSchema.parse(head);sensaPersonalSemanticAnchorRevisionSnapshotSchema.parse(revision);
 if(revision.personalSemanticAnchorRevisionId!==head.currentRevisionId||revision.personalSemanticAnchorId!==head.personalSemanticAnchorId||revision.revision!==head.currentRevision)throw Error('semantic_context_invalid');
 const blocks=contextMaterialBlocks(revision),text=blocks.flatMap(row=>row.bodyText?[row.bodyText]:[]).join('\n\n'),imageCount=blocks.filter(row=>row.kind==='image').length;
 return {item:{contextId:head.personalSemanticAnchorId,revisionId:head.currentRevisionId,label:text.slice(0,200),updatedAt:head.updatedAt,imageCount,meaningCount,status:head.status},text:normalizeMeaningQuery(text)};
}

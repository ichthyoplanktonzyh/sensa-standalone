/** Expression-first Practice material selection. No formal learning identity or outcome. */
import {assertCurrentLibrary,observeLibrary,readLibrary} from '../data/library/store';
import type {PracticeExpressionQuery,PracticeExpressionPage,PracticeExpression,PracticeMaterialSource} from '../data/library/practiceExpressionProjection';
export type {PracticeExpression,PracticeMaterialSource};
export interface PracticeMaterialSelection {source:PracticeMaterialSource;expressionIds:readonly string[]|null}
export type PracticeMaterialPage=PracticeExpressionPage&{incarnation:string};
export const practiceMaterialsRepository={
 subscribe(listener:()=>void){return observeLibrary(listener,['semanticMeanings','semanticRegistry','packageCache','meta'],{meta:['identity','local-incarnation']});},
 page(query:PracticeExpressionQuery):Promise<PracticeMaterialPage>{return readLibrary(async tx=>({incarnation:await assertCurrentLibrary(tx),...await tx.practiceExpressions(query)}));},
};
/** Explicit select-all collects only identities; changed sources reject the whole result. */
export async function collectPracticeExpressionIds(query:Pick<PracticeExpressionQuery,'source'|'languageTag'|'query'|'excludedIds'>,signal:AbortSignal):Promise<string[]>{
 const ids=new Set<string>();let frame:PracticeMaterialPage|null=null;
 for(let offset=0;;offset+=256){
  signal.throwIfAborted();const page=await practiceMaterialsRepository.page({...query,offset,limit:256,idsOnly:true});signal.throwIfAborted();
  if(frame&&(frame.incarnation!==page.incarnation||frame.revision!==page.revision||frame.total!==page.total))throw new Error('localFlow.meaningChanged');
  frame=page;for(const id of page.ids){if(ids.has(id))throw new Error('localFlow.meaningChanged');ids.add(id);}
  if(ids.size===page.total)return [...ids];if(!page.ids.length||ids.size>page.total)throw new Error('localFlow.meaningChanged');
 }
}
export async function resolvePracticeExpression(selection:PracticeMaterialSelection,languageTag:string,id?:string):Promise<PracticeExpression|null>{
 const ids=id?[id]:selection.expressionIds??undefined;
 if(id&&selection.expressionIds&&!selection.expressionIds.includes(id))throw new Error('practice_expression_not_selected');
 const page=await practiceMaterialsRepository.page({source:selection.source,languageTag,query:'',offset:0,limit:1,selectedIds:ids});
 return page.items[0]??null;
}

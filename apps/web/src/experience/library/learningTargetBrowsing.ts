import type {LearningTargetProjection} from '../../learning/system';

export type LearningLibraryFilter='all'|'new'|'due'|'paused'|'active'|'complete';
export type LearningLibrarySort='due'|'expression';
export interface LearningLibraryItem{
 readonly id:string;readonly targetId:string|null;readonly enrollmentId:string|null;
 readonly expression:string;readonly meaning:string;readonly sourceLabel:string;
 readonly targetLanguageTag?:string;readonly supportLanguageTag?:string;
 readonly state:string;readonly group:Exclude<LearningLibraryFilter,'all'>|'other';readonly nextReviewAt:string|null;
}
export function learningLibraryTarget(target:LearningTargetProjection,initialIds:ReadonlySet<string>,dueIds:ReadonlySet<string>):LearningLibraryItem{
 const paused=target.planningPaused===true;
 const state=paused?'paused':target.declaredMastery?'declared':target.planningActive===false?'not_planned':target.state.replaceAll('_','-');
 const group=paused?'paused':dueIds.has(target.targetId)?'due':initialIds.has(target.targetId)?'new':target.completed||target.declaredMastery?'complete':target.started?'active':'other';
 return {id:target.targetId,targetId:target.targetId,enrollmentId:null,expression:target.presentation.expression,meaning:target.presentation.meaning,targetLanguageTag:target.presentation.targetLanguageTag,supportLanguageTag:target.presentation.supportLanguageTag,sourceLabel:target.presentation.sourceLabel,state,group,nextReviewAt:target.nextReviewAt};
}
export function learningLibrarySelection(items:readonly LearningLibraryItem[],query:string,filter:LearningLibraryFilter,sort:LearningLibrarySort,locale:string){
 const needle=query.trim().toLocaleLowerCase(locale),collator=new Intl.Collator(locale,{numeric:true,sensitivity:'base'});
 return items.filter(item=>(filter==='all'||item.group===filter)&&`${item.expression} ${item.meaning} ${item.sourceLabel}`.toLocaleLowerCase(locale).includes(needle)).sort((a,b)=>{
  const due=sort==='due'?(a.nextReviewAt?Date.parse(a.nextReviewAt):Infinity)-(b.nextReviewAt?Date.parse(b.nextReviewAt):Infinity):0;
  return (Number.isNaN(due)?0:due)||collator.compare(a.expression,b.expression)||(a.id<b.id?-1:a.id>b.id?1:0);
 });
}

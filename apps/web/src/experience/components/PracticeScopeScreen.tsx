import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CURRENT_STUDY_SCOPE_ID, PERSONAL_SEMANTIC_WORLD_SCOPE_ID, type PracticeScopeCatalog, type PracticeScopeSelection, type PracticeScopeTarget } from '../practiceScope';
import { practiceBody, practiceButton, practiceSurface } from './SensaFreePracticeScreen';
export interface PracticeScopeScreenProps {
 active:boolean; catalog:PracticeScopeCatalog; onBack:()=>void; onSelectScope:(selection:PracticeScopeSelection)=>void;
}
function TargetCopy({target}:{target:PracticeScopeTarget}) {
 return <span className="min-w-0 flex-1"><strong className="text-lg font-medium">{target.expression.surfaceForm}</strong><span className="mt-2 block text-sm text-[#68748d]">{target.sense.label}</span>{target.context?.preview&&<span className="mt-2 block text-xs leading-6 text-[#788398]">{target.context.preview}</span>}</span>;
}
export const PracticeScopeScreen=({active,catalog,onBack,onSelectScope}:PracticeScopeScreenProps)=>{
 const {t}=useTranslation();
 const [view,setView]=useState<'targets'|'sources'|'personal'>('targets');
 const [draft,setDraft]=useState<readonly string[]>([]);
 const personal=catalog.sources.find(source=>source.sourceId===PERSONAL_SEMANTIC_WORLD_SCOPE_ID);
 useEffect(()=>{if(active){setView('targets');setDraft(catalog.selection.sourceId===PERSONAL_SEMANTIC_WORLD_SCOPE_ID?catalog.selection.targetIds:[]);}},[active,catalog.selection]);
 const validDraft=draft.filter(id=>personal?.targets.some(target=>target.targetId===id));
 const back=()=>view==='personal'?setView('sources'):view==='sources'?setView('targets'):onBack();
 return <section id="s-practice-scope" className={practiceSurface(active)}><main className={practiceBody}>
  <button onClick={back} className={`${practiceButton} -ml-4 text-[#68748d]`}><ArrowLeft size={18}/>{t('practice.back')}</button>
  <header className="my-7 flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-medium">{t(view==='targets'?'practice.scope':view==='sources'?'practice.change':'practice.choose')}</h1>{view==='targets'&&<button onClick={()=>setView('sources')} className={`${practiceButton} border border-[#e3e5ea] bg-white`}>{t('practice.change')}</button>}</header>
  {view==='sources'?<div className="grid gap-4 md:grid-cols-2">{catalog.sources.map(source=><button key={source.sourceId} disabled={!source.targets.length} onClick={()=>{
   if(source.sourceId===PERSONAL_SEMANTIC_WORLD_SCOPE_ID){setDraft(catalog.selection.sourceId===PERSONAL_SEMANTIC_WORLD_SCOPE_ID?catalog.selection.targetIds:[]);setView('personal');}
   else {onSelectScope({sourceId:CURRENT_STUDY_SCOPE_ID});setView('targets');}
  }} className="flex items-center gap-4 rounded-2xl border border-[#dce3ef] bg-white p-6 text-left disabled:opacity-40"><span className="flex-1"><strong className="font-medium">{t('practice.sources.'+source.sourceId)}</strong><span className="mt-3 block text-sm text-[#788398]">{t('practice.count',{count:source.targets.length})}</span></span>{source.selected?<Check size={18}/>:<ArrowRight size={18}/>}</button>)}</div>:<>
   <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm text-[#788398]"><span>{t('practice.sources.'+(view==='personal'?PERSONAL_SEMANTIC_WORLD_SCOPE_ID:catalog.currentScope.sourceId))}</span>{view==='personal'&&<button className={practiceButton} onClick={()=>setDraft(validDraft.length===personal?.targets.length?[]:personal?.targets.map(target=>target.targetId)??[])}>{t(validDraft.length===personal?.targets.length?'practice.clear':'practice.all')}</button>}</div>
   <ul className="divide-y divide-[#e3e5ea]">{(view==='personal'?personal?.targets??[]:catalog.currentScope.targets).map(target=><li key={target.targetId}>
    {view==='personal'?<button aria-pressed={validDraft.includes(target.targetId)} onClick={()=>setDraft(ids=>ids.includes(target.targetId)?ids.filter(id=>id!==target.targetId):[...ids,target.targetId])} className="flex w-full items-center gap-5 py-6 text-left"><TargetCopy target={target}/><span className={`grid size-6 shrink-0 place-items-center rounded-md border ${validDraft.includes(target.targetId)?'border-[#5268a9] bg-[#5268a9] text-white':'border-[#ccd4e1]'}`}>{validDraft.includes(target.targetId)&&<Check size={16}/>}</span></button>:<div className="py-6"><TargetCopy target={target}/></div>}
   </li>)}</ul>
   {!(view==='personal'?personal?.targets.length:catalog.currentScope.targets.length)&&<p className="py-16 text-center text-sm text-[#788398]">{t('practice.empty')}</p>}
   {view==='personal'&&<footer className="sticky bottom-0 mt-6 border-t border-[#e3e5ea] bg-[#fbfbfa] py-5"><button disabled={!validDraft.length} onClick={()=>{onSelectScope({sourceId:PERSONAL_SEMANTIC_WORLD_SCOPE_ID,targetIds:validDraft});setView('targets');}} className={`${practiceButton} w-full bg-[#2f3b70] text-white sm:w-auto`}>{t('practice.use',{count:validDraft.length})}</button></footer>}
  </>}
 </main></section>;
};

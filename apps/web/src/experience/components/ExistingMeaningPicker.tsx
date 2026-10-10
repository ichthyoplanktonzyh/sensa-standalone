import {useRef,useState,useEffect} from 'react';
import {useTranslation} from 'react-i18next';
import {createJourneyGateway} from '../personalMeaningJourney';
import type {MeaningLookupMatch,MeaningLookupResult} from '../personalMeaningJourney/meaningLookup';
import {SenseSpec} from './SenseSpec';

/** Local bounded lookup; choosing a result edits the draft, never accepts it. */
export function ExistingMeaningPicker({onPick}:{onPick:(match:MeaningLookupMatch)=>void}){
 const {t}=useTranslation();
 const [query,setQuery]=useState(''),[result,setResult]=useState<MeaningLookupResult|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
 const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 const search=async()=>{
  if(!query.trim())return;
  const current=++generation.current;setBusy(true);setFailed(false);setResult(null);
  try{const result=await createJourneyGateway().lookupMeanings(query);if(generation.current===current)setResult(result);}
  catch{if(generation.current===current)setFailed(true);}
  finally{if(generation.current===current)setBusy(false);}
 };
 return <details className="rounded-control border border-border-subtle p-3 text-sm"><summary className="cursor-pointer py-1">{t('manualMeaning.existing')}</summary>
  <div className="mt-3 flex gap-2"><input aria-label={t('manualMeaning.find')} value={query} maxLength={200} onChange={event=>{generation.current++;setQuery(event.target.value);setResult(null);setFailed(false);setBusy(false);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void search();}}} className="min-w-0 flex-1 rounded-control border border-border-subtle bg-surface-panel px-3"/><button type="button" disabled={busy||!query.trim()} className="min-h-11 rounded-control border border-border-strong px-4 disabled:opacity-50" onClick={()=>void search()}>{t('manualMeaning.search')}</button></div>
  {busy&&<p role="status" className="mt-3">{t('localFlow.loadingSensa')}</p>}
  {failed&&<p role="alert" className="mt-3">{t('content.loadError')}</p>}
  {result?.truncated&&<p role="status" className="mt-3">{t('manualMeaning.refine')}</p>}
  {result&&!result.meanings.length&&!result.truncated&&<p role="status" className="mt-3">{t('content.noResults')}</p>}
  {result?.meanings.map(match=><article className="mt-3 space-y-3 border-t border-border-subtle pt-3" key={match.senseVersionId}>
   <p className="font-medium">{match.semanticSpec.coreMeaningFocus}</p><p className="text-fg-secondary">{match.expressions.map(value=>value.expression).join(' · ')}</p>
   <SenseSpec spec={match.semanticSpec}/>
   <button type="button" className="min-h-11 rounded-control border border-border-strong px-4" onClick={()=>onPick(match)}>{t('manualMeaning.useExisting')}</button>
  </article>)}
 </details>;
}

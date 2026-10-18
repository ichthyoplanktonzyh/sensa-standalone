import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {sensaExpressionTypeSchema,sensaLanguages,sensaIntakePayloadSchema} from '@sensa/contracts/sensa';
import {worldReadRepository,type PersonalMeaningCorrectionSeed} from '../personalMeaningJourney/worldRepository';
import {useJourneyGateway} from '../personalMeaningJourney';
import type {CorrectPersonalMeaningInput} from '../personalMeaningJourney/types';
import {openLibrary} from '../../data/library/store';
import {manualMeaningDraftSchema,newManualMeaningDraft,manualMeaningSense,type ManualMeaningDraft} from '../intake/manualMeaning';
import {previewStorage} from '../services/previewStorage';
import {assertClarificationSource} from '../personalMeaningJourney/clarificationSource';
import {isUuid} from '../personalMeaningJourney/ids';
import {localFlowText} from '../../i18n/localFlowText';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {contentButton} from './ContentWorkspace';
import {ExistingMeaningPicker} from './ExistingMeaningPicker';
import {SenseSpec} from './SenseSpec';

const control='mt-2 block min-w-0 w-full rounded-control border border-border-subtle bg-surface-panel p-3 text-sm focus-visible:outline-2 focus-visible:outline-focus';
export function PersonalMeaningCorrectionEditor({meaningId,alignmentId,onClose,onSaved,readCurrent}:{meaningId:string;alignmentId:string;onClose:()=>void;onSaved:()=>void;readCurrent:()=>Promise<unknown>}){
 const {t}=useTranslation(),gateway=useJourneyGateway();
 const [seed,setSeed]=useState<PersonalMeaningCorrectionSeed|null>(null),[draft,setDraft]=useState<ManualMeaningDraft>(()=>newManualMeaningDraft()),[key,setKey]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[stale,setStale]=useState(false),[attempt,setAttempt]=useState(0),[confirmed,setConfirmed]=useState(false);
 const pending=useRef<CorrectPersonalMeaningInput|null>(null),saving=useRef(false),mounted=useRef(false);
 const [senseEdit,setSenseEdit]=useState<'wording'|'different_meaning'>('wording');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const fresh=(source:PersonalMeaningCorrectionSeed):ManualMeaningDraft=>({...newManualMeaningDraft(),context:source.payload.context?.textSegment??'',occurrence:source.payload.expression!.surfaceForm,canonicalForm:source.payload.expression!.surfaceForm,languageTag:source.payload.expression!.languageTag!,expressionType:source.payload.expression!.expressionTypeHint??'word',meaning:source.personalSenseWording??source.payload.sense!.semanticSpec.coreMeaningFocus,usage:source.payload.sense!.semanticSpec.prototypeScenes[0]?.summary??''});
 const persist=(value:ManualMeaningDraft,request:CorrectPersonalMeaningInput|null=pending.current,mode=senseEdit)=>{if(key)previewStorage.setItem(key,JSON.stringify({sourceDigest:seed?.source.digest??request?.source.digest,draft:value,senseEdit:mode,pending:request}));};
 useEffect(()=>{
  let cancelled=false;setError('');setSeed(null);setStale(false);setConfirmed(false);
  void (async()=>{
   const identity=await openLibrary(),storageKey=`meaning-correction:${identity.id}:${meaningId}:${alignmentId}`;
   if(cancelled)return;setKey(storageKey);
   const raw=previewStorage.getItem(storageKey);let stored:any=null,unreadable=false,loadedDraft=false;pending.current=null;
   try{
    stored=raw?JSON.parse(raw):null;
    if(stored){const restored=manualMeaningDraftSchema.parse(stored.draft);if(stored.senseEdit!==undefined&&!['wording','different_meaning'].includes(stored.senseEdit))throw Error('Invalid correction intent');setSenseEdit(stored.senseEdit??'wording');setDraft(restored);loadedDraft=true;
     if(stored.pending){
      const request={...stored.pending,payload:sensaIntakePayloadSchema.parse(stored.pending.payload)} as CorrectPersonalMeaningInput;
      assertClarificationSource(request.source,'personal_meaning',meaningId);
      if(request.operationId!==restored.operationId||request.payload.operationId!==request.operationId||request.personalMeaningId!==meaningId||request.personalMeaningAlignmentId!==alignmentId||request.payload.acceptance?.mode!=='learner_direct'||request.reuseSense&&(!isUuid(request.reuseSense.senseId)||!isUuid(request.reuseSense.senseVersionId)))throw Error('Invalid correction draft');
      pending.current=request;
     }
    }
   }catch{unreadable=true;pending.current=null;}
   const next=await worldReadRepository.correction(meaningId,alignmentId);if(cancelled)return;
   setSeed(next);if(!loadedDraft)setDraft(fresh(next));
   if(unreadable){setStale(true);setError('localFlow.localStatusFailed');}
   else if(stored?.sourceDigest!==undefined&&stored.sourceDigest!==next.source.digest){setStale(true);setError('meaningGovernance.changed');}
  })().catch(()=>{if(!cancelled)setError(pending.current?'manualMeaning.saveError':'localFlow.localStatusFailed');});
  return()=>{cancelled=true;};
 },[meaningId,alignmentId,attempt]);
 const close=()=>{if(!saving.current)onClose();};
 useEffect(()=>{const listener=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close();}};document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener);});
 const change=(patch:Partial<ManualMeaningDraft>,mode=senseEdit)=>{
  if(!seed||!key||busy||pending.current||stale)return;
  if(mode==='wording'&&draft.existingSense&&draft.existingSense.senseId!==seed.reuseSense.senseId)patch={...patch,existingSense:null,meaning:seed.personalSenseWording??seed.payload.sense!.semanticSpec.coreMeaningFocus,usage:seed.payload.sense!.semanticSpec.prototypeScenes[0]?.summary??''};
  if(mode==='different_meaning'&&draft.existingSense?.senseId===seed.reuseSense.senseId)patch={...patch,existingSense:null};
  if(mode==='wording'&&seed.published)patch={...patch,usage:seed.payload.sense!.semanticSpec.prototypeScenes[0]?.summary??''};
  const next={...draft,...patch,operationId:crypto.randomUUID(),capturedAt:new Date().toISOString()};setSenseEdit(mode);setDraft(next);setError('');try{persist(next,null,mode);}catch{setError('manualMeaning.draftError');}
 };
 const save=async()=>{
  if(saving.current||!key||(!pending.current&&(!seed||stale)))return;
  saving.current=true;setBusy(true);setError('');
  try{
   if(!confirmed){
    let request=pending.current;
    if(!request){
     const source=seed!,form=draft.canonicalForm.trim();if(!form||!draft.languageTag)throw Error('manualMeaning.occurrenceRequired');
     const writtenSense=manualMeaningSense(draft,source.payload,{preserveDefinition:senseEdit==='wording'}),reuseSense=draft.existingSense?{senseId:draft.existingSense.senseId,senseVersionId:draft.existingSense.senseVersionId}:senseEdit==='wording'?source.reuseSense:undefined;
     const sense={...writtenSense,resolutionProvenance:{resolverKind:'learner' as const,provider:'sensa-web-correction',model:null,policyVersion:null,sourceReferenceIds:reuseSense?[reuseSense.senseVersionId]:[]}};
     const payload=sensaIntakePayloadSchema.parse({...source.payload,operationId:draft.operationId,capturedAt:draft.capturedAt,acceptance:{mode:'learner_direct'},sense,expression:{surfaceForm:form,languageTag:draft.languageTag,expressionTypeHint:draft.expressionType,occurrence:{surfaceForm:form,locator:source.payload.expression!.occurrence!.locator}}});
     request={operationId:draft.operationId,personalMeaningId:meaningId,personalMeaningAlignmentId:alignmentId,source:source.source,senseEdit,payload,...(reuseSense?{reuseSense}:{})};pending.current=request;persist(draft,request);
    }
    await gateway.correctPersonalMeaning(request);if(!mounted.current)return;setConfirmed(true);
   }
   try{await readCurrent();}catch{if(mounted.current)setError('meaningGovernance.savedReadFailed');return;}
   try{previewStorage.removeItem(key);}catch{/* Receipt replay remains safe. */}
   if(mounted.current)onSaved();
  }catch(cause){
   if(!mounted.current)return;
   const message=cause instanceof Error?cause.message:'';
   if(['localFlow.meaningChanged','localFlow.clarificationSourceChanged'].includes(message)){setStale(true);setError('meaningGovernance.changed');}
   else setError(message.startsWith('manualMeaning.')?message:'manualMeaning.saveError');
  }finally{saving.current=false;if(mounted.current)setBusy(false);}
 };
 const restart=async()=>{
  if(saving.current||!key)return;saving.current=true;setBusy(true);
  try{
   const latest=await worldReadRepository.correction(meaningId,alignmentId);if(!mounted.current)return;
   // Explicitly re-review the new Context without discarding the user's work.
   // This is a new acceptance intent, never a mutated retry of the old request.
   const next={...draft,context:latest.payload.context?.textSegment??'',operationId:crypto.randomUUID(),capturedAt:new Date().toISOString()};previewStorage.setItem(key,JSON.stringify({sourceDigest:latest.source.digest,draft:next,senseEdit,pending:null}));
   pending.current=null;setSeed(latest);setDraft(next);setStale(false);setConfirmed(false);setError('');
  }catch{if(mounted.current)setError('meaningGovernance.changed');}
  finally{saving.current=false;if(mounted.current)setBusy(false);}
 };
 return <SensaOverlayLayout variant="sheet" measure="standard" className="sensa-meaning-correction z-[115]" label={t('meaningGovernance.correct')} onDismiss={close} dismissOnBackdrop regions={{
  header:<div className="flex items-center justify-between gap-3"><h2 className="text-xl font-medium">{t('meaningGovernance.correct')}</h2><button className={contentButton} disabled={busy} onClick={close}>{t('content.close')}</button></div>,
  primary:<form id="meaning-correction-form" className="space-y-5" onSubmit={event=>{event.preventDefault();void save();}}>
   {!seed&&!pending.current&&!error&&<p role="status">{localFlowText('loadingSensa')}</p>}
   {seed&&<section><h3 className="text-sm text-fg-secondary">{t('manualMeaning.context')}</h3><p className="mt-2 whitespace-pre-wrap break-words">{seed.payload.context?.textSegment}</p>{seed.images.map(image=><img className="mt-3 max-h-64 rounded-card object-contain" key={image.id} src={image.dataUrl} alt={image.name}/>)}</section>}
   <fieldset disabled={!seed||busy||!!pending.current||stale} className="space-y-5">
    <label className="block text-sm">{t('meaningGovernance.editIntent')}<select aria-label={t('meaningGovernance.editIntent')} className={control} value={senseEdit} onChange={event=>change({},event.target.value as typeof senseEdit)}><option value="wording">{t('meaningGovernance.wordingOnly')}</option><option value="different_meaning">{t('meaningGovernance.differentMeaning')}</option></select></label>
    {senseEdit==='wording'&&<p className="text-sm text-fg-secondary">{t(seed?.published?'meaningGovernance.publishedWordingHint':'meaningGovernance.wordingHint')}</p>}
    <div className="text-sm"><label htmlFor="meaning-correction-expression">{t('meaningGovernance.expression')}</label><input id="meaning-correction-expression" className={control} required maxLength={2000} value={draft.canonicalForm} onChange={event=>change({canonicalForm:event.target.value,occurrence:event.target.value})}/></div>
    <div className="text-sm"><label htmlFor="meaning-correction-meaning">{t('manualMeaning.meaning')}</label><textarea id="meaning-correction-meaning" className={control} required readOnly={!!draft.existingSense} maxLength={4000} rows={2} value={draft.meaning} onChange={event=>change({meaning:event.target.value})}/></div>
    <details><summary className="cursor-pointer text-sm text-fg-secondary">{t('manualMeaning.usage')}</summary><textarea aria-label={t('manualMeaning.usage')} id="meaning-correction-usage" className={control} readOnly={!!draft.existingSense||senseEdit==='wording'&&seed?.published} maxLength={4000} rows={2} value={draft.usage} onChange={event=>change({usage:event.target.value})}/></details>
    <details><summary className="cursor-pointer text-sm text-fg-secondary">{t('meaningGovernance.formSettings')}</summary><div className="mt-3 grid grid-cols-2 gap-3"><label>{t('manualMeaning.language')}<select className={control} value={draft.languageTag} onChange={event=>change({languageTag:event.target.value})}>{!sensaLanguages.some(row=>row.tag===draft.languageTag)&&<option value={draft.languageTag}>{draft.languageTag}</option>}{sensaLanguages.map(row=><option key={row.tag} value={row.tag}>{row.tag}</option>)}</select></label><label>{t('manualMeaning.type')}<select className={control} value={draft.expressionType} onChange={event=>change({expressionType:sensaExpressionTypeSchema.parse(event.target.value)})}>{sensaExpressionTypeSchema.options.map(type=><option key={type} value={type}>{t(`manualMeaning.types.${type}`)}</option>)}</select></label></div></details>
    <ExistingMeaningPicker onPick={({senseId,senseVersionId,senseKey,semanticSpec})=>change({existingSense:{senseId,senseVersionId,senseKey,semanticSpec},meaning:semanticSpec.coreMeaningFocus,usage:semanticSpec.prototypeScenes[0]?.summary??''},senseId===seed?.reuseSense.senseId?'wording':'different_meaning')}/>
    {draft.existingSense&&<><SenseSpec spec={draft.existingSense.semanticSpec}/><button className={contentButton} type="button" onClick={()=>change({existingSense:null})}>{t('manualMeaning.writeOwn')}</button></>}
   </fieldset>
   {error&&<p role="alert" className="text-sm text-feedback-danger">{error.startsWith('localFlow.')?localFlowText(error.slice(10) as 'localStatusFailed'):t(error)}</p>}
   {!seed&&!pending.current&&error&&<button className={contentButton} type="button" onClick={()=>setAttempt(value=>value+1)}>{t('content.retry')}</button>}
   {stale&&seed&&<button className={contentButton} type="button" disabled={busy} onClick={()=>void restart()}>{t('meaningGovernance.retryRead')}</button>}
  </form>,
  controls:<button type="submit" form="meaning-correction-form" disabled={busy||!key||(!pending.current&&(!seed||stale))} className={contentButton+' bg-action-primary text-action-on-primary'}>{t(busy?'manualMeaning.saving':confirmed?'meaningGovernance.retryRead':'manualMeaning.save')}</button>,
 }}/>
}

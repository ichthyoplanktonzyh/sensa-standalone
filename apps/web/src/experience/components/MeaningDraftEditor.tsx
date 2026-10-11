import {contextFlowText} from '../../i18n/contextFlowText';
import {z} from 'zod';
import {useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {useTranslation} from 'react-i18next';
import {sensaIntakePayloadSchema,sensaLanguages,sensaExpressionTypeSchema,sensaSenseSemanticSpecSchema,type SensaIntakePayload,type SensaExpressionType} from '@sensa/contracts/sensa';
import {useJourneyGateway,type JourneyDetailView} from '../personalMeaningJourney';
import {worldReadRepository} from '../personalMeaningJourney/worldRepository';
import {manualMeaningSense,newManualMeaningDraft} from '../intake/manualMeaning';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {ExistingMeaningPicker} from './ExistingMeaningPicker';
import {previewStorage} from '../services/previewStorage';

const control='mt-2 min-h-11 w-full rounded-control border border-border-subtle bg-surface-panel p-3';
const button='min-h-11 rounded-control border border-border-subtle px-4 disabled:opacity-50';
type Seed=Awaited<ReturnType<typeof worldReadRepository.draftConfirmation>>;
const editorCacheSchema=z.object({sourceDigest:z.string().regex(/^[0-9a-f]{64}$/u),meaning:z.string().max(4000),expression:z.string().max(2000),language:z.string().max(100),context:z.string().max(12000),expressionType:sensaExpressionTypeSchema,selection:z.object({senseId:z.string().uuid(),senseVersionId:z.string().uuid(),senseKey:z.string(),semanticSpec:sensaSenseSemanticSpecSchema}).nullable()});
type SelectedSense=NonNullable<z.infer<typeof editorCacheSchema>['selection']>;
export function MeaningDraftEditor({detail,onBack,onSaved,governanceControls}:{detail:JourneyDetailView;onBack:()=>void;onSaved:()=>void;governanceControls?:ReactNode}){
 const {t}=useTranslation();
 const gateway=useJourneyGateway(),[seed,setSeed]=useState<Seed|null>(null),[meaning,setMeaning]=useState(''),[expression,setExpression]=useState(''),[language,setLanguage]=useState(''),[expressionType,setExpressionType]=useState<SensaExpressionType>('word'),[context,setContext]=useState(''),[selection,setSelection]=useState<SelectedSense|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[stale,setStale]=useState(false),[restart,setRestart]=useState(0);
 const alignment=detail.directAlignments.find(row=>!row.confirmedBindings.length);
 const cacheKey=`meaning-editor:${detail.personalMeaningId}:${alignment?.personalMeaningAlignmentId??'draft'}`;
 useEffect(()=>{let active=true;void (async()=>{
  const saved:Seed=alignment?await worldReadRepository.correction(detail.personalMeaningId,alignment.personalMeaningAlignmentId).then(row=>({revision:detail.revision,personalMeaningId:detail.personalMeaningId,source:row.source,context:row.payload.context,contextRevisionIds:row.contextRevisionIds,meaning:row.payload.sense!.semanticSpec.coreMeaningFocus,expression:null})):await worldReadRepository.draftConfirmation(detail.personalMeaningId);
  if(!active)return;
  const raw=previewStorage.getItem(cacheKey);let cached:z.infer<typeof editorCacheSchema>|null=null,unreadable=false;
  try{if(raw)cached=editorCacheSchema.parse(JSON.parse(raw));}catch{unreadable=true;}
  setSeed(saved);setMeaning(cached?.meaning??saved.meaning);setExpression(cached?.expression??saved.expression?.surfaceForm??'');setLanguage(cached?.language??saved.expression?.languageTag??'');setContext(cached?.context??saved.context?.textSegment??'');setExpressionType(cached?.expressionType??saved.expression?.expressionType??'word');setSelection(cached?.selection??null);setStale(unreadable||!!cached&&cached.sourceDigest!==saved.source.digest);if(unreadable)setError('localFlow.localStatusFailed');
 })().catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'localFlow.progressReadFailed');});return()=>{active=false;};},[detail.personalMeaningId,detail.revision,alignment?.personalMeaningAlignmentId,cacheKey,restart]);
 useEffect(()=>{if(!seed||busy||stale)return;try{previewStorage.setItem(cacheKey,JSON.stringify({sourceDigest:seed.source.digest,meaning,expression,language,context,expressionType,selection}));}catch{setError('manualMeaning.draftError');}},[seed,meaning,expression,language,context,expressionType,selection,busy,stale]);
 const write=async(confirm:boolean)=>{
  if(!seed||busy||stale)return;setBusy(true);setError('');
  try{
   if(alignment){
    if(!expression.trim()||!language)throw Error('manualMeaning.languageRequired');
    const saved=await worldReadRepository.correction(detail.personalMeaningId,alignment.personalMeaningAlignmentId),ids=saved.contextRevisionIds;
    const payload=sensaIntakePayloadSchema.parse({...saved.payload,operationId:crypto.randomUUID(),acceptance:{mode:'learner_direct'},expression:{surfaceForm:expression.trim(),languageTag:language,expressionTypeHint:expressionType,occurrence:{surfaceForm:expression.trim(),locator:{kind:'personal_meaning',personalMeaningId:detail.personalMeaningId,personalSemanticAnchorRevisionIds:ids}}}});
    await gateway.correctPersonalMeaning({operationId:payload.operationId,personalMeaningId:detail.personalMeaningId,personalMeaningAlignmentId:alignment.personalMeaningAlignmentId,source:seed.source,payload,reuseSense:saved.reuseSense});previewStorage.removeItem(cacheKey);onSaved();return;
   }
   let revision=seed.revision;
   if(context.trim()!==(seed.context?.textSegment??'')){const changed=await gateway.reviseContext({operationId:crypto.randomUUID(),personalMeaningId:detail.personalMeaningId,expectedRevision:revision,blocks:[...(context.trim()?[{kind:'text' as const,bodyText:context.trim()}]:[]),...(seed.context?.mediaReferenceIds??[]).map(id=>({kind:'image' as const,personalMediaObjectId:id}))]});revision=changed.revision;}
   await gateway.updateMeaningDraft({operationId:crypto.randomUUID(),personalMeaningId:detail.personalMeaningId,expectedRevision:revision,learnerIntentNote:meaning.trim()||null,draftExpression:expression.trim()?{surfaceForm:expression.trim(),languageTag:language||null,expressionType}:null});
   const current=await worldReadRepository.draftConfirmation(detail.personalMeaningId);setSeed(current);
   if(confirm){
    const draft={...newManualMeaningDraft(),meaning,usage:'',existingSense:selection?{senseId:selection.senseId,senseVersionId:selection.senseVersionId,senseKey:selection.senseKey,semanticSpec:selection.semanticSpec}:null};
    if(selection)draft.usage=selection.semanticSpec.prototypeScenes[0]?.summary??'';
    const payload:SensaIntakePayload=sensaIntakePayloadSchema.parse({contractVersion:'sensa-intake-v3',operationId:crypto.randomUUID(),capturedAt:new Date().toISOString(),context:current.context,expression:expression.trim()?{surfaceForm:expression.trim(),languageTag:language||null,expressionTypeHint:expressionType,occurrence:{surfaceForm:expression.trim(),locator:{kind:'personal_meaning',personalMeaningId:detail.personalMeaningId,personalSemanticAnchorRevisionIds:current.contextRevisionIds}}}:null,sense:manualMeaningSense(draft),acceptance:{mode:'learner_direct'}});
    await gateway.confirmMeaningDraft({operationId:payload.operationId,personalMeaningId:detail.personalMeaningId,source:current.source,payload});
   }
   previewStorage.removeItem(cacheKey);onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:'localFlow.progressReadFailed');}finally{setBusy(false);}
 };
 return <section className="mx-auto h-full min-h-0 w-full max-w-2xl space-y-5 overflow-y-auto p-5" aria-busy={busy}>
  <button className={button} disabled={busy} onClick={onBack}>{t('contentUi.back')}</button>
  <h1 className="text-2xl font-medium">{contextFlowText(alignment?'confirmExpression':'savedMeaningDraft')}</h1>
  <p className="text-sm text-fg-secondary">{contextFlowText(alignment?'senseOnlyHint':'draftStagesHint')}</p>
  {stale&&<p role="alert">{contextFlowText('draftChanged')} <button className={button} onClick={()=>{previewStorage.removeItem(cacheKey);setSeed(null);setStale(false);setError('');setRestart(value=>value+1);}}>{t('manualMeaning.restart')}</button></p>}
  <fieldset className="space-y-5" disabled={busy||!seed||stale}>
   <label className="block">{contextFlowText('context')}<textarea aria-label={contextFlowText('context')} rows={4} className={control} readOnly={!!alignment} value={context} onChange={event=>setContext(event.target.value)}/></label>
   {!alignment&&<ExistingMeaningPicker onPick={value=>{setSelection({senseId:value.senseId,senseVersionId:value.senseVersionId,senseKey:value.senseKey,semanticSpec:value.semanticSpec});setMeaning(value.semanticSpec.coreMeaningFocus);}}/>}
   <label className="block">{contextFlowText('confirmedMeaning')}<textarea aria-label={contextFlowText('confirmedMeaning')} rows={2} className={control} readOnly={!!alignment||!!selection} value={meaning} onChange={event=>setMeaning(event.target.value)}/></label>
   {selection&&<button className={button} onClick={()=>setSelection(null)}>{contextFlowText('writeOwnMeaning')}</button>}
   <label className="block">{contextFlowText('optionalExpression')}<input aria-label={contextFlowText('optionalExpression')} className={control} value={expression} onChange={event=>setExpression(event.target.value)}/></label>
   <label className="block">{contextFlowText('expressionLanguage')}<select aria-label={contextFlowText('expressionLanguage')} className={control} value={language} onChange={event=>setLanguage(event.target.value)}><option value="">—</option>{sensaLanguages.map(row=><option key={row.tag} value={row.tag}>{row.tag}</option>)}</select></label>
   <label className="block">{t('manualMeaning.type')}<select className={control} value={expressionType} onChange={event=>setExpressionType(event.target.value as typeof expressionType)}>{sensaExpressionTypeSchema.options.map(value=><option key={value} value={value}>{t(`manualMeaning.types.${value}`)}</option>)}</select></label>
  </fieldset>
  {error&&<p role="alert">{error.startsWith('manualMeaning.')?t(error):localFlowNotice(error)}</p>}
  <div className="flex flex-wrap gap-3">{!alignment&&<button className={button} disabled={busy||!seed||stale} onClick={()=>void write(false)}>{contextFlowText('saveMeaningDraft')}</button>}<button className={button+' bg-action-primary text-action-on-primary'} disabled={busy||!seed||stale||!meaning.trim()||!!expression.trim()&&!language||!!alignment&&!expression.trim()} onClick={()=>void write(true)}>{contextFlowText(alignment?'confirmExpression':'confirmMeaning')}</button></div>
  {governanceControls}
 </section>;
}

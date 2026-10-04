import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {X} from 'lucide-react';
import {sensaLanguages,sensaExpressionTypeSchema} from '@sensa/contracts/sensa';
import {openLibrary} from '../../data/library/store';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {useSemanticIntake} from '../intake/useSemanticIntake';
import {manualMeaningDraftSchema,manualMeaningPayload,newManualMeaningDraft,occurrencePositions,type ManualMeaningDraft} from '../intake/manualMeaning';
import {previewStorage} from '../services/previewStorage';

const control='mt-2 block w-full rounded-control border border-border-subtle bg-surface-panel px-3 py-3 text-sm text-fg-primary focus-visible:outline-2 focus-visible:outline-focus';
const button='inline-flex min-h-11 items-center justify-center rounded-control px-4 text-sm focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50';

export function ManualMeaningComposer({onClose,onCreated}:{onClose:()=>void;onCreated:(id:string)=>void}){
  const {t,i18n}=useTranslation(),intake=useSemanticIntake();
  const [draft,setDraft]=useState(newManualMeaningDraft),[key,setKey]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [loadAttempt,setLoadAttempt]=useState(0);
  const saving=useRef(false);
  useEffect(()=>{
    let active=true;
    setError('');
    // Prepare the immediate result screen while this entry is available online.
    // Saving local facts must not be followed by a first-time chunk fetch offline.
    void Promise.all([openLibrary(),import('./PersonalMeaningDetailScreen')]).then(([identity])=>{
      if(!active)return;
      const storageKey=`manual-meaning:${identity.id}`;
      const raw=previewStorage.getItem(storageKey);
      if(raw){const parsed=manualMeaningDraftSchema.safeParse(JSON.parse(raw));if(!parsed.success)throw new Error('invalid_draft');setDraft(parsed.data);}
      setKey(storageKey);
    }).catch(()=>{if(active)setError('manualMeaning.draftError');});
    return()=>{active=false;};
  },[loadAttempt]);
  const close=()=>{if(!saving.current)onClose();};
  useEffect(()=>{const listener=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);});
  const change=(patch:Partial<ManualMeaningDraft>)=>{
    if(saving.current||!key)return;
    const next={...draft,...patch,operationId:crypto.randomUUID(),capturedAt:new Date().toISOString()};
    setDraft(next);setError('');
    try{previewStorage.setItem(key,JSON.stringify(next));}catch{setError('manualMeaning.draftError');}
  };
  const positions=occurrencePositions(draft.context,draft.occurrence);
  const save=async()=>{
    if(saving.current||!key)return;
    setError('');
    let payload;
    try{payload=manualMeaningPayload(draft);}catch(cause){setError(cause instanceof Error&&cause.message.startsWith('manualMeaning.')?cause.message:'manualMeaning.invalid');return;}
    saving.current=true;setBusy(true);
    try{
      const identity=await openLibrary();
      if(key!==`manual-meaning:${identity.id}`)throw new Error('library_changed');
      // Persist the exact retry identity before submitting, including across reloads.
      previewStorage.setItem(key,JSON.stringify(draft));
      const result=await intake.submit(payload);
      if(result.route!=='fast_track')throw new Error('incomplete_manual_meaning');
      // A draft cleanup failure must not disguise an already committed result.
      try{previewStorage.removeItem(key);}catch{/* The saved operation can only replay. */}
      onCreated(result.personalMeaningId);
    }catch{setError('manualMeaning.saveError');}
    finally{saving.current=false;setBusy(false);}
  };
  return <SensaOverlayLayout variant="sheet" measure="standard" className="sensa-manual-meaning z-[110]" labelledBy="manual-meaning-title" onDismiss={close} dismissOnBackdrop regions={{
    header:<div className="flex items-center justify-between"><h2 id="manual-meaning-title" className="text-xl font-medium">{t('content.manual')}</h2><button type="button" className={button} disabled={busy} onClick={close} aria-label={t('content.close')}><X size={20}/></button></div>,
    primary:<form id="manual-meaning-form" onSubmit={event=>{event.preventDefault();void save();}} className="space-y-5" aria-busy={busy}>
      <fieldset disabled={busy||!key} className="space-y-5">
        <label className="block text-sm">{t('manualMeaning.context')}<textarea aria-label={t('manualMeaning.context')} autoFocus required rows={4} maxLength={12000} className={control} value={draft.context} onChange={event=>change({context:event.target.value,occurrenceStart:null})} onSelect={event=>{const field=event.currentTarget;if(field.selectionEnd<=field.selectionStart)return;const selected=field.value.slice(field.selectionStart,field.selectionEnd);if(!selected.trim())return;change({occurrence:selected.trim(),occurrenceStart:field.selectionStart-(field.value.length-field.value.trimStart().length)+(selected.length-selected.trimStart().length),canonicalForm:''});}}/></label>
        <label className="block text-sm">{t('manualMeaning.occurrence')}<input required maxLength={2000} className={control} value={draft.occurrence} onChange={event=>change({occurrence:event.target.value,occurrenceStart:null})}/></label>
        {positions.length>1&&<fieldset className="space-y-2"><legend className="text-sm">{t('manualMeaning.chooseOccurrence')}</legend>{positions.map((start,index)=><label className="flex items-start gap-3 rounded-control border border-border-subtle p-3 text-sm" key={start}><input type="radio" name="occurrence" checked={draft.occurrenceStart===start} onChange={()=>change({occurrenceStart:start})}/><span>{index+1}. {draft.context.trim().slice(Math.max(0,start-20),start)}<mark>{draft.occurrence.trim()}</mark>{draft.context.trim().slice(start+draft.occurrence.trim().length,start+draft.occurrence.trim().length+20)}</span></label>)}</fieldset>}
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">{t('manualMeaning.language')}<select aria-label={t('manualMeaning.language')} required className={control} value={draft.languageTag} onChange={event=>change({languageTag:event.target.value})}><option value="">{t('manualMeaning.chooseLanguage')}</option>{sensaLanguages.map(language=><option value={language.tag} key={language.tag}>{interfaceLanguageDisplayName(language.tag,resolveInterfaceLocale(i18n.resolvedLanguage))}</option>)}</select></label>
          <label className="block text-sm">{t('manualMeaning.type')}<select aria-label={t('manualMeaning.type')} className={control} value={draft.expressionType} onChange={event=>change({expressionType:sensaExpressionTypeSchema.parse(event.target.value)})}>{sensaExpressionTypeSchema.options.map(type=><option key={type} value={type}>{t(`manualMeaning.types.${type}`)}</option>)}</select></label>
        </div>
        <label className="block text-sm">{t('manualMeaning.meaning')}<textarea aria-label={t('manualMeaning.meaning')} required rows={2} maxLength={4000} className={control} value={draft.meaning} onChange={event=>change({meaning:event.target.value})}/></label>
        <label className="block text-sm">{t('manualMeaning.usage')}<textarea aria-label={t('manualMeaning.usage')} required rows={2} maxLength={4000} className={control} value={draft.usage} onChange={event=>change({usage:event.target.value})}/></label>
        <details><summary className="cursor-pointer text-sm text-fg-secondary">{t('manualMeaning.canonical')}</summary><input aria-label={t('manualMeaning.canonical')} className={control} maxLength={2000} value={draft.canonicalForm} placeholder={draft.occurrence} onChange={event=>change({canonicalForm:event.target.value})}/></details>
      </fieldset>
      {error&&<p role="alert" className="text-sm text-status-error">{t(error)}</p>}
      {error&&!key&&<button type="button" className={button} onClick={()=>setLoadAttempt(value=>value+1)}>{t('content.retry')}</button>}
    </form>,
    controls:<button type="submit" form="manual-meaning-form" disabled={busy||!key} className={`${button} bg-action-primary text-action-on-primary`}>{t(busy?'manualMeaning.saving':'manualMeaning.save')}</button>,
  }}/>;
}

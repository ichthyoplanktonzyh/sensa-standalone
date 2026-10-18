import {contextFlowText} from '../../i18n/contextFlowText';
import {useMemo,useState,useSyncExternalStore} from 'react';
import type {MaterialBlockInput} from '../personalMeaningJourney/types';
import {useTranslation} from 'react-i18next';
import {worldReadRepository} from '../personalMeaningJourney/worldRepository';
import {WorldSnapshotReader} from '../personalMeaningJourney/worldReaders';
import type {ContextDetail} from '../personalMeaningJourney/contextRead';
import {useJourneyGateway} from '../personalMeaningJourney';
import {SensaOverlayLayout} from '../ui/SensaComponents';
import {InboxMedia} from './InboxMedia';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';

const button='min-h-11 rounded-control border border-border-subtle px-4 text-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-focus';
export function ContextLibrary({onClose,onCreated,initialId}:{onClose:()=>void;onCreated:(id:string)=>void;initialId?:string|null}){
 const {t}=useTranslation(),gateway=useJourneyGateway(),[query,setQuery]=useState(''),[offset,setOffset]=useState(0),[selected,setSelected]=useState<string|null>(initialId??null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [trash,setTrash]=useState(false),[editing,setEditing]=useState<{revisionId:string;blocks:MaterialBlockInput[]}|null>(null);
 const reader=useMemo(()=>new WorldSnapshotReader({subscribe:worldReadRepository.subscribe,read:()=>worldReadRepository.contextPage({query,offset,limit:50,status:trash?'deleted':'active'})}),[query,offset,trash]);
 const list=useSyncExternalStore(reader.subscribe,reader.read);
 const detailReader=useMemo(()=>new WorldSnapshotReader<{detail:ContextDetail|null}>({subscribe:worldReadRepository.subscribe,read:()=>selected?worldReadRepository.contextDetail(selected):Promise.resolve({detail:null})}),[selected]);
 const detail=useSyncExternalStore(detailReader.subscribe,detailReader.read),context=detail.value?.detail;
 const start=async()=>{if(!context||detail.status.loading||!detail.status.ok||busy)return;setBusy(true);setError('');try{const result=await gateway.createMeaningDraft({operationId:crypto.randomUUID(),contextReferences:[{contextId:context.head.personalSemanticAnchorId,revisionId:context.revision.personalSemanticAnchorRevisionId}]});onCreated(result.personalMeaningId);}catch(cause){setError(cause instanceof Error?cause.message:contextFlowText('progressReadFailed'));}finally{setBusy(false);}};
 const mutate=async(action:'save'|'delete'|'restore')=>{
  if(!context||busy)return;setBusy(true);setError('');
  try{
   const input={operationId:crypto.randomUUID(),contextId:context.head.personalSemanticAnchorId,expectedRevisionId:editing?.revisionId??context.revision.personalSemanticAnchorRevisionId};
   if(action==='save'){if(!editing)return;await gateway.reviseSavedContext({...input,blocks:editing.blocks});setEditing(null);}
   else await gateway.changeContextLifecycle({...input,action});
   detailReader.reload();reader.reload();
  }catch(cause){setError(cause instanceof Error?cause.message:contextFlowText('progressReadFailed'));}finally{setBusy(false);}
 };
 return <SensaOverlayLayout variant="sheet" measure="standard" labelledBy="context-library-title" onDismiss={busy?undefined:onClose} regions={{
  header:<div className="flex items-center justify-between gap-3"><h2 id="context-library-title" className="text-xl font-medium">{contextFlowText('savedContexts')}</h2><button className={button} disabled={busy} onClick={onClose}>{t('content.close')}</button></div>,
  primary:<div className="space-y-4">{selected?<>
   <button className={button} onClick={()=>{setSelected(null);setEditing(null);}} disabled={busy}>{contextFlowText('backToContexts')}</button>
   {detail.status.loading?<p role="status">{contextFlowText('loadingSensa')}</p>:!detail.status.ok?<p role="alert">{contextFlowText('progressReadFailed')}<button className={button} onClick={detailReader.reload}>{t('content.retry')}</button></p>:context?<>
    <p className="text-sm text-fg-secondary">{contextFlowText('contextSavedHint')}</p>
    <p className="text-sm text-fg-secondary">{contextFlowText('contextReferences',{count:context.meaningCount})}</p>
    {editing?<div className="space-y-3"><p className="text-sm">{contextFlowText('contextVersionHint')}</p>{editing.blocks.map((block,index)=>block.kind==='text'?<label key={index} className="block">{contextFlowText('context')}<textarea aria-label={contextFlowText('context')} rows={4} value={block.bodyText??''} disabled={busy} className="mt-2 w-full rounded-control border border-border-subtle bg-surface-panel p-3" onChange={event=>setEditing({...editing,blocks:editing.blocks.map((row,at)=>at===index?{kind:'text',bodyText:event.target.value}:row)})}/></label>:<div key={index}>{(()=>{const inline=(context.revision.structuredPayload.media as Array<{mediaId:string;dataUrl:string;altText:string}>|undefined)?.find(row=>row.mediaId===block.personalMediaObjectId);return inline?<img src={inline.dataUrl} alt={inline.altText} className="max-h-72 max-w-full object-contain"/>:<InboxMedia ids={[block.personalMediaObjectId!]}/>;})()}<button className={button} disabled={busy} onClick={()=>setEditing({...editing,blocks:editing.blocks.filter((_,at)=>at!==index)})}>{t('composer.remove')}</button></div>)}<div className="flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={()=>setEditing({...editing,blocks:[...editing.blocks,{kind:'text',bodyText:''}]})}>{t('composer.text')}</button><button className={button} disabled={busy} onClick={()=>void mutate('save')}>{contextFlowText('saveContext')}</button><button className={button} disabled={busy} onClick={()=>setEditing(null)}>{t('content.close')}</button></div></div>:<>
    {context.blocks.map((block,index)=>{const inline=(context.revision.structuredPayload.media as Array<{mediaId:string;dataUrl:string;altText:string}>|undefined)?.find(row=>row.mediaId===block.personalMediaObjectId);return block.kind==='text'?<p key={index} className="whitespace-pre-wrap leading-7">{block.bodyText}</p>:inline?<img key={index} src={inline.dataUrl} alt={inline.altText} className="max-h-72 max-w-full object-contain"/>:<InboxMedia key={index} ids={[block.personalMediaObjectId!]}/>;})}
    <div className="flex flex-wrap gap-3">{context.head.status==='active'?<>{!context.sceneManaged&&<button className={button} disabled={busy} onClick={()=>setEditing({revisionId:context.revision.personalSemanticAnchorRevisionId,blocks:structuredClone(context.blocks)})}>{contextFlowText('editContext')}</button>}<button className={button} disabled={busy} onClick={()=>void mutate('delete')}>{contextFlowText('deleteContext')}</button></>:<button className={button} disabled={busy} onClick={()=>void mutate('restore')}>{contextFlowText('restoreContext')}</button>}</div>
    </>}
   </>:<p>{contextFlowText('contextMissing')}</p>}
  </>:<>
   <input aria-label={contextFlowText('searchContexts')} value={query} onChange={event=>{setQuery(event.target.value);setOffset(0);}} placeholder={contextFlowText('searchContexts')} className="min-h-11 w-full rounded-control border border-border-subtle bg-surface-panel px-3"/>
   <button className={button} aria-pressed={trash} onClick={()=>{setTrash(value=>!value);setOffset(0);}}>{contextFlowText('deletedContexts')}</button>
   {list.status.loading?<p role="status">{contextFlowText('loadingSensa')}</p>:!list.status.ok?<p role="alert">{contextFlowText('progressReadFailed')}<button className={button} onClick={reader.reload}>{t('content.retry')}</button></p>:<>
    {!list.value?.total&&<p className="text-fg-secondary">{contextFlowText('contextsEmpty')}</p>}
    {list.value?.items.map(item=><button key={item.contextId} onClick={()=>setSelected(item.contextId)} className="block w-full border-b border-border-subtle py-4 text-left"><span className="line-clamp-3 whitespace-pre-wrap leading-7">{item.label||contextFlowText('imageContext')}</span><span className="mt-2 block text-xs text-fg-secondary">{contextFlowText('contextReferences',{count:item.meaningCount})}</span></button>)}
    {!!list.value?.total&&<div className="flex gap-3"><button className={button} disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-50))}>{contextFlowText('previousPage')}</button><button className={button} disabled={offset+50>=list.value.total} onClick={()=>setOffset(value=>value+50)}>{contextFlowText('nextPage')}</button></div>}
   </>}
  </>}{error&&<p role="alert">{localFlowNotice(error)}</p>}</div>,
  controls:selected?<button className={button+' bg-action-primary text-action-on-primary'} disabled={!context||context.head.status!=='active'||detail.status.loading||!detail.status.ok||busy||!!editing} onClick={()=>void start()}>{contextFlowText('startMeaningFromContext')}</button>:undefined,
 }}/>
}

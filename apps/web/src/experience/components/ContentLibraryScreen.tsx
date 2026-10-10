import '../../i18n/contentResources';
import {useTranslation} from 'react-i18next';
import {uiText} from '../../i18n/uiText';
import {localFlowText} from '../../i18n/localFlowText';
import {learnerSemanticProjectionSystem,type ContentNoteItem,type ContentSenseReference,type ContentSectionId,type SavedExampleItem} from '../../learnerSemanticProjection/system';
import {useLearnerSemanticProjection} from '../../learnerSemanticProjection/useLearnerSemanticProjection';
import {SensaCollectionBrowserLayout} from '../ui/SensaPageLayouts';
import {SensaVirtualList} from '../ui/SensaVirtualList';
import {useScreenState} from '../ui/ScreenHost';

interface Props{
 active:boolean;section:ContentSectionId;onBack:()=>void;
 onOpenReference:(item:ContentSenseReference)=>void;
 onOpenExample:(item:SavedExampleItem)=>void;
 onEditNote:(item:ContentNoteItem)=>void;
}
const rowClass='flex min-h-20 w-full items-center gap-3 border-0 bg-transparent p-5 text-left text-fg-primary transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus motion-reduce:transition-none';
const markClass='grid size-10 shrink-0 place-items-center rounded-control bg-accent-soft text-lg font-bold text-action-primary';
const copyClass='flex min-w-0 flex-1 flex-col gap-1';
const titleClass='flex items-center gap-2 text-body font-semibold [&_em]:rounded-control [&_em]:border [&_em]:border-border-subtle [&_em]:px-1.5 [&_em]:py-0.5 [&_em]:text-metadata [&_em]:font-medium [&_em]:not-italic [&_em]:text-fg-secondary';
const subtitleClass='overflow-hidden text-ellipsis whitespace-nowrap text-body-support text-fg-secondary';
type Row={kind:'sense';item:ContentSenseReference}|{kind:'note';item:ContentNoteItem}|{kind:'example';item:SavedExampleItem};

function EmptyState({section}:{section:ContentSectionId}){
 const copy={recent:['noLearningHistoryYet','meaningsAppearHereAfterYouStudyThem'],learned:['noStudiedMeaningsYet','theMeaningsYouStudyWillAppearHere'],known:['noMeaningsMarkedAsKnown','onlyMeaningsYouExplicitlyMarkAsKnown'],'saved-senses':['noSavedMeaningsYet','saveAMeaningFromItsDetailsOr'],'saved-examples':['noSavedExamplesYet','saveAnExampleYouWantToRevisit'],notes:['noNotesYet','writeANoteOnASpecificMeaning']} as const;
 const [title,body]=copy[section];
 return <div className="flex min-h-72 flex-col items-center justify-center p-9 text-center text-fg-secondary"><h3 className="mb-2 text-section-title font-medium text-fg-primary">{uiText(title)}</h3><p className="max-w-60 text-body-support">{uiText(body)}</p></div>;
}

/** One user collection, regardless of whether its real source is a Book or a Meaning. */
export function ContentLibraryScreen({active,section,onBack,onOpenReference,onOpenExample,onEditNote}:Props){
 useTranslation();const projection=useLearnerSemanticProjection();
 const [query,setQuery]=useScreenState('content-library:'+section+':query','');
 const title=uiText(section),normalized=query.trim().toLowerCase();
 const references=section==='recent'?projection.recent:section==='learned'?projection.learned:section==='known'?projection.known:section==='saved-senses'?projection.savedSenses:[];
 const notes=section==='notes'?projection.notes:[],examples=section==='saved-examples'?projection.savedExamples:[];
 const status=section==='saved-senses'||section==='notes'?projection.personalReferenceStatus:['recent','learned','known'].includes(section)?projection.learningStatus:projection.annotationStatus;
 const unavailableExamples=section==='saved-examples'&&status==='ready'&&projection.savedExampleCount>examples.length;
 const count=section==='saved-examples'?projection.savedExampleCount:references.length+notes.length+examples.length;
 const matches=(text:string)=>!normalized||text.toLowerCase().includes(normalized);
 const rows:Row[]=[
  ...references.filter(item=>matches(item.word+' '+item.meaning)).map(item=>({kind:'sense' as const,item})),
  ...notes.filter(item=>matches(item.word+' '+item.body+' '+item.reference.meaning)).map(item=>({kind:'note' as const,item})),
  ...examples.filter(item=>matches([item.sense.word,item.sense.meaning,item.sense.example.text,item.sense.example.translation].join(' '))).map(item=>({kind:'example' as const,item})),
 ];
 const render=(row:Row)=>{
  if(row.kind==='example')return <button className={rowClass} onClick={()=>onOpenExample(row.item)}><span className={markClass}>“</span><span className={copyClass}><span className={titleClass}>{row.item.sense.word}<em>{row.item.sense.pos}</em></span><span className="line-clamp-2 text-body-support font-semibold">{row.item.sense.example.text}</span><span className={subtitleClass}>{row.item.sense.example.translation}</span></span></button>;
  const reference=row.kind==='sense'?row.item:row.item.reference;
  return <button className={rowClass} onClick={()=>row.kind==='note'&&reference.kind!=='personal_meaning'?onEditNote(row.item):onOpenReference(reference)}><span className={markClass}>{row.kind==='note'?'✎':reference.word.slice(0,1).toUpperCase()}</span><span className={copyClass}><span className={titleClass}>{reference.word}{reference.kind==='practice'&&reference.practice.pos&&<em>{reference.practice.pos}</em>}</span><span className={subtitleClass}>{row.kind==='note'?row.item.body:reference.meaning}</span></span><svg className="size-4 shrink-0 text-fg-tertiary" aria-hidden="true"><use href="#i-chev-r"/></svg></button>;
 };
 return <SensaCollectionBrowserLayout id="s-content-library" data-anim="slide" aria-hidden={!active} className={'sensa-motion-screen sensa-motion-screen-slide z-[27] '+(active?'visible pointer-events-auto translate-x-0':'invisible pointer-events-none translate-x-full')} headerStyle="bar" measure="narrow" regions={{
  header:<div className="grid min-h-20 grid-cols-[2.75rem_1fr_2.75rem] items-center gap-3 py-4"><button className="grid size-11 place-items-center rounded-control text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" onClick={onBack} aria-label={uiText('backToMyContent4')}><svg className="size-5 shrink-0" aria-hidden="true"><use href="#i-chev-l"/></svg></button><h1 className="text-center text-section-title font-medium">{title}</h1><span className="grid min-w-9 place-items-center rounded-pill bg-accent-soft px-2 py-1 text-metadata">{status==='ready'?count:'—'}</span></div>,
  controls:<label className="flex min-h-12 items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-3 focus-within:border-border-strong"><svg className="size-5 shrink-0 text-fg-tertiary" aria-hidden="true"><use href="#i-search"/></svg><input className="min-w-0 flex-1 bg-transparent text-body-support outline-none" value={query} onChange={event=>setQuery(event.target.value)} placeholder={uiText('searchMyContent')} aria-label={uiText('searchSection',{section:title})}/>{query&&<button className="grid size-9 place-items-center rounded-control" onClick={()=>setQuery('')} aria-label={uiText('clearSearch')}>×</button>}</label>,
  collection:status!=='ready'?<div className="p-6" role={status==='error'?'alert':'status'}>{localFlowText(status==='error'?'progressReadFailed':'loadingSensa')}{status==='error'&&<button className="ml-3 min-h-11 underline" onClick={()=>learnerSemanticProjectionSystem.retryReferences()}>{uiText('retry')}</button>}</div>
   :<>{unavailableExamples&&<div className="p-6" role="alert">{uiText('unableToReadThisMaterial')}<button className="ml-3 min-h-11 underline" onClick={()=>learnerSemanticProjectionSystem.retryReferences()}>{uiText('retry')}</button></div>}
    {rows.length?<SensaVirtualList items={rows} label={title} estimateSize={96} itemKey={row=>row.kind==='sense'?'sense:'+(row.item.kind==='learning_target'?row.item.targetId:row.item.senseId):row.kind==='note'?row.item.noteId:row.item.exampleId} renderItem={render}/>
     :unavailableExamples?null:query?<div className="flex min-h-60 flex-col items-center justify-center p-9 text-center text-fg-secondary"><h3 className="mb-2 text-section-title font-medium">{uiText('noMatchingContent')}</h3><p className="max-w-60 text-body-support">{uiText('searchCoversYourContentOnly')}</p></div>:<EmptyState section={section}/>}</>,
 }}/>
}

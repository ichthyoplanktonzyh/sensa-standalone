import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Maximize,Minus,Plus,X,ArrowUpRight,Settings2,List} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {useWorldGraphDetail} from '../personalMeaningJourney/useWorldRead';
import type {WorldReadStamp} from '../personalMeaningJourney/worldRepository';
import type {WorldGraphItem} from '../personalMeaningJourney/worldRead';
import type {JourneyWorldItemView} from '../personalMeaningJourney';
import {buildMeaningGraph,relatedMeaningExpressions,type ExpressionAssociation} from '../ui/meaningGraph';
import {useScreenState} from '../ui/ScreenHost';
import {localFlowText} from '../../i18n/localFlowText';
import {ContentDrawer} from './ContentWorkspace';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {intakeSourceLabel,intakeSourceUrl} from '../personalMeaningJourney/sourcePresentation';

import {MeaningGraphCanvas,type GraphCanvasHandle} from './MeaningGraphCanvas';
import {SensaVirtualList} from '../ui/SensaVirtualList';

const associationKey=(row:ExpressionAssociation)=>`${row.item.personalMeaningId}:${row.alignment.personalMeaningAlignmentId}:${row.bindingVersionId}`;

export function MeaningGraphView({items,graphStamp,languages=[],screenId,selectedExpressionId,onSelectExpression,onOpenMeaning,learningState,searching=false}:{
 items:readonly WorldGraphItem[];graphStamp?:WorldReadStamp;languages?:readonly string[];screenId:string;
 selectedExpressionId:string|null;onSelectExpression:(id:string|null)=>void;
 onOpenMeaning:(id:string,focusId?:string)=>void;
 learningState?:(bindingVersionId:string)=>ReactNode;
 searching?:boolean;
}){
 const {t,i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const graph=useMemo(()=>{const started=performance.now(),value=buildMeaningGraph(items,languages);if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.model',{start:started,end:performance.now()});return value;},[items,JSON.stringify(languages)]);
 const [labels,setLabels]=useScreenState<'auto'|'all'|'selected'>(`${screenId}:graph-labels`,'auto');
 const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width: 48rem)').matches);
 const [hover,setHover]=useState<string|null>(null);
 const [owner,setOwner]=useScreenState<{expressionId:string;associationId:string}|null>(`${screenId}:graph-interpretation`,null);
 const canvas=useRef<GraphCanvasHandle>(null);
 const browseMenu=useRef<HTMLDivElement>(null),[browseOpen,setBrowseOpen]=useState(false);
 const browseScroll=useCallback(()=>browseMenu.current,[]);
 const byId=useMemo(()=>new Map(graph.nodes.map(node=>[node.id,node])),[graph]);
 const selected=byId.get(selectedExpressionId??''),highlight=byId.get(hover??'')??selected;
 const associationFor=(node:typeof graph.nodes[number])=>node.associations.find(row=>owner?.expressionId===node.id&&associationKey(row)===owner.associationId)??node.associations[0];
 const association=selected?associationFor(selected):undefined,highlightAssociation=highlight?associationFor(highlight):undefined;
 const related=useMemo(()=>selected?relatedMeaningExpressions(graph,selected.id):[],[graph,selected]);
 const close=()=>{const id=selectedExpressionId;onSelectExpression(null);setHover(null);requestAnimationFrame(()=>{if(id)canvas.current?.focus(id);});};
 const control='inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-2 text-sm hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus';
 useEffect(()=>{const media=window.matchMedia('(max-width: 48rem)'),update=()=>setNarrow(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 const detailRead=useWorldGraphDetail(graphStamp&&association?association.item.personalMeaningId:null);
 const currentDetail=graphStamp?detailRead.status.ok&&!detailRead.status.loading&&detailRead.value?.incarnation===graphStamp.incarnation&&detailRead.value.revision===graphStamp.revision?detailRead.value.detail:null:(association?.item as JourneyWorldItemView|undefined)?.detail;
 const sources=(currentDetail?.capturedSources??[]).filter(source=>source.source!==null);
 const contextContent=currentDetail?<>{currentDetail.materialBlocks.filter(block=>block.bodyText).map(block=><p key={block.anchorId} className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{block.bodyText}</p>)}</>:detailRead.status.ok?<p role="status" className="mt-2 text-sm">{localFlowText('loadingSensa')}</p>:<div role="alert" className="mt-2 text-sm"><p>{t('content.loadError')}</p><button type="button" className={control} onClick={detailRead.reload}>{t('content.retry')}</button></div>;

 const detailContent=selected&&association?<>
    <header className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words text-xl font-medium"><bdi lang={selected.languageTag} dir="auto">{selected.label}</bdi></h2><p className="mt-1 text-xs text-fg-secondary">{interfaceLanguageDisplayName(selected.languageTag,locale)}</p></div>{!narrow&&<button type="button" className={control} onClick={close} aria-label={t('content.close')}><X size={18}/></button>}</header>
    {selected.associations.length>1&&<label className="block text-sm">{t('content.graph.sense')}<select className="mt-2 min-h-11 w-full rounded-control border border-border-subtle bg-surface-panel p-2" value={associationKey(association)} onChange={event=>setOwner({expressionId:selected.id,associationId:event.target.value})}>{selected.associations.map(row=><option key={associationKey(row)} value={associationKey(row)}>{row.alignment.coreMeaningFocus} · {row.item.shortId}</option>)}</select></label>}
    <section>{selected.associations.length===1&&<h3 className="text-xs text-fg-secondary">{t('content.graph.sense')}</h3>}<p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{association.alignment.coreMeaningFocus}</p></section>
    <section><h3 className="text-xs text-fg-secondary">{t('content.graph.context')}</h3>{contextContent}</section>
    <details><summary className="min-h-11 cursor-pointer text-sm text-fg-secondary">{t('content.worldSource')}</summary>{!currentDetail?contextContent:sources.length?sources.map(source=>{const url=intakeSourceUrl(source.source!);return <details key={source.anchorId} className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer break-words">{intakeSourceLabel(source.source!)}</summary>{source.text&&<p className="whitespace-pre-wrap break-words leading-6">{source.text}</p>}{url&&<a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center underline">{localFlowText('viewSource')}</a>}</details>}):<p className="mt-2 text-sm">{t('content.worldNoSource')}</p>}</details>
    {learningState&&<section>{learningState(association.bindingVersionId)}</section>}
    <section><h3 className="text-xs text-fg-secondary">{t('content.worldRelated')}</h3>{related.map(edge=>{const other=byId.get(edge.to)!;return <button type="button" key={other.id} className="mt-2 min-h-11 w-full rounded-control py-2 text-left text-sm hover:bg-surface-subtle" onClick={()=>onSelectExpression(other.id)}><b><bdi lang={other.languageTag} dir="auto">{other.label}</bdi></b> · {interfaceLanguageDisplayName(other.languageTag,locale)}<span className="block text-xs">{t(`content.${edge.facts.some(fact=>fact.kind==='sense')?'worldSharedSense':'worldSharedMeaning'}`)}</span></button>;})}{!related.length&&<p className="mt-2 text-sm">{t('content.worldIsolated')}</p>}</section>
    <button type="button" className={`${control} w-full bg-action-primary text-action-on-primary`} disabled={!!graphStamp&&!currentDetail} onClick={()=>onOpenMeaning(association.item.personalMeaningId,association.focusId)}>{t('content.graph.open')}<ArrowUpRight size={16}/></button>
   </>:null;
 return <section className="sensa-meaning-graph" aria-label={t('content.graph.title')} onKeyDown={event=>{if(event.key==='Escape'&&selectedExpressionId){event.stopPropagation();close();}}}>
  <div className="sensa-expression-graph-workspace">
   <div className="sensa-expression-graph-surface relative min-w-0 bg-surface-canvas">
    <MeaningGraphCanvas controller={canvas} graph={graph} screenId={screenId} selected={selected?.id??null} highlight={highlight?.id??null} labels={labels} searching={searching} canvasLabel={t('content.graph.canvas')} nodeLabel={id=>{const node=byId.get(id)!;return `${node.label} · ${node.languageTag} · ${associationFor(node)?.alignment.coreMeaningFocus??''}`;}} onSelect={onSelectExpression} onHover={setHover}/>
    <div className="sensa-graph-tools">
     <details className="sensa-graph-browse" onToggle={event=>setBrowseOpen(event.currentTarget.open)}><summary className={control} aria-label={t('content.graph.browse')} title={t('content.graph.browse')}><List size={18}/></summary><div ref={browseMenu} className="sensa-graph-menu" role="group" aria-label={t('content.graph.browse')}>{browseOpen&&<SensaVirtualList items={graph.nodes} itemKey={node=>node.id} label={t('content.graph.browse')} estimateSize={44} scrollElement={browseScroll} plain renderItem={node=><button key={node.id} type="button" className="min-h-11 w-full px-3 py-2 text-left text-sm" onClick={event=>{event.currentTarget.closest('details')?.removeAttribute('open');canvas.current?.focus(node.id);onSelectExpression(node.id);}}><bdi lang={node.languageTag} dir="auto">{node.label}</bdi><span className="ml-2 text-xs text-fg-secondary">{interfaceLanguageDisplayName(node.languageTag,locale)}</span></button>}/>}</div></details>
     <button type="button" className={control} onClick={()=>canvas.current?.zoom(.8)} aria-label={t('content.graph.zoomOut')}><Minus size={16}/></button>
     <button type="button" className={control} onClick={()=>canvas.current?.zoom(1.25)} aria-label={t('content.graph.zoomIn')}><Plus size={16}/></button>
     <button type="button" className={control} onClick={()=>canvas.current?.fit()} aria-label={t('content.graph.fit')}><Maximize size={16}/></button>
     <details className="sensa-graph-options"><summary className={control} aria-label={t('content.worldLabels')}><Settings2 size={18}/></summary><div className="sensa-graph-menu p-4"><label className="flex items-center justify-between gap-2 text-sm">{t('content.worldLabels')}<select value={labels} onChange={event=>setLabels(event.target.value as typeof labels)} className="min-h-11 rounded-control border border-border-subtle bg-surface-panel px-2">{(['auto','all','selected'] as const).map(value=><option key={value} value={value}>{t(`content.${value==='auto'?'worldLabelAuto':value==='all'?'worldLabelAll':'worldLabelSelected'}`)}</option>)}</select></label><details className="mt-3 text-sm text-fg-secondary"><summary className="min-h-11 cursor-pointer py-3">{t('content.worldHelp')}</summary><p className="leading-6">{t('content.graph.hint')}</p><p className="mt-3 leading-6">{t('content.worldGraphHint')}</p></details></div></details>
    </div>
    {highlight&&highlight.id!==selected?.id&&<div className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-control border border-border-strong bg-surface-panel p-3 shadow-raised" role="status" data-graph-preview>
     <strong className="block break-words"><bdi lang={highlight.languageTag} dir="auto">{highlight.label}</bdi></strong><span className="text-xs">{interfaceLanguageDisplayName(highlight.languageTag,locale)}</span><p className="mt-1 line-clamp-2 break-words text-sm">{highlightAssociation?.alignment.coreMeaningFocus}</p>
    </div>}
   </div>
   {detailContent&&(narrow?<ContentDrawer title={t('content.worldPreview')} onClose={close}><div className="space-y-5">{detailContent}</div></ContentDrawer>:<aside className="sensa-expression-graph-detail space-y-5 border-l border-border-subtle bg-surface-panel p-4" aria-label={t('content.worldPreview')}>{detailContent}</aside>)}
  </div>
 </section>;
}

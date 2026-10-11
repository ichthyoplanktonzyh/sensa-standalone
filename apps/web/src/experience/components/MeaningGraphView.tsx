import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Maximize,Minus,Plus,X,ArrowUpRight} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {JourneyWorldItemView} from '../personalMeaningJourney';
import {buildMeaningGraph,type ExpressionAssociation} from '../ui/meaningGraph';
import {useScreenState} from '../ui/ScreenHost';
import {localFlowText} from '../../i18n/localFlowText';
import {ContentDrawer} from './ContentWorkspace';
import {interfaceLanguageDisplayName} from '../../i18n/languageDisplayName';
import {resolveInterfaceLocale} from '../../i18n/localeRegistry';
import {intakeSourceLabel,intakeSourceUrl} from '../personalMeaningJourney/sourcePresentation';

const associationKey=(row:ExpressionAssociation)=>`${row.item.personalMeaningId}:${row.alignment.personalMeaningAlignmentId}:${row.bindingVersionId}`;

export function MeaningGraphView({items,languages=[],screenId,selectedExpressionId,onSelectExpression,onOpenMeaning,learningState,searching=false}:{
 items:readonly JourneyWorldItemView[];languages?:readonly string[];screenId:string;
 selectedExpressionId:string|null;onSelectExpression:(id:string|null)=>void;
 onOpenMeaning:(id:string,focusId?:string)=>void;
 learningState?:(bindingVersionId:string)=>ReactNode;
 searching?:boolean;
}){
 const {t,i18n}=useTranslation();
 const locale=resolveInterfaceLocale(i18n.resolvedLanguage??i18n.language);
 const graph=useMemo(()=>buildMeaningGraph(items,languages),[items,JSON.stringify(languages)]);
 const [camera,setCamera]=useScreenState(`${screenId}:graph-camera`,{x:24,y:24,zoom:1});
 const [labels,setLabels]=useScreenState<'auto'|'all'|'selected'>(`${screenId}:graph-labels`,'auto');
 const [initialized,setInitialized]=useScreenState(`${screenId}:graph-initialized`,false);
 const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width: 48rem)').matches);
 const [hover,setHover]=useState<string|null>(null);
 const [owner,setOwner]=useScreenState<{expressionId:string;associationId:string}|null>(`${screenId}:graph-interpretation`,null);
 const [size,setSize]=useState({width:1000,height:560}),[measured,setMeasured]=useState(false);
 const svg=useRef<SVGSVGElement>(null),surface=useRef<HTMLDivElement>(null);
 const drag=useRef<{x:number;y:number;originX:number;originY:number}|null>(null);
 const byId=useMemo(()=>new Map(graph.nodes.map(node=>[node.id,node])),[graph]);
 const selected=byId.get(selectedExpressionId??''),highlight=byId.get(hover??'')??selected;
 const adjacent=new Set(graph.edges.filter(edge=>edge.from===highlight?.id||edge.to===highlight?.id).flatMap(edge=>[edge.from,edge.to]));
 const associationFor=(node:typeof graph.nodes[number])=>node.associations.find(row=>owner?.expressionId===node.id&&associationKey(row)===owner.associationId)??node.associations[0];
 const association=selected?associationFor(selected):undefined,highlightAssociation=highlight?associationFor(highlight):undefined;
 const fit=()=>{const zoom=Math.min(1.2,(size.width-60)/graph.width,(size.height-80)/graph.height);setCamera({x:(size.width-graph.width*zoom)/2+25,y:(size.height-graph.height*zoom)/2+20,zoom:Math.max(.04,zoom)});};
 const zoomBy=(factor:number)=>setCamera(current=>{const zoom=Math.max(.04,Math.min(3,current.zoom*factor));return {x:size.width/2-(size.width/2-current.x)*zoom/current.zoom,y:size.height/2-(size.height/2-current.y)*zoom/current.zoom,zoom};});
 useEffect(()=>{const element=surface.current;if(!element)return;const observer=new ResizeObserver(entries=>{const rect=entries[0]?.contentRect;if(rect){setSize({width:Math.max(1,rect.width),height:Math.max(1,rect.height)});setMeasured(true);}});observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(measured&&!initialized){fit();setInitialized(true);}},[measured,initialized,size.width,size.height]);
 useEffect(()=>{const element=svg.current;if(!element)return;const wheel=(event:WheelEvent)=>{event.preventDefault();zoomBy(event.deltaY>0?.9:1.1);};element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);},[size.width,size.height]);
 const close=()=>{const id=selectedExpressionId;onSelectExpression(null);setHover(null);requestAnimationFrame(()=>{if(id)svg.current?.querySelector<SVGGElement>(`[data-expression-id="${id}"]`)?.focus();});};
 const control='inline-flex min-h-11 min-w-11 items-center justify-center rounded-control px-2 text-sm hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus';
 useEffect(()=>{const media=window.matchMedia('(max-width: 48rem)'),update=()=>setNarrow(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
 const sources=(association?.item.detail.capturedSources??[]).filter(source=>source.source!==null);
 const detailContent=selected&&association?<>
    <header className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words text-xl font-medium"><bdi lang={selected.languageTag} dir="auto">{selected.label}</bdi></h2><p className="mt-1 text-xs text-fg-secondary">{interfaceLanguageDisplayName(selected.languageTag,locale)}</p></div>{!narrow&&<button type="button" className={control} onClick={close} aria-label={t('content.close')}><X size={18}/></button>}</header>
    {selected.associations.length>1&&<label className="block text-sm">{t('content.graph.sense')}<select className="mt-2 min-h-11 w-full rounded-control border border-border-subtle bg-surface-panel p-2" value={associationKey(association)} onChange={event=>setOwner({expressionId:selected.id,associationId:event.target.value})}>{selected.associations.map(row=><option key={associationKey(row)} value={associationKey(row)}>{row.alignment.coreMeaningFocus} · {row.item.shortId}</option>)}</select></label>}
    <section><h3 className="text-xs text-fg-secondary">{t('content.graph.sense')}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{association.alignment.coreMeaningFocus}</p></section>
    <section><h3 className="text-xs text-fg-secondary">{t('content.graph.context')}</h3>{association.item.detail.materialBlocks.filter(block=>block.bodyText).map(block=><p key={block.anchorId} className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{block.bodyText}</p>)}</section>
    <details><summary className="min-h-11 cursor-pointer text-sm text-fg-secondary">{t('content.worldSource')}</summary>{sources.length?sources.map(source=>{const url=intakeSourceUrl(source.source!);return <details key={source.anchorId} className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer break-words">{intakeSourceLabel(source.source!)}</summary>{source.text&&<p className="whitespace-pre-wrap break-words leading-6">{source.text}</p>}{url&&<a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-11 items-center underline">{localFlowText('viewSource')}</a>}</details>}):<p className="mt-2 text-sm">{t('content.worldNoSource')}</p>}</details>
    {learningState&&<section>{learningState(association.bindingVersionId)}</section>}
    <section><h3 className="text-xs text-fg-secondary">{t('content.worldRelated')}</h3>{graph.edges.filter(edge=>edge.from===selected.id||edge.to===selected.id).map(edge=>{const other=byId.get(edge.from===selected.id?edge.to:edge.from)!;return <button type="button" key={other.id} className="mt-2 min-h-11 w-full rounded-control border border-border-subtle p-2 text-left text-sm" onClick={()=>onSelectExpression(other.id)}><b><bdi lang={other.languageTag} dir="auto">{other.label}</bdi></b> · {interfaceLanguageDisplayName(other.languageTag,locale)}<span className="block text-xs">{edge.facts.map(fact=>t(`content.${fact.kind==='sense'?'worldSharedSense':'worldSharedMeaning'}`)).join(' · ')}</span></button>;})}{!graph.edges.some(edge=>edge.from===selected.id||edge.to===selected.id)&&<p className="mt-2 text-sm">{t('content.worldIsolated')}</p>}</section>
    <button type="button" className={`${control} w-full bg-action-primary text-action-on-primary`} onClick={()=>onOpenMeaning(association.item.personalMeaningId,association.focusId)}>{t('content.graph.open')}<ArrowUpRight size={16}/></button>
   </>:null;
 return <section className="sensa-meaning-graph overflow-hidden rounded-card border border-border-subtle bg-surface-panel" aria-label={t('content.graph.title')} onKeyDown={event=>{if(event.key==='Escape'&&selectedExpressionId){event.stopPropagation();close();}}}>
  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle p-2">
   <details className="sensa-graph-help min-w-0 text-sm"><summary className="min-h-11 cursor-pointer py-3 text-fg-secondary">{t('content.worldHelp')}</summary><p className="max-w-lg py-2 leading-6 text-fg-secondary">{t('content.graph.hint')}</p><p className="max-w-lg pb-3 leading-6 text-fg-secondary">{t('content.worldGraphHint')}</p></details>
   <div className="flex flex-wrap items-center gap-1">
    <label className="flex items-center gap-2 text-xs">{t('content.worldLabels')}<select value={labels} onChange={event=>setLabels(event.target.value as typeof labels)} className="min-h-11 rounded-control border border-border-subtle bg-surface-panel px-2">
     {(['auto','all','selected'] as const).map(value=><option key={value} value={value}>{t(`content.${value==='auto'?'worldLabelAuto':value==='all'?'worldLabelAll':'worldLabelSelected'}`)}</option>)}
    </select></label>
    <button type="button" className={control} onClick={()=>zoomBy(.8)} aria-label={t('content.graph.zoomOut')}><Minus size={16}/></button>
    <output className="w-12 text-center text-xs tabular-nums" aria-label={t('content.graph.zoom')}>{new Intl.NumberFormat(i18n.language,{style:'percent',maximumFractionDigits:0}).format(camera.zoom)}</output>
    <button type="button" className={control} onClick={()=>zoomBy(1.25)} aria-label={t('content.graph.zoomIn')}><Plus size={16}/></button>
    <button type="button" className={control} onClick={fit} aria-label={t('content.graph.fit')}><Maximize size={16}/></button>
   </div>
  </header>
  <div className="sensa-expression-graph-workspace">
   <div ref={surface} className="sensa-expression-graph-surface relative min-w-0 bg-surface-canvas">
    <svg ref={svg} viewBox={`0 0 ${size.width} ${size.height}`} className="h-full w-full touch-none select-none" aria-label={t('content.graph.canvas')} data-graph-camera={JSON.stringify(camera)}
     onPointerDown={event=>{if((event.target as Element).closest('[data-expression-id]'))return;event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,originX:camera.x,originY:camera.y};}}
     onPointerMove={event=>{const start=drag.current;if(start)setCamera(current=>({...current,x:start.originX+event.clientX-start.x,y:start.originY+event.clientY-start.y}));}}
     onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
     <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
      {graph.edges.map(edge=>{const a=byId.get(edge.from)!,b=byId.get(edge.to)!,active=highlight&&(edge.from===highlight.id||edge.to===highlight.id);return <line key={`${edge.from}:${edge.to}`} data-graph-edge={`${edge.from}:${edge.to}`} data-relation-facts={JSON.stringify(edge.facts)} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active?'var(--sensa-fg-primary)':'var(--sensa-border-strong)'} strokeWidth={active?2.5:1} vectorEffect="non-scaling-stroke"/>;})}
      {graph.nodes.map(node=>{const active=node.id===selected?.id||node.id===highlight?.id,related=adjacent.has(node.id),showLabel=active||searching||labels==='all'||labels==='auto'&&camera.zoom>=.65;return <g key={node.id} data-expression-id={node.id} transform={`translate(${node.x} ${node.y})`} role="button" tabIndex={0} aria-label={`${node.label} · ${node.languageTag} · ${associationFor(node)?.alignment.coreMeaningFocus??''}`} aria-pressed={selected?.id===node.id}
       className="sensa-expression-point cursor-pointer outline-none" onClick={()=>onSelectExpression(node.id)} onFocus={()=>setHover(node.id)} onBlur={()=>setHover(null)} onPointerEnter={event=>{if(event.pointerType!=='touch')setHover(node.id);}} onPointerLeave={()=>setHover(null)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelectExpression(node.id);}}}>
       <circle r={22/camera.zoom} fill="transparent"/>
       <circle className="sensa-expression-dot" r={(active?9:related?7:5)/camera.zoom} fill={active?'var(--sensa-action-primary)':'var(--sensa-fg-secondary)'} stroke="var(--sensa-surface-canvas)" strokeWidth={2/camera.zoom}/>
       {active&&<circle r={13/camera.zoom} fill="none" stroke="var(--sensa-fg-primary)" strokeWidth={1.5/camera.zoom}/>}
       {showLabel&&<text x={15/camera.zoom} y={4/camera.zoom} fontSize={12/camera.zoom} fill="var(--sensa-fg-primary)" paintOrder="stroke" stroke="var(--sensa-surface-canvas)" strokeWidth={4/camera.zoom}>{node.label.length>22?`${node.label.slice(0,21)}…`:node.label}</text>}
      </g>;})}
     </g>
    </svg>
    {highlight&&highlight.id!==selected?.id&&<div className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-control border border-border-strong bg-surface-panel p-3 shadow-raised" role="status" data-graph-preview>
     <strong className="block break-words"><bdi lang={highlight.languageTag} dir="auto">{highlight.label}</bdi></strong><span className="text-xs">{interfaceLanguageDisplayName(highlight.languageTag,locale)}</span><p className="mt-1 line-clamp-2 break-words text-sm">{highlightAssociation?.alignment.coreMeaningFocus}</p>
    </div>}
   </div>
   {detailContent&&(narrow?<ContentDrawer title={t('content.worldPreview')} onClose={close}><div className="space-y-5">{detailContent}</div></ContentDrawer>:<aside className="sensa-expression-graph-detail space-y-5 border-l border-border-subtle bg-surface-panel p-4" aria-label={t('content.worldPreview')}>{detailContent}</aside>)}
  </div>
 </section>;
}

import {useCallback,useEffect,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {observeLibrary} from '../../data/library/store';
import {worldReadRepository} from '../personalMeaningJourney/worldRepository';
import {sameMeaningGraphModel} from '../ui/meaningGraph';
import {MeaningGraphCanvas,type GraphCanvasProps,type GraphCanvasHandle} from './MeaningGraphCanvas';

type Graph=GraphCanvasProps['graph'];
type Full={graph:Graph;key:string;labels:GraphCanvasProps['labels'];parked:boolean};
type Props=Omit<GraphCanvasProps,'nodeLabel'>&{full:boolean;verified:boolean;frameKey:string|null;nodeLabel:(node:Graph['nodes'][number])=>string};

/** One completed full graph and one current filter, owned by this World only.
 * A fresh read always precedes reuse; render equality never admits domain data. */
export function MeaningGraphCanvases(props:Props){
 const [saved,setSaved]=useState<{full:Full|null;serial:number;owner:number;generation:number;blocked:WeakRef<Graph>|null}>({full:null,serial:0,owner:0,generation:0,blocked:null});
 const committedGraph=useRef(props.graph);
 useLayoutEffect(()=>{committedGraph.current=props.graph;});
 const verified=props.verified&&props.graph!==saved.blocked?.deref();
 if(saved.blocked&&props.verified&&props.graph!==saved.blocked.deref())setSaved({...saved,blocked:null});
 const fullCanvas=useRef<GraphCanvasHandle>(null),filteredCanvas=useRef<GraphCanvasHandle>(null);
 const [fullReady,setFullReady]=useState<{token:symbol;ready:boolean}|null>(null),[filteredReady,setFilteredReady]=useState<{token:symbol;ready:boolean}|null>(null);
 const equal=useMemo(()=>!!saved.full&&sameMeaningGraphModel(saved.full.graph,props.graph),[saved.full?.graph,props.graph]);
 if(saved.full){
  const invalid=!props.frameKey||saved.full.key!==props.frameKey||saved.full.labels!==props.labels;
  if(invalid||props.full&&verified&&!equal)setSaved({...saved,full:null,serial:saved.serial+(saved.full.parked?1:0),generation:saved.generation+1});
  else if(!props.full&&!saved.full.parked)setSaved({...saved,full:{...saved.full,parked:true}});
  else if(props.full&&verified&&saved.full.parked)setSaved({...saved,full:{...saved.full,parked:false}});
 }
 const fullGraph=props.full?(verified?(equal?saved.full!.graph:props.graph):saved.full?.graph??props.graph):saved.full?.graph;
 const fullToken=useMemo(()=>Symbol(),[fullGraph,saved.owner,saved.serial]),filteredToken=useMemo(()=>Symbol(),[props.graph,saved.owner]);
 const fullReadyChanged=useCallback((ready:boolean)=>{
  if(!fullGraph)return;
  setFullReady(prior=>prior?.token===fullToken&&prior.ready===ready?prior:{token:fullToken,ready});
  if(ready&&props.full&&verified&&props.frameKey)setSaved(prior=>prior.owner!==saved.owner||prior.serial!==saved.serial||prior.generation!==saved.generation?prior:prior.full?.graph===fullGraph&&prior.full.key===props.frameKey&&prior.full.labels===props.labels&&!prior.full.parked?prior:{...prior,full:{graph:fullGraph,key:props.frameKey!,labels:props.labels,parked:false}});
 },[fullGraph,fullToken,props.full,verified,props.frameKey,props.labels,saved.owner,saved.serial,saved.generation]);
 const filteredReadyChanged=useCallback((ready:boolean)=>setFilteredReady(prior=>prior?.token===filteredToken&&prior.ready===ready?prior:{token:filteredToken,ready}),[filteredToken]);
 const ready=verified&&(props.full?fullReady?.token===fullToken&&fullReady.ready:filteredReady?.token===filteredToken&&filteredReady.ready);
 useLayoutEffect(()=>{props.onReady(!!ready);},[ready,props.onReady]);
 useEffect(()=>{
  if(!props.frameKey)return;
  const invalidate=()=>setSaved(prior=>({...prior,full:null,serial:prior.serial+(prior.full?.parked?1:0),generation:prior.generation+1}));
  const appearanceChanged=()=>setSaved(prior=>prior.full?.parked?{...prior,full:null,serial:prior.serial+1,generation:prior.generation+1}:prior);
  const appearance=()=>JSON.stringify([...document.documentElement.attributes].map(({name,value})=>[name,value]));
  let priorAppearance=appearance();
  const stop=worldReadRepository.subscribe(invalidate),theme=new MutationObserver(()=>{const next=appearance();if(next!==priorAppearance){priorAppearance=next;appearanceChanged();}});
  theme.observe(document.documentElement,{attributes:true});
  document.fonts?.addEventListener('loadingdone',appearanceChanged);
  const owner=observeLibrary(()=>setSaved(prior=>({full:null,serial:prior.serial+1,owner:prior.owner+1,generation:prior.generation+1,blocked:new WeakRef(committedGraph.current)})),['meta'],{meta:['identity','local-incarnation','service-owner']});
  return()=>{stop();owner();theme.disconnect();document.fonts?.removeEventListener('loadingdone',appearanceChanged);};
 },[!!props.frameKey]);
 useImperativeHandle(props.controller,()=>({fit:()=>{(props.full?fullCanvas:filteredCanvas).current?.fit();},zoom:factor=>{(props.full?fullCanvas:filteredCanvas).current?.zoom(factor);},focus:id=>{(props.full?fullCanvas:filteredCanvas).current?.focus(id);}}),[props.full]);
 return <>
  {fullGraph&&<div key={`full:${saved.owner}:${saved.serial}`} className="absolute inset-0" data-graph-current={props.full?'true':'false'} hidden={!props.full||!verified} aria-hidden={!props.full||!verified} inert={!props.full||!verified||props.active===false}>
   <MeaningGraphCanvas {...props} active={props.active!==false&&props.full&&verified} graph={fullGraph} screenId={`${props.screenId}:full`} nodeLabel={id=>props.nodeLabel(fullGraph.byId.get(id)!)} controller={fullCanvas} onReady={fullReadyChanged}/>
  </div>}
  {!props.full&&<div key={`filtered:${saved.owner}`} className="absolute inset-0" data-graph-current="true" hidden={!verified}>
   <MeaningGraphCanvas {...props} active={props.active!==false&&verified} screenId={`${props.screenId}:filtered`} nodeLabel={id=>props.nodeLabel(props.graph.byId.get(id)!)} controller={filteredCanvas} onReady={filteredReadyChanged}/>
  </div>}
 </>;
}

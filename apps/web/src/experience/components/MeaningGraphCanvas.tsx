import {useEffect,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState,type Ref} from 'react';
import cytoscape,{type Core,type NodeSingular,type StylesheetJson} from 'cytoscape';
import {useScreenState} from '../ui/ScreenHost';
import {type buildMeaningGraph} from '../ui/meaningGraph';
import {applyMeaningGraphEmphasis,meaningGraphEmphasisStyles,type MeaningGraphEmphasis} from '../ui/meaningGraphEmphasis';
import {partitionMeaningGraph,meaningGraphKeyboardPositions,meaningGraphPresetLayout} from '../ui/meaningGraphCanvasModel';

type Graph=ReturnType<typeof buildMeaningGraph>;
type Camera={x:number;y:number;zoom:number};
type Position={id:string;x:number;y:number};
export type GraphCanvasHandle={fit:()=>void;zoom:(factor:number)=>void;focus:(id:string)=>void};
type Props={graph:Graph;screenId:string;selected:string|null;highlight:string|null;labels:'auto'|'all'|'selected';searching:boolean;canvasLabel:string;nodeLabel:(id:string)=>string;onSelect:(id:string)=>void;onHover:(id:string|null)=>void;controller:Ref<GraphCanvasHandle>};
const offsetForIsolates=(cy:Core)=>Math.max(0,...cy.nodes().filter(node=>node.degree()>0).map(node=>(node as NodeSingular).position('y')));
const roles=['--sensa-fg-primary','--sensa-fg-secondary','--sensa-surface-canvas','--sensa-action-primary','--sensa-focus','--sensa-border-strong'] as const;

/** Cytoscape owns drawing, layouts, hit testing and touch gestures. DOM entries
 * provide the keyboard/reader equivalent; neither layer writes learning facts. */
export function MeaningGraphCanvas(props:Props){
 const container=useRef<HTMLDivElement>(null),engine=useRef<Core|null>(null),current=useRef(props);current.current=props;
 const signature=useMemo(()=>props.graph.nodes.map(node=>node.id).join('|')+'#'+props.graph.edges.map(edge=>`${edge.from}:${edge.to}`).join('|'),[props.graph]);
 const [camera,setCamera]=useScreenState<Camera|null>(`${props.screenId}:cy-camera`,null);
 const [layout,setLayout]=useScreenState<{signature:string;positions:Position[];width:number;height:number}|null>(`${props.screenId}:cy-layout`,null);
 const [focused,setFocused]=useState<string|null>(null);
 const focusedId=focused&&props.graph.byId.has(focused)?focused:props.selected&&props.graph.byId.has(props.selected)?props.selected:props.graph.nodes[0]?.id;
 const focusedIndex=props.graph.order.get(focusedId??'')??0;
 const keyboardNodes=useMemo(()=>{
  if(props.graph.nodes.length<=160)return props.graph.nodes;
  const nodes=props.graph.nodes.slice(Math.max(0,focusedIndex-32),focusedIndex+33),selected=props.graph.byId.get(props.selected??'');
  if(selected&&!nodes.some(node=>node.id===selected.id))nodes.push(selected);
  return nodes.sort((a,b)=>props.graph.order.get(a.id)!-props.graph.order.get(b.id)!);
 },[props.graph,props.selected,focusedIndex]);
 const positionsById=meaningGraphKeyboardPositions(engine.current,keyboardNodes);
 const pendingFocus=useRef<string|null>(null);
 useLayoutEffect(()=>{const id=pendingFocus.current;if(id){pendingFocus.current=null;container.current?.querySelector<HTMLButtonElement>(`[data-expression-id="${id}"]`)?.focus();}},[focused]);
 const requestFocus=(id:string)=>{const button=container.current?.querySelector<HTMLButtonElement>(`[data-expression-id="${id}"]`);if(button)button.focus();else{pendingFocus.current=id;setFocused(id);}};
 const cameraRef=useRef(camera);cameraRef.current=camera;
 const style=():StylesheetJson=>{
  const colors=roles.map(role=>getComputedStyle(container.current!.querySelector(`[data-palette="${role}"]`)! as Element).color);
  return [
   {selector:'node',style:{width:18,height:18,'background-color':colors[1],label:'data(label)','font-family':getComputedStyle(container.current!).fontFamily,'font-size':14,'text-valign':'bottom','text-margin-y':9,'text-max-width':'132px','text-wrap':'ellipsis','min-zoomed-font-size':10,color:colors[0],'text-background-color':colors[2],'text-background-opacity':.9,'text-background-padding':'3px','border-color':colors[2],'border-width':2}},
   {selector:'edge',style:{width:2,'line-color':colors[5],'curve-style':'bezier'}},
   {selector:'node.linked',style:{'background-color':colors[3]}},
   ...meaningGraphEmphasisStyles(colors[3]!,colors[4]!),
   {selector:'node.label-hidden',style:{'text-opacity':0}},
   {selector:'node.labels-all',style:{'min-zoomed-font-size':0}},
  ];
 };
 const publish=()=>{
  const cy=engine.current;if(!cy)return;const pan=cy.pan(),next={x:pan.x,y:pan.y,zoom:cy.zoom()};
  cameraRef.current=next;setCamera(next);
 };
 useEffect(()=>{
  const root=container.current;if(!root)return;
  delete root.dataset.graphReady;
  const started=performance.now(),linkedIds=new Set(props.graph.edges.flatMap(edge=>[edge.from,edge.to]));
  const cy=cytoscape({container:root.querySelector('[data-cy-surface]') as HTMLElement,elements:[
   ...props.graph.nodes.map(node=>({data:{id:node.id,label:node.label},position:{x:node.x,y:node.y},classes:linkedIds.has(node.id)?'linked':''})),
   ...props.graph.edges.map((edge,index)=>({data:{id:`relation-${index}`,source:edge.from,target:edge.to}}))],style:style(),layout:meaningGraphPresetLayout,minZoom:.12,maxZoom:2.5,wheelSensitivity:.18,autoungrabify:true,boxSelectionEnabled:false,selectionType:'single'});
  engine.current=cy;
  root.dataset.graphNodeCount=String(cy.nodes().length);root.dataset.graphEdgeCount=String(cy.edges().length);
  let painted=false,paintFrame=0;
  cy.on('render',()=>{if(painted)return;painted=true;paintFrame=requestAnimationFrame(()=>{if(engine.current===cy){root.dataset.graphReady='true';if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.first-renderer-frame',{start:started,end:performance.now()});}});});

  if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.engine',{start:started,end:performance.now()});
  const layoutStarted=performance.now();
  let partition:ReturnType<typeof partitionMeaningGraph>|null=null;
  const components=()=>{
   if(!partition){const start=performance.now();partition=partitionMeaningGraph(cy);if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.components',{start,end:performance.now()});}
   return partition;
  };
  const cached=layout?.signature===signature;
  let width=root.clientWidth,height=root.clientHeight;
  if(layout?.signature===signature){const saved=new Map(layout.positions.map(position=>[position.id,position]));cy.nodes().positions(node=>saved.get(node.id())??node.position());}
  else {
   cy.batch(()=>{
   let offset=0;
   const linked=components().linked,linkedStarted=performance.now();
   for(const component of linked){
    component.layout({name:'breadthfirst',animate:false,fit:false,directed:false,roots:[component.nodes().sort((a,b)=>b.degree()-a.degree()).first().id()],nodeDimensionsIncludeLabels:true,spacingFactor:1.15,boundingBox:{x1:20,y1:offset+20,w:Math.max(300,Math.min(root.clientWidth-40,620)),h:220}}).run();
    const bounds=component.boundingBox({includeLabels:false}),scale=component.nodes().length<=3?Math.min(1,Math.max(160,root.clientWidth-160)/bounds.w):1;
    component.nodes().positions(node=>({x:80+(node.position('x')-bounds.x1)*scale,y:60+offset+node.position('y')-bounds.y1}));offset+=bounds.h+75;
   }
   if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.linked-layout',{start:linkedStarted,end:performance.now()});
   });
  }
  if(layout?.signature===signature&&cameraRef.current)cy.viewport({zoom:cameraRef.current.zoom,pan:{x:cameraRef.current.x,y:cameraRef.current.y}});
  else {cy.zoom(1);cy.pan({x:15,y:10});}
  const arrangeForViewport=()=>{
   cy.batch(()=>{
    const arrangeStarted=performance.now();
    for(const component of components().linked.filter(group=>group.nodes().length<=3)){
     const xs=component.nodes().map(node=>node.position('x')),min=Math.min(...xs),span=Math.max(...xs)-min;
     if(span>0){const width=Math.min(300,Math.max(120,root.clientWidth-160));component.nodes().positions(node=>({x:80+(node.position('x')-min)*width/span,y:node.position('y')}));}
    }
    if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.component-viewport',{start:arrangeStarted,end:performance.now()});
    const isolated=components().isolated,linked=cy.edges().length>0,right=linked&&window.matchMedia('(min-width: 48rem)').matches;
    const x=right?440:10,y=right?60:linked?offsetForIsolates(cy)+75:25;
    const cols=Math.max(1,Math.min(isolated.length,right?Math.max(2,Math.floor((root.clientWidth-440)/155)):Math.max(1,Math.floor((root.clientWidth-20)/155))));
    const gridStarted=performance.now();
    if(isolated.length)isolated.layout({name:'grid',fit:false,avoidOverlap:true,cols,boundingBox:{x1:x,y1:y,w:cols*155,h:Math.ceil(isolated.length/cols)*105},sort:(a,b)=>a.data('label').localeCompare(b.data('label'))||a.id().localeCompare(b.id())}).run();
    if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.isolate-grid',{start:gridStarted,end:performance.now()});
   });
  };
  const saveLayout=()=>setLayout({signature,positions:cy.nodes().map(node=>({id:node.id(),...node.position()})),width:root.clientWidth,height:root.clientHeight});
  if(!cached||layout.width!==width||layout.height!==height){arrangeForViewport();saveLayout();}
  if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.layout',{start:layoutStarted,end:performance.now()});
  cy.on('tap','node',event=>current.current.onSelect(event.target.id()));
  cy.on('mouseover','node',event=>current.current.onHover(event.target.id()));
  cy.on('mouseout','node',()=>current.current.onHover(null));
  cy.on('pan zoom',publish);
  const observer=new ResizeObserver(()=>{const nextWidth=root.clientWidth,nextHeight=root.clientHeight;if(nextWidth===width&&nextHeight===height)return;width=nextWidth;height=nextHeight;cy.resize();arrangeForViewport();saveLayout();publish();});observer.observe(root);
  const theme=new MutationObserver(()=>{cy.style(style());});theme.observe(document.documentElement,{attributes:true});
  publish();
  return()=>{cancelAnimationFrame(paintFrame);delete root.dataset.graphReady;observer.disconnect();theme.disconnect();cy.destroy();engine.current=null;};
 },[signature]);
 // Model text changes independently of transient pointer/selection state.
 useEffect(()=>{
  const cy=engine.current;if(!cy)return;
  cy.batch(()=>{for(const node of props.graph.nodes){const element=cy.getElementById(node.id);if(element.data('label')!==node.label)element.data('label',node.label);}});
 },[props.graph,signature]);
 const emphasis=useRef<MeaningGraphEmphasis|null>(null);
 useEffect(()=>{
  const cy=engine.current;if(!cy)return;
  emphasis.current=applyMeaningGraphEmphasis(cy,props.graph,{id:props.highlight??props.selected,labels:props.labels,searching:props.searching},emphasis.current);
 },[props.selected,props.highlight,props.labels,props.searching,signature,props.graph]);

 const focusNode=(id:string)=>{
  const cy=engine.current,node=cy?.getElementById(id);if(!cy||!node?.length)return;
  const point=node.renderedPosition();if(point.x<35||point.x>cy.width()-35||point.y<35||point.y>cy.height()-60){if(cy.zoom()<.65)cy.zoom(1);cy.center(node);publish();}
  setFocused(id);props.onHover(id);
 };
 useImperativeHandle(props.controller,()=>({fit:()=>{engine.current?.fit(undefined,45);publish();},zoom:factor=>{const cy=engine.current;if(cy)cy.zoom({level:Math.max(cy.minZoom(),Math.min(cy.maxZoom(),cy.zoom()*factor)),renderedPosition:{x:cy.width()/2,y:cy.height()/2}});publish();},focus:requestFocus}));
 return <div ref={container} className="sensa-cy-container" data-graph-camera={JSON.stringify(camera)} aria-label={props.canvasLabel}>
  <div hidden aria-hidden="true">{roles.map(role=><i key={role} data-palette={role} style={{color:`var(${role})`}}/>)}</div>
  <div data-cy-surface className="sensa-cy-surface" aria-hidden="true"/>
  <div className="sensa-graph-keyboard-nodes" role="list" aria-label={props.canvasLabel}>{keyboardNodes.map(node=>{
   const index=props.graph.order.get(node.id)!;
   const position=positionsById.get(node.id);
   return <span key={node.id} role="listitem" aria-posinset={index+1} aria-setsize={props.graph.nodes.length}><button type="button" data-expression-id={node.id} data-graph-position={position?JSON.stringify(position):undefined} aria-label={props.nodeLabel(node.id)} aria-pressed={props.selected===node.id} tabIndex={node.id===focusedId?0:-1} onFocus={()=>focusNode(node.id)} onBlur={()=>props.onHover(null)} onClick={()=>props.onSelect(node.id)} onKeyDown={event=>{
    const next=event.key==='Home'?0:event.key==='End'?props.graph.nodes.length-1:['ArrowDown','ArrowRight'].includes(event.key)?Math.min(props.graph.nodes.length-1,index+1):['ArrowUp','ArrowLeft'].includes(event.key)?Math.max(0,index-1):null;
    if(next!==null){event.preventDefault();requestFocus(props.graph.nodes[next]!.id);}
   }}><bdi lang={node.languageTag} dir="auto">{node.label}</bdi></button></span>;
  })}</div>
  <div hidden aria-hidden="true">{props.graph.edges.map(edge=><span key={`${edge.from}:${edge.to}`} data-graph-edge={`${edge.from}:${edge.to}`} data-relation-facts={JSON.stringify(edge.facts)}/>)}</div>
 </div>;
}

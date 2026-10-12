import {useEffect,useImperativeHandle,useLayoutEffect,useMemo,useRef,useState,type Ref} from 'react';
import cytoscape,{type Core,type NodeSingular,type StylesheetJson} from 'cytoscape';
import {useScreenState} from '../ui/ScreenHost';
import {relatedMeaningExpressions,type buildMeaningGraph} from '../ui/meaningGraph';

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
 const signature=props.graph.nodes.map(node=>node.id).join('|')+'#'+props.graph.edges.map(edge=>`${edge.from}:${edge.to}`).join('|');
 const [camera,setCamera]=useScreenState<Camera|null>(`${props.screenId}:cy-camera`,null);
 const [layout,setLayout]=useScreenState<{signature:string;positions:Position[]}|null>(`${props.screenId}:cy-layout`,null);
 const [positions,setPositions]=useState<Position[]>([]),[focused,setFocused]=useState<string|null>(null);
 const positionsById=useMemo(()=>new Map(positions.map(position=>[position.id,position])),[positions]);
 const focusedId=focused&&props.graph.byId.has(focused)?focused:props.selected&&props.graph.byId.has(props.selected)?props.selected:props.graph.nodes[0]?.id;
 const focusedIndex=props.graph.order.get(focusedId??'')??0;
 const keyboardNodes=useMemo(()=>{
  if(props.graph.nodes.length<=160)return props.graph.nodes;
  const nodes=props.graph.nodes.slice(Math.max(0,focusedIndex-32),focusedIndex+33),selected=props.graph.byId.get(props.selected??'');
  if(selected&&!nodes.some(node=>node.id===selected.id))nodes.push(selected);
  return nodes.sort((a,b)=>props.graph.order.get(a.id)!-props.graph.order.get(b.id)!);
 },[props.graph,props.selected,focusedIndex]);
 const pendingFocus=useRef<string|null>(null);
 useLayoutEffect(()=>{const id=pendingFocus.current;if(id){pendingFocus.current=null;container.current?.querySelector<HTMLButtonElement>(`[data-expression-id="${id}"]`)?.focus();}},[focused]);
 const requestFocus=(id:string)=>{const button=container.current?.querySelector<HTMLButtonElement>(`[data-expression-id="${id}"]`);if(button)button.focus();else{pendingFocus.current=id;setFocused(id);}};
 const cameraRef=useRef(camera);cameraRef.current=camera;
 const style=():StylesheetJson=>{
  const colors=roles.map(role=>getComputedStyle(container.current!.querySelector(`[data-palette="${role}"]`)! as Element).color);
  return [
   {selector:'node',style:{width:18,height:18,'background-color':colors[1],label:'data(label)','font-family':getComputedStyle(container.current!).fontFamily,'font-size':14,'text-valign':'bottom','text-margin-y':9,'text-max-width':'132px','text-wrap':'ellipsis','min-zoomed-font-size':10,color:colors[0],'text-background-color':colors[2],'text-background-opacity':.9,'text-background-padding':'3px','border-color':colors[2],'border-width':2}},
   {selector:'edge',style:{width:2,'line-color':colors[5],'curve-style':'bezier',opacity:.75}},
   {selector:'node.linked',style:{'background-color':colors[3]}},
   {selector:'node.active',style:{width:24,height:24,'background-color':colors[3],'border-color':colors[4],'border-width':3,'font-weight':'bold','z-index':10,'min-zoomed-font-size':0}},
   {selector:'node.adjacent',style:{width:22,height:22,'background-color':colors[3],'min-zoomed-font-size':0}},
   {selector:'edge.active',style:{width:3,'line-color':colors[3],opacity:1,'z-index':5}},
   {selector:'node.quiet',style:{opacity:.3,'text-opacity':.3}},
   {selector:'node.label-hidden',style:{'text-opacity':0}},
   {selector:'node.labels-all',style:{'min-zoomed-font-size':0}},
  ];
 };
 const publish=()=>{
  const cy=engine.current;if(!cy)return;const pan=cy.pan(),next={x:pan.x,y:pan.y,zoom:cy.zoom()};
  setCamera(old=>old&&old.x===next.x&&old.y===next.y&&old.zoom===next.zoom?old:next);
  setPositions(cy.nodes().map(node=>({id:node.id(),...node.renderedPosition()})));
 };
 useEffect(()=>{
  const root=container.current;if(!root)return;
  delete root.dataset.graphReady;
  const started=performance.now(),linkedIds=new Set(props.graph.edges.flatMap(edge=>[edge.from,edge.to]));
  const cy=cytoscape({container:root.querySelector('[data-cy-surface]') as HTMLElement,elements:[
   ...props.graph.nodes.map(node=>({data:{id:node.id,label:node.label},position:{x:node.x,y:node.y},classes:linkedIds.has(node.id)?'linked':''})),
   ...props.graph.edges.map((edge,index)=>({data:{id:`relation-${index}`,source:edge.from,target:edge.to}}))],style:style(),layout:{name:'preset'},minZoom:.12,maxZoom:2.5,wheelSensitivity:.18,autoungrabify:true,boxSelectionEnabled:false,selectionType:'single'});
  engine.current=cy;
  root.dataset.graphNodeCount=String(cy.nodes().length);root.dataset.graphEdgeCount=String(cy.edges().length);
  let painted=false,paintFrame=0;
  cy.on('render',()=>{if(painted)return;painted=true;paintFrame=requestAnimationFrame(()=>{if(engine.current===cy){root.dataset.graphReady='true';if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.first-renderer-frame',{start:started,end:performance.now()});}});});

  if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.engine',{start:started,end:performance.now()});
  const layoutStarted=performance.now();
  // Isolates use grid below. components() runs BFS for each singleton, and
  // each BFS groups the whole input. Keep the original linked-node order.
  const components=cy.nodes('.linked').union(cy.edges()).components();
  if(layout?.signature===signature){const saved=new Map(layout.positions.map(position=>[position.id,position]));cy.nodes().positions(node=>saved.get(node.id())??node.position());}
  else {
   let offset=0;
   for(const component of components){
    component.layout({name:'breadthfirst',animate:false,fit:false,directed:false,roots:[component.nodes().sort((a,b)=>b.degree()-a.degree()).first().id()],nodeDimensionsIncludeLabels:true,spacingFactor:1.15,boundingBox:{x1:20,y1:offset+20,w:Math.max(300,Math.min(root.clientWidth-40,620)),h:220}}).run();
    const bounds=component.boundingBox({includeLabels:false}),scale=component.nodes().length<=3?Math.min(1,Math.max(160,root.clientWidth-160)/bounds.w):1;
    component.nodes().positions(node=>({x:80+(node.position('x')-bounds.x1)*scale,y:60+offset+node.position('y')-bounds.y1}));offset+=bounds.h+75;
   }
   const isolated=cy.nodes().filter(node=>node.degree()===0),cols=Math.min(6,Math.max(1,isolated.length));
   if(isolated.length)isolated.layout({name:'grid',fit:false,avoidOverlap:true,cols,boundingBox:{x1:20,y1:offset+25,w:cols*155,h:Math.ceil(isolated.length/cols)*105},sort:(a,b)=>a.data('label').localeCompare(b.data('label'))||a.id().localeCompare(b.id())}).run();
   setLayout({signature,positions:cy.nodes().map(node=>({id:node.id(),...node.position()}))});
  }
  if(layout?.signature===signature&&cameraRef.current)cy.viewport({zoom:cameraRef.current.zoom,pan:{x:cameraRef.current.x,y:cameraRef.current.y}});
  else {cy.zoom(1);cy.pan({x:15,y:10});}
  const arrangeForViewport=()=>{
   cy.batch(()=>{
    for(const component of components.filter(group=>group.nodes().length<=3)){
     const xs=component.nodes().map(node=>node.position('x')),min=Math.min(...xs),span=Math.max(...xs)-min;
     if(span>0){const width=Math.min(300,Math.max(120,root.clientWidth-160));component.nodes().positions(node=>({x:80+(node.position('x')-min)*width/span,y:node.position('y')}));}
    }
    const isolated=cy.nodes().filter(node=>node.degree()===0),linked=cy.edges().length>0,right=linked&&window.matchMedia('(min-width: 48rem)').matches;
    const x=right?440:10,y=right?60:linked?offsetForIsolates(cy)+75:25;
    const cols=Math.max(1,Math.min(isolated.length,right?Math.max(2,Math.floor((root.clientWidth-440)/155)):Math.max(1,Math.floor((root.clientWidth-20)/155))));
    if(isolated.length)isolated.layout({name:'grid',fit:false,avoidOverlap:true,cols,boundingBox:{x1:x,y1:y,w:cols*155,h:Math.ceil(isolated.length/cols)*105},sort:(a,b)=>a.data('label').localeCompare(b.data('label'))||a.id().localeCompare(b.id())}).run();
   });
  };
  arrangeForViewport();
  if(import.meta.env?.VITE_SENSA_BROWSER_SMOKE==='true')performance.measure('sensa.graph.layout',{start:layoutStarted,end:performance.now()});
  cy.on('tap','node',event=>current.current.onSelect(event.target.id()));
  cy.on('mouseover','node',event=>current.current.onHover(event.target.id()));
  cy.on('mouseout','node',()=>current.current.onHover(null));
  cy.on('pan zoom',publish);
  const observer=new ResizeObserver(()=>{cy.resize();arrangeForViewport();publish();});observer.observe(root);
  const theme=new MutationObserver(()=>{cy.style(style());});theme.observe(document.documentElement,{attributes:true});
  publish();
  return()=>{cancelAnimationFrame(paintFrame);delete root.dataset.graphReady;observer.disconnect();theme.disconnect();cy.destroy();engine.current=null;};
 },[signature]);
 useEffect(()=>{
  const cy=engine.current;if(!cy)return;cy.batch(()=>{cy.nodes().forEach(node=>{node.data('label',props.graph.byId.get(node.id())?.label??'');});
  cy.elements().removeClass('active adjacent quiet label-hidden labels-all');
  if(props.labels==='all')cy.nodes().addClass('labels-all');
  const id=props.highlight??props.selected,node=id?cy.getElementById(id):cy.collection();
  const related=id?relatedMeaningExpressions(props.graph,id).map(edge=>cy.getElementById(edge.to)):[];
  const visible=cy.collection().merge(node);for(const item of related)visible.merge(item);
  if(node.length){node.addClass('active');visible.not(node).addClass('adjacent');visible.connectedEdges().filter(edge=>visible.contains(edge.source())&&visible.contains(edge.target())).addClass('active');cy.nodes().not(visible).addClass('quiet');}
  if(props.labels==='selected'&&!props.searching)cy.nodes().not(visible).addClass('label-hidden');
  });
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

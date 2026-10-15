import {test,expect,vi} from 'vitest';
import cytoscape from 'cytoscape';
import {partitionMeaningGraph,meaningGraphKeyboardPositions,meaningGraphPresetLayout,layoutMeaningGraphIsolates} from '../../../apps/web/src/experience/ui/meaningGraphCanvasModel';

test('bounded native grid strips match the complete overlap-checked grid for fixed node sizes and stable label ties',()=>{
 for(const cols of [1,3,7]){
  const cy=cytoscape({headless:true,styleEnabled:true,style:[{selector:'node',style:{width:24,height:24,'border-width':3}}],elements:Array.from({length:cols*130+1},(_,i)=>({data:{id:`n${i}`,label:`same ${i%11}`}}))});
  try{
   const nodes=cy.nodes(),x=440,y=60,sort=(a:any,b:any)=>a.data('label').localeCompare(b.data('label'))||a.id().localeCompare(b.id());
   nodes.layout({name:'grid',fit:false,avoidOverlap:true,cols,boundingBox:{x1:x,y1:y,w:cols*155,h:Math.ceil(nodes.length/cols)*105},sort}).run();
   const expected=nodes.map(node=>({...node.position()}));
   nodes.positions(()=>({x:0,y:0}));
   const dimensions=vi.spyOn(Object.getPrototypeOf(nodes),'layoutDimensions');
   try{let strips=0;for(const _ of layoutMeaningGraphIsolates(nodes,x,y,cols))strips++;expect(strips).toBe(3);expect(dimensions).not.toHaveBeenCalled();}finally{dimensions.mockRestore();}
   expect(nodes.map(node=>({...node.position()}))).toEqual(expected);
  }finally{cy.destroy();}
 }
});

test('full graph partition preserves Cytoscape BFS, edge and stable root order, including loops and parallel relations',()=>{
 for(let seed=0;seed<24;seed++){
  const nodes=Array.from({length:24},(_,i)=>({data:{id:`n${i}`,label:i<2?'same':`label${i}`}}));
  const pairs=[[0,0],[0,1],[0,1],[2,4],[4,3],[3,2],[4,5],[5,6],[8,9]];
  let random=seed+1;
  for(let i=0;i<20;i++){random=(random*1664525+1013904223)>>>0;const a=random%18;random=(random*1664525+1013904223)>>>0;pairs.push([a,random%18]);}
  const cy=cytoscape({headless:true,elements:[...nodes,...pairs.map(([source,target],i)=>({data:{id:`e${i}`,source:`n${source}`,target:`n${target}`}}))]});
  try{
   const isolated=cy.nodes().filter(node=>node.degree()===0),expected=cy.nodes().not(isolated).union(cy.edges()).components(),actual=partitionMeaningGraph(cy);
   expect(actual.linked.map(group=>group.map(e=>e.id()))).toEqual(expected.filter(group=>group.edges().length).map(group=>group.map(e=>e.id())));
   expect(actual.isolated.map(n=>n.id())).toEqual(isolated.map(n=>n.id()));
   expect(actual.linked.map(group=>group.nodes().sort((a,b)=>b.degree()-a.degree()).first().id())).toEqual(expected.filter(group=>group.edges().length).map(group=>group.nodes().sort((a,b)=>b.degree()-a.degree()).first().id()));
   const members=[...actual.linked.flatMap(group=>group.map(e=>e.id())),...actual.isolated.map(n=>n.id())];
   expect(new Set(members).size).toBe(cy.elements().length);
   expect(members.length).toBe(cy.elements().length);
  }finally{cy.destroy();}
 }
});

test('preset never fits implicitly; explicit fit and restored viewport retain every model coordinate',()=>{
 const probe=cytoscape({headless:true}),proto=Object.getPrototypeOf(probe),fit=vi.spyOn(proto,'getFitViewport');
 const elements=Array.from({length:12},(_,i)=>({data:{id:`n${i}`},position:{x:i*80,y:i*40}}));
 let cy:ReturnType<typeof cytoscape>|undefined,replacement:typeof cy;
 try{
  cy=cytoscape({headless:true,styleEnabled:true,elements,layout:meaningGraphPresetLayout,minZoom:.12,maxZoom:2.5});
  expect(fit.mock.calls.length).toBe(0);
  cy.viewport({zoom:1,pan:{x:15,y:10}});
  expect(cy.pan()).toEqual({x:15,y:10});expect(cy.zoom()).toBe(1);
  const positions=cy.nodes().map(n=>({id:n.id(),...n.position()}));
  cy.fit(undefined,45);expect(fit.mock.calls.length).toBe(1);
  const camera={zoom:cy.zoom(),pan:{...cy.pan()}};
  replacement=cytoscape({headless:true,styleEnabled:true,elements,layout:meaningGraphPresetLayout,minZoom:.12,maxZoom:2.5});replacement.viewport(camera);
  expect(fit.mock.calls.length).toBe(1);expect(replacement.pan()).toEqual(camera.pan);expect(replacement.zoom()).toBe(camera.zoom);
  expect(replacement.nodes().map(n=>({id:n.id(),...n.position()}))).toEqual(positions);
 }finally{fit.mockRestore();cy?.destroy();replacement?.destroy();probe.destroy();}
});

test('many disconnected linked pairs do not repeatedly group the whole collection',()=>{
 const count=500,cy=cytoscape({headless:true,elements:[...Array.from({length:count*3},(_,i)=>({data:{id:`n${i}`}})),...Array.from({length:count},(_,i)=>({data:{id:`e${i}`,source:`n${i*2}`,target:`n${i*2+1}`}}))]});
 const proto=Object.getPrototypeOf(cy.collection()),original=proto.byGroup;let groupedElements=0;
 const grouping=vi.spyOn(proto,'byGroup').mockImplementation(function(this:{length:number}){groupedElements+=this.length;return original.call(this);});
 const identities=vi.spyOn(proto,'id'),incidence=vi.spyOn(proto,'connectedEdges');
 try{
  const partition=partitionMeaningGraph(cy);
  expect(identities.mock.calls.length).toBeLessThanOrEqual((count*4)*12);
  expect(incidence).not.toHaveBeenCalled();
  expect(partition.linked).toHaveLength(count);expect(partition.isolated).toHaveLength(count);
  expect(groupedElements).toBeLessThanOrEqual(cy.elements().length*4);
 }finally{grouping.mockRestore();identities.mockRestore();incidence.mockRestore();cy.destroy();}
});

test('keyboard coordinates read only the requested window and follow native camera changes',()=>{
 const cy=cytoscape({headless:true,elements:Array.from({length:60000},(_,i)=>({data:{id:`n${i}`},position:{x:i,y:i*2}})),layout:{name:'preset'}});
 const nodes=Array.from({length:65},(_,i)=>({id:`n${30000+i}`})),lookup=vi.spyOn(cy,'getElementById'),all=vi.spyOn(cy,'nodes');
 try{
  cy.pan({x:30,y:40});cy.zoom(1.5);
  const before=meaningGraphKeyboardPositions(cy,nodes);
  expect(lookup).toHaveBeenCalledTimes(65);expect(all).not.toHaveBeenCalled();
  lookup.mockClear();cy.pan({x:-10,y:80});cy.zoom(.5);
  const after=meaningGraphKeyboardPositions(cy,[...nodes.slice(-3),{id:'n59999'}]);
  expect(lookup).toHaveBeenCalledTimes(4);expect(all).not.toHaveBeenCalled();
  expect(before.get('n30064')).toEqual({id:'n30064',x:30064*1.5+30,y:30064*3+40});
  expect(after.get('n30064')).toEqual({id:'n30064',x:30064*.5-10,y:30064+80});
  expect(after.get('n59999')).toEqual({id:'n59999',x:59999*.5-10,y:59999+80});
 }finally{lookup.mockRestore();all.mockRestore();cy.destroy();}
});

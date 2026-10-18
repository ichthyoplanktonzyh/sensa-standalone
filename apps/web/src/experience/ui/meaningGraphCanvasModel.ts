import type {Core,NodeSingular,EdgeSingular,CollectionReturnValue,NodeCollection} from 'cytoscape';

// The Canvas's explicit initial/restored camera owns the viewport. Fitting
// these temporary positions would scan the full graph before its real layout.
export const meaningGraphPresetLayout={name:'preset',fit:false} as const;

/** Native grid strips keep the same global sort/cells, with bounded work units.
 * Nodes occupy at most 30px including emphasis borders; 155x105px cells already
 * exceed the native overlap check's extra 10px. Labels are excluded by grid. */
export function* layoutMeaningGraphIsolates(isolated:NodeCollection,x:number,y:number,cols:number){
 const ordered=isolated.sort((a,b)=>a.data('label').localeCompare(b.data('label'))||a.id().localeCompare(b.id()));
 const chunk=cols*64;
 for(let start=0;start<ordered.length;start+=chunk){
  const nodes=ordered.slice(start,start+chunk);
  nodes.layout({name:'grid',fit:false,avoidOverlap:false,cols,boundingBox:{x1:x,y1:y+start/cols*105,w:cols*155,h:Math.ceil(nodes.length/cols)*105}}).run();
  yield;
 }
}

/** Preserve the engine's component and BFS order for the existing layouts. */
export function partitionMeaningGraph(cy:Core){
 const nodes=cy.nodes(),adjacency=new Map<string,{node:NodeSingular;edges:{edge:EdgeSingular;other:string}[]}>();
 for(const node of nodes)adjacency.set(node.id(),{node,edges:[]});
 for(const edge of cy.edges()){
  const from=edge.source().id(),to=edge.target().id();
  adjacency.get(from)!.edges.push({edge,other:to});
  if(from!==to)adjacency.get(to)!.edges.push({edge,other:from});
 }
 const isolated=cy.collection(),remaining:NodeSingular[]=[],indexes=new Map<string,number>();
 for(const node of nodes){
  if(!adjacency.get(node.id())!.edges.length)isolated.merge(node);
  else {indexes.set(node.id(),remaining.length);remaining.push(node);}
 }
 // Cytoscape's unmerge swaps the tail into the removed slot. Retain that
 // component order in O(1) per removal, including its stable degree ties.
 const remove=(id:string)=>{
  const index=indexes.get(id);if(index===undefined)return;
  const last=remaining.pop()!;indexes.delete(id);
  if(index<remaining.length){remaining[index]=last;indexes.set(last.id(),index);}
 };
 const visited=new Set<string>(),seenEdges=new Set<EdgeSingular>(),linked:CollectionReturnValue[]=[];
 while(remaining.length){
  const queue=[remaining[0]!.id()],members:NodeSingular[]=[],edges:EdgeSingular[]=[];
  visited.add(queue[0]!);
  for(let cursor=0;cursor<queue.length;cursor++){
   const id=queue[cursor]!,entry=adjacency.get(id)!;remove(id);members.push(entry.node);
   for(const {edge,other} of entry.edges){
    if(!seenEdges.has(edge)){seenEdges.add(edge);edges.push(edge);}
    if(!visited.has(other)){visited.add(other);queue.push(other);}
   }
  }
  const component=cy.collection();
  for(const node of members)component.merge(node);
  for(const edge of edges)component.merge(edge);
  linked.push(component);
 }
 return {isolated:isolated.nodes(),linked};
}

/** Only the mounted keyboard window needs screen coordinates. */
export function meaningGraphKeyboardPositions(cy:Core|null,nodes:readonly {id:string}[]){
 return new Map(nodes.flatMap(({id})=>{
  const node=cy?.getElementById(id);
  return node?.length?[[id,{id,...node.renderedPosition()}] as const]:[];
 }));
}

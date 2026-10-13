import type {Core,NodeSingular,EdgeSingular,CollectionReturnValue} from 'cytoscape';

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

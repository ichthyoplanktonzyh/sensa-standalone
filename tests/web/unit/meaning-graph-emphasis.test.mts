import {test,expect} from 'vitest';
import cytoscape from 'cytoscape';
import {applyMeaningGraphEmphasis,type MeaningGraphEmphasis} from '../../../apps/web/src/experience/ui/meaningGraphEmphasis';
import {buildMeaningGraph,relatedMeaningExpressions} from '../../../apps/web/src/experience/ui/meaningGraph';
import {projectWorldGraphItem,worldItemFromRegistry} from '../../../apps/web/src/experience/personalMeaningJourney/worldRead';
import {expressionWorldFixture} from '../support/expressionWorldFixture';

test('incremental graph emphasis matches full relation/label semantics across hover, selection, modes and engine replacement',async()=>{
 const world=await expressionWorldFixture(160),graph=buildMeaningGraph(world.meanings.map(record=>projectWorldGraphItem(worldItemFromRegistry(record,world.registry))));
 const elements=[...graph.nodes.map(node=>({data:{id:node.id,label:node.label}})),...graph.edges.map((edge,index)=>({data:{id:`edge-${index}`,source:edge.from,target:edge.to}}))];
 const actual=cytoscape({headless:true,elements}),oracle=cytoscape({headless:true,elements});
 let previous:MeaningGraphEmphasis|null=null;
 const states=(cy:typeof actual)=>cy.elements().map(element=>({id:element.id(),label:element.data('label'),classes:element.classes().sort()}));
 try{
  const ids=[null,...graph.nodes.slice(0,5).map(node=>node.id),graph.nodes.at(-1)!.id,null,'missing'];
  for(const labels of ['auto','all','selected'] as const)for(const searching of [false,true])for(const id of ids){
   previous=applyMeaningGraphEmphasis(actual,graph,{id,labels,searching},previous);
   oracle.batch(()=>{
    oracle.elements().removeClass('active adjacent quiet label-hidden labels-all');
    if(labels==='all')oracle.nodes().addClass('labels-all');
    const node=id?oracle.getElementById(id):oracle.collection(),visible=oracle.collection().merge(node);
    if(node.length)for(const edge of relatedMeaningExpressions(graph,node.id()))visible.merge(oracle.getElementById(edge.to));
    if(node.length){node.addClass('active');visible.not(node).addClass('adjacent');visible.connectedEdges().filter(edge=>visible.contains(edge.source())&&visible.contains(edge.target())).addClass('active');oracle.nodes().not(visible).addClass('quiet');}
    if(labels==='selected'&&!searching)oracle.nodes().not(visible).addClass('label-hidden');
   });
   expect(states(actual)).toEqual(states(oracle));
  }
  // A repeated hover keeps unrelated nodes untouched; model labels are owned
  // by the Canvas's separate model effect, never by pointer emphasis.
  const id=graph.nodes[0]!.id;
  previous=applyMeaningGraphEmphasis(actual,graph,{id,labels:'all',searching:false},previous);
  const unrelated=actual.nodes().filter(node=>node.degree()===0&&node.id()!==id&&node.id()!==graph.nodes[1]!.id).first(),changed:string[]=[];
  expect(unrelated.length).toBe(1);
  unrelated.on('data class',event=>changed.push(event.type));
  previous=applyMeaningGraphEmphasis(actual,graph,{id:graph.nodes[1]!.id,labels:'all',searching:false},previous);
  expect(changed).toEqual([]);
  expect(actual.nodes().map(node=>node.data('label'))).toEqual(graph.nodes.map(node=>node.label));
  const replacement=cytoscape({headless:true,elements});
  try{applyMeaningGraphEmphasis(replacement,graph,{id:null,labels:'selected',searching:false},previous);expect(replacement.nodes('.label-hidden')).toHaveLength(graph.nodes.length);}finally{replacement.destroy();}
 }finally{actual.destroy();oracle.destroy();}
});

import type {Core,CollectionReturnValue} from 'cytoscape';
import {relatedMeaningExpressions,type buildMeaningGraph} from './meaningGraph';

export type MeaningGraphEmphasis={cy:Core;node:CollectionReturnValue;visible:CollectionReturnValue;edges:CollectionReturnValue;all:boolean;hidden:boolean};

/** Pointer changes update neighborhoods; only entering/leaving emphasis or a
 * label mode change requires a collection-wide style update. */
export function applyMeaningGraphEmphasis(cy:Core,graph:ReturnType<typeof buildMeaningGraph>,view:{id:string|null;labels:'auto'|'all'|'selected';searching:boolean},prior:MeaningGraphEmphasis|null):MeaningGraphEmphasis{
 const previous=prior?.cy===cy?prior:null;
 const node=view.id?cy.getElementById(view.id):cy.collection(),visible=cy.collection().merge(node);
 if(node.length)for(const edge of relatedMeaningExpressions(graph,node.id()))visible.merge(cy.getElementById(edge.to));
 const edges=visible.connectedEdges().filter(edge=>visible.contains(edge.source())&&visible.contains(edge.target()));
 const priorNode=previous?.node??cy.collection(),priorVisible=previous?.visible??cy.collection(),priorEdges=previous?.edges??cy.collection();
 const all=view.labels==='all',hidden=view.labels==='selected'&&!view.searching;
 cy.batch(()=>{
  priorNode.not(node).removeClass('active');node.not(priorNode).addClass('active');
  priorVisible.not(priorNode).not(visible.not(node)).removeClass('adjacent');visible.not(node).not(priorVisible.not(priorNode)).addClass('adjacent');
  priorEdges.not(edges).removeClass('active');edges.not(priorEdges).addClass('active');
  if(!!priorNode.length!==!!node.length){if(node.length)cy.nodes().not(visible).addClass('quiet');else cy.nodes().removeClass('quiet');}
  else if(node.length){priorVisible.not(visible).addClass('quiet');visible.not(priorVisible).removeClass('quiet');}
  if(all!==!!previous?.all){if(all)cy.nodes().addClass('labels-all');else cy.nodes().removeClass('labels-all');}
  if(hidden!==!!previous?.hidden){if(hidden)cy.nodes().not(visible).addClass('label-hidden');else cy.nodes().removeClass('label-hidden');}
  else if(hidden){priorVisible.not(visible).addClass('label-hidden');visible.not(priorVisible).removeClass('label-hidden');}
 });
 return {cy,node,visible,edges,all,hidden};
}

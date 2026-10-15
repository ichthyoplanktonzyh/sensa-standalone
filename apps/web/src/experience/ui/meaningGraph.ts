import type {WorldGraphAlignment,WorldGraphItem} from '../personalMeaningJourney/worldRead';

export interface ExpressionAssociation {
  item: WorldGraphItem;
  alignment: WorldGraphAlignment;
  focusId: string;
  bindingVersionId: string;
}
export interface MeaningGraphNode {
  id: string;
  label: string;
  languageTag: string;
  associations: ExpressionAssociation[];
  x: number;
  y: number;
}
export interface MeaningGraphEdge {
  from: string;
  to: string;
  facts: Array<{kind:'sense'|'meaning';id:string}>;
}

/** Exact rendered identities and interpretation witnesses for a parked graph.
 * Both models must already come from successful current Library reads. */
export function sameMeaningGraphModel(a:ReturnType<typeof buildMeaningGraph>,b:ReturnType<typeof buildMeaningGraph>):boolean{
 if(a===b)return true;
 if(a.nodes.length!==b.nodes.length||a.edges.length!==b.edges.length)return false;
 const checkedBindings=new Map<WorldGraphAlignment,WorldGraphAlignment>();
 for(let i=0;i<a.nodes.length;i++){
  const x=a.nodes[i]!,y=b.nodes[i]!;
  if(x.id!==y.id||x.label!==y.label||x.languageTag!==y.languageTag||x.associations.length!==y.associations.length)return false;
  for(let j=0;j<x.associations.length;j++){
   const p=x.associations[j]!,q=y.associations[j]!;
   if(p.item.personalMeaningId!==q.item.personalMeaningId||p.item.shortId!==q.item.shortId||p.focusId!==q.focusId||p.bindingVersionId!==q.bindingVersionId||p.alignment.personalMeaningAlignmentId!==q.alignment.personalMeaningAlignmentId||p.alignment.senseId!==q.alignment.senseId||p.alignment.coreMeaningFocus!==q.alignment.coreMeaningFocus)return false;
   if(checkedBindings.get(p.alignment)!==q.alignment){
    const left=p.alignment.confirmedBindings,right=q.alignment.confirmedBindings;
    if(left.length!==right.length||left.some((pin,k)=>pin.expressionId!==right[k]!.expressionId||pin.bindingVersionId!==right[k]!.bindingVersionId||pin.surfaceForm!==right[k]!.surfaceForm||pin.languageTag!==right[k]!.languageTag))return false;
    checkedBindings.set(p.alignment,q.alignment);
   }
  }
 }
 for(let i=0;i<a.edges.length;i++){
  const x=a.edges[i]!,y=b.edges[i]!;
  if(x.from!==y.from||x.to!==y.to||x.facts.length!==y.facts.length||x.facts.some((fact,j)=>fact.kind!==y.facts[j]!.kind||fact.id!==y.facts[j]!.id))return false;
 }
 return true;
}

/** Visible stars are sparse. Details retain every proven shared membership,
 * including members joined through the same hub rather than a direct stroke. */
export function relatedMeaningExpressions(graph:ReturnType<typeof buildMeaningGraph>,expressionId:string):MeaningGraphEdge[]{
 const selected=graph.byId.get(expressionId);if(!selected)return [];
 const candidates=new Set<string>();
 for(const association of selected.associations)for(const key of [`sense:${association.alignment.senseId}`,`meaning:${association.item.personalMeaningId}`])for(const id of graph.groups.get(key)?.members??[])if(id!==expressionId)candidates.add(id);
 return [...candidates].map(id=>graph.byId.get(id)!).sort((a,b)=>graph.order.get(a.id)!-graph.order.get(b.id)!).flatMap(node=>{
  const facts=new Map<string,{kind:'sense'|'meaning';id:string}>();
  for(const a of selected.associations)for(const b of node.associations){
   if(a.alignment.senseId===b.alignment.senseId)facts.set(`sense:${a.alignment.senseId}`,{kind:'sense',id:a.alignment.senseId});
   if(a.item.personalMeaningId===b.item.personalMeaningId)facts.set(`meaning:${a.item.personalMeaningId}`,{kind:'meaning',id:a.item.personalMeaningId});
  }
  return facts.size?[{from:expressionId,to:node.id,facts:[...facts.values()]}]:[];
 });
}

/** One point per stable Expression identity, with its accepted interpretations.
 * Sparse stars represent actual shared Sense/Personal Meaning memberships.
 * Coordinates are a deterministic reading layout, never semantic distance. */
export function buildMeaningGraph(items:readonly WorldGraphItem[],languages:readonly string[]=[]){
  const byId=new Map<string,MeaningGraphNode>();
  const associationKeys=new Map<string,Set<string>>();
  const groups=new Map<string,{kind:'sense'|'meaning';id:string;members:Set<string>}>();
  for(const item of items){
    const branches=[...item.detail.focuses.flatMap(focus=>focus.alignment?[{alignment:focus.alignment,focusId:focus.meaningFocusId}]:[]),...item.detail.directAlignments.map(alignment=>({alignment,focusId:alignment.personalMeaningAlignmentId}))];
    for(const {alignment,focusId} of branches)for(const binding of alignment.confirmedBindings){
      if(languages.length&&!languages.includes(binding.languageTag))continue;
      let node=byId.get(binding.expressionId);
      if(!node){node={id:binding.expressionId,label:binding.surfaceForm,languageTag:binding.languageTag,associations:[],x:0,y:0};byId.set(node.id,node);}
      const key=`${item.personalMeaningId}:${alignment.personalMeaningAlignmentId}:${binding.bindingVersionId}`;
      let keys=associationKeys.get(node.id);if(!keys){keys=new Set();associationKeys.set(node.id,keys);}
      if(!keys.has(key)){keys.add(key);node.associations.push({item,alignment,focusId,bindingVersionId:binding.bindingVersionId});}
      for(const [kind,id] of [['sense',alignment.senseId],['meaning',item.personalMeaningId]] as const){
        const key=`${kind}:${id}`;
        if(!groups.has(key))groups.set(key,{kind,id,members:new Set()});
        groups.get(key)!.members.add(node.id);
      }
    }
  }
  const nodes=[...byId.values()].sort((a,b)=>a.languageTag.localeCompare(b.languageTag)||a.label.localeCompare(b.label)||a.id.localeCompare(b.id));
  const columns=Math.max(1,Math.ceil(Math.sqrt(nodes.length*1.6))),width=Math.max(640,columns*180),rows=Math.ceil(nodes.length/columns);
  nodes.forEach((node,index)=>{node.x=70+(index%columns)*180;node.y=65+Math.floor(index/columns)*100;});
  const edges=new Map<string,MeaningGraphEdge>();
  for(const {kind,id,members} of groups.values()){
    const ids=[...members].sort(),from=ids[0];if(!from)continue;
    for(const to of ids.slice(1)){
      const key=`${from}:${to}`;if(!edges.has(key))edges.set(key,{from,to,facts:[]});
      edges.get(key)!.facts.push({kind,id});
    }
  }
  return {nodes,edges:[...edges.values()],byId,groups,order:new Map(nodes.map((node,index)=>[node.id,index])),width,height:Math.max(320,rows*100+80)};
}

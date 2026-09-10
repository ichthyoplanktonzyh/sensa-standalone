/** G1 design vectors only. Inputs represent domain-validated committed results.
 * No FSRS replay, authority, wire contract or production importer is implemented here.
 */
import {canonical,retentionKey,type RetentionIdentity} from './personalLibraryFacts.js';
export type LearningBranch = {
 id:string; libraryId:string; operationId:string; deviceId:string; parents:string[]; target:RetentionIdentity;
 occurredAt:string; policyVersion:string; evaluatorVersion:string;
} & (
 {kind:'initial';runId:string;basis:null} |
 {kind:'review'|'relearning';runId:string;basis:string;grade:'again'|'hard'|'good'|'easy';schedulerEligible:boolean} |
 {kind:'correction';replaces:string;grade:'again'|'hard'|'good'|'easy'} |
 {kind:'reconciliation';basis:string|null;candidates:string[];selected:string|null}
);
const sorted=(ids:Iterable<string>)=>[...new Set(ids)].sort();
/** Conservatively blocks unresolved branches; never chooses a grade or a device clock. */
export function reconcileLearning(libraryId:string,deliveries:LearningBranch[]){
 const variants=new Map<string,Map<string,LearningBranch>>();
 for(const f of deliveries.filter(f=>f.libraryId===libraryId)){
  const group=variants.get(f.id)??new Map<string,LearningBranch>();group.set(canonical(f),f);variants.set(f.id,group);
 }
 const collisions=sorted([...variants].filter(([,v])=>v.size!==1).map(([id])=>id));
 const candidates=[...variants].filter(([,v])=>v.size===1).map(([,v])=>[...v.values()][0]!);
 const duplicateOperations=new Set<string>(),duplicateRuns=new Set<string>();
 for(const field of ['operationId','runId'] as const){
  const groups=new Map<string,string[]>();
  for(const f of candidates){if(!(field in f))continue;const value=field==='operationId'?f.operationId:'runId' in f?f.runId:'';groups.set(value,[...groups.get(value)??[],f.id]);}
  for(const ids of groups.values())if(ids.length>1)for(const id of ids)(field==='operationId'?duplicateOperations:duplicateRuns).add(id);
 }
 const rejected=new Set([...duplicateOperations,...duplicateRuns]),ready=new Map<string,LearningBranch>(),pending=new Map(candidates.filter(f=>!rejected.has(f.id)).map(f=>[f.id,f]));
 let progress=true;
 while(progress){progress=false;for(const [id,f] of pending)if(f.parents.every(p=>ready.has(p))){ready.set(id,f);pending.delete(id);progress=true;}}
 const ancestor=(id:string,parent:string):boolean=>{const visited=new Set<string>(),queue=[...(ready.get(id)?.parents??[])];while(queue.length){const p=queue.pop()!;if(p===parent)return true;if(!visited.has(p)){visited.add(p);queue.push(...ready.get(p)?.parents??[]);}}return false;};
 const same=(a:LearningBranch,b:LearningBranch)=>retentionKey(a.target)===retentionKey(b.target);
 const effective=new Map<string,LearningBranch>();
 const invalid=new Set<string>();
 // Topological order guarantees invalid dependencies cannot become executable successors.
 for(const [id,f] of ready){
  if(f.parents.some(p=>invalid.has(p))){invalid.add(id);continue;}
  if(f.kind==='review'&&!f.schedulerEligible||!f.policyVersion||!f.evaluatorVersion||!Number.isFinite(Date.parse(f.occurredAt))){invalid.add(id);continue;}
  if(f.kind==='correction'){
   const prior=effective.get(f.replaces);
   if(!prior||!ancestor(id,f.replaces)||!same(f,prior)||(prior.kind!=='review'&&prior.kind!=='relearning'&&prior.kind!=='correction')){invalid.add(id);continue;}
  }else if(f.basis!==null){
   const basis=effective.get(f.basis);
   if(!basis||!ancestor(id,f.basis)||!same(f,basis)||(basis.kind!=='initial'&&basis.kind!=='review'&&basis.kind!=='relearning'&&basis.kind!=='reconciliation'&&basis.kind!=='correction')){invalid.add(id);continue;}
   if(basis.kind==='relearning'&&!basis.schedulerEligible){invalid.add(id);continue;}
  }
  if(f.kind==='reconciliation'){
   if(!f.candidates.length||sorted(f.candidates).length!==f.candidates.length||f.selected!==null&&!f.candidates.includes(f.selected)){invalid.add(id);continue;}
   const branches=f.candidates.map(c=>effective.get(c));
   if(branches.some(b=>!b||!ancestor(id,b.id)||!same(f,b)||b.kind==='reconciliation')){invalid.add(id);continue;}
  }
  effective.set(id,f);
 }
 // A correction keeps its original opportunity; it never creates another due event.
 const root=(f:LearningBranch):LearningBranch=>f.kind==='correction'?root(effective.get(f.replaces)!):f;
 const opportunity=(f:LearningBranch):string=>{const r=root(f);return canonical([retentionKey(r.target),r.kind==='initial'?'initial':r.kind==='relearning'?'relearning':'review','basis' in r?r.basis:null]);};
 const groups=new Map<string,LearningBranch[]>();
 for(const f of effective.values())if(f.kind!=='reconciliation'&&(f.kind!=='relearning'||f.schedulerEligible)){
  const key=opportunity(f);groups.set(key,[...groups.get(key)??[],f]);
 }
 const reconciliations=[...effective.values()].filter((f):f is LearningBranch&{kind:'reconciliation'}=>f.kind==='reconciliation');
 for(const decision of reconciliations){
  const keys=sorted(decision.candidates.map(id=>opportunity(effective.get(id)!)));
  const first=root(effective.get(decision.candidates[0]!)!);
  if(keys.length!==1||!('basis' in first)||decision.basis!==first.basis)invalid.add(decision.id);
 }
 // Reject descendants after semantic checks on reconciliation candidates.
 for(const [id,f] of ready)if(f.parents.some(p=>invalid.has(p)))invalid.add(id);
 const resolutions=new Map<string,{key:string;records:string[];decisions:string[];selected:string|null;contribution:string|null;status:string}>();
 for(const [key,all] of groups){
  const records=all.filter(f=>!invalid.has(f.id));
  const heads=records.filter(f=>!records.some(other=>other.kind==='correction'&&ancestor(other.id,f.id)&&root(other).id===root(f).id));
  const decisions=reconciliations.filter(d=>!invalid.has(d.id)&&d.candidates.every(id=>records.some(f=>f.id===id)));
  const tips=decisions.filter(d=>!decisions.some(other=>other.id!==d.id&&ancestor(other.id,d.id)));
  const complete=tips.length===1&&heads.every(h=>tips[0]!.candidates.includes(h.id))&&(tips[0]!.selected===null||heads.some(h=>h.id===tips[0]!.selected));
  const selected=complete?tips[0]!.selected:tips.length===0&&heads.length===1?heads[0]!.id:null;
  // A reconciliation is the new causal scheduling basis, including an explicit no-contribution decision.
  const contribution=complete?tips[0]!.id:selected;
  const status=complete?'reconciled':tips.length>0||heads.length>1?'requires_reconciliation':'single_candidate';
  resolutions.set(key,{key,records:sorted(records.map(f=>f.id)),decisions:sorted(decisions.map(f=>f.id)),selected,contribution,status});
 }
 // A local successor based on a superseded or contested result remains history, not another schedule.
 let changed=true;
 while(changed){changed=false;for(const [key,resolution] of resolutions){
  if(resolution.status==='blocked_by_basis')continue;
  const f=groups.get(key)?.[0];if(!f)continue;const r=root(f);const basis='basis' in r?r.basis:null;if(basis===null)continue;
  const available=[...resolutions.values()].some(other=>other.contribution===basis&&other.status!=='blocked_by_basis');
  if(!available){resolution.status='blocked_by_basis';resolution.selected=null;resolution.contribution=null;changed=true;}
 }}
 return {collisions,duplicateOperations:sorted(duplicateOperations),duplicateRuns:sorted(duplicateRuns),pending:sorted(pending.keys()),invalid:sorted(invalid),opportunities:[...resolutions.values()].sort((a,b)=>a.key.localeCompare(b.key))};
}

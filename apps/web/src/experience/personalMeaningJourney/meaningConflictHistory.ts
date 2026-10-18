import {backupEqual} from '../../data/library/backupCodec';
import {digestOf} from './digest';
import {canonicalMeaningFacts} from './clarificationSource';
import {mergeMeaningBranch,meaningBranchExtends,stableMeaningFacts} from './meaningBranchMerge';
import type {MeaningJourneyRecord} from './store';

type Snapshot=Omit<MeaningJourneyRecord,'conflictHistory'>;
export type MeaningConflictBranch={digest:string;head:string|null;record:Snapshot};
export type MeaningConflictDecision={id:string;createdAt:string;parents:[string,string];selected:string;base:string|null};
export type MeaningConflictHistory={version:1;head:string;branches:MeaningConflictBranch[];decisions:MeaningConflictDecision[]};
const invalid=():never=>{throw Error('meaning_conflict_history_invalid');};
const plain=(record:MeaningJourneyRecord):Snapshot=>{const {conflictHistory:_,...snapshot}=record;return snapshot;};
const version=(record:MeaningJourneyRecord)=>{const value={head:record.conflictHistory?.head??null,record:canonicalMeaningFacts(plain(record))};return {...value,digest:digestOf(value)};};
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

/** Validate the causal graph, immutable snapshot identity and active lineage.
 * The caller additionally validates every archived snapshot against the same
 * Registry/receipt/media authority as the current Meaning. */
export function assertMeaningConflictHistory(record:MeaningJourneyRecord):void{
 const history=record.conflictHistory;if(history===undefined)return;
 if(!history||Object.keys(history).some(key=>!['version','head','branches','decisions'].includes(key))||history.version!==1||!Array.isArray(history.branches)||!Array.isArray(history.decisions))invalid();
 const branches=new Map<string,MeaningConflictBranch>(),decisions=new Map<string,MeaningConflictDecision>();
 const identity=record.personalMeaning;
 for(const branch of history.branches){
  if(!branch||Object.keys(branch).some(key=>!['digest','head','record'].includes(key))||!branch.record||'conflictHistory'in branch.record||branch.digest!==digestOf({head:branch.head,record:canonicalMeaningFacts(branch.record)})||branches.has(branch.digest))invalid();
  const owner=branch.record.personalMeaning;
  if(!owner||owner.personalMeaningId!==identity.personalMeaningId||owner.learnerUserId!==identity.learnerUserId||(branch.head!==null&&!uuid(branch.head)))invalid();
  branches.set(branch.digest,branch);
 }
 for(const decision of history.decisions){
  if(!decision||Object.keys(decision).some(key=>!['id','createdAt','parents','selected','base'].includes(key))||!uuid(decision.id)||decisions.has(decision.id)||!Number.isFinite(Date.parse(decision.createdAt))||!Array.isArray(decision.parents)||decision.parents.length!==2||new Set(decision.parents).size!==2||!decision.parents.includes(decision.selected)||decision.parents.some(parent=>!branches.has(parent))||(decision.base!==null&&!branches.has(decision.base)))invalid();
  decisions.set(decision.id,decision);
 }
 if(!decisions.has(history.head))invalid();
 const done=new Set<string>(),visiting=new Set<string>(),usedBranches=new Set<string>();
 const stack:Array<{id:string;exit:boolean}>=[{id:history.head,exit:false}];
 while(stack.length){
  const {id,exit}=stack.pop()!;if(done.has(id))continue;
  if(exit){visiting.delete(id);done.add(id);continue;}
  const decision=decisions.get(id)??invalid();if(visiting.has(id))invalid();
  visiting.add(id);stack.push({id,exit:true});
  for(const parent of [...decision.parents,...(decision.base?[decision.base]:[])]){const branch=branches.get(parent)!;usedBranches.add(parent);if(branch.head)stack.push({id:branch.head,exit:false});}
 }
 if(done.size!==decisions.size||usedBranches.size!==branches.size)invalid();
 const selected=(head:string)=>branches.get(decisions.get(head)!.selected)!.record;
 const headCovers=(head:string|null,digest:string)=>{const pending=head?[head]:[],seen=new Set<string>();for(let at=0;at<pending.length;at++){const id=pending[at]!;if(seen.has(id))continue;seen.add(id);const decision=decisions.get(id)!;for(const ref of [...decision.parents,...(decision.base?[decision.base]:[])]){if(ref===digest)return true;const parent=branches.get(ref)!;if(parent.head)pending.push(parent.head);}}return false;};
 for(const decision of decisions.values())if(decision.base){const base=branches.get(decision.base)!;for(const id of decision.parents){const parent=branches.get(id)!;if(!meaningBranchExtends(base.record,parent.record)&&!headCovers(parent.head,base.digest))invalid();}}
 for(const branch of branches.values())if(branch.head&&!meaningBranchExtends(selected(branch.head),branch.record))invalid();
 if(!meaningBranchExtends(selected(history.head),plain(record)))invalid();
 // Alternative revision slots are allowed across branches, but an immutable
 // fact ID never acquires a different body, even inside an archive.
 const facts=new Map<string,unknown>();
 for(const snapshot of [plain(record),...history.branches.map(branch=>branch.record)])for(const {key,value} of stableMeaningFacts(snapshot)){
  if(facts.has(key)&&!backupEqual(facts.get(key),value))invalid();facts.set(key,value);
 }
}

function union<T>(left:readonly T[],right:readonly T[],key:(value:T)=>string):T[]{
 const values=new Map(left.map(value=>[key(value),value]));
 for(const value of right){const id=key(value);if(values.has(id)&&!backupEqual(values.get(id),value))invalid();values.set(id,value);}
 return [...values.values()].sort((a,b)=>key(a).localeCompare(key(b)));
}
function histories(left:MeaningJourneyRecord,right:MeaningJourneyRecord){return {
 branches:union(left.conflictHistory?.branches??[],right.conflictHistory?.branches??[],branch=>branch.digest),
 decisions:union(left.conflictHistory?.decisions??[],right.conflictHistory?.decisions??[],decision=>decision.id),
};}

export function decideMeaningConflict(local:MeaningJourneyRecord,remote:MeaningJourneyRecord,selected:MeaningJourneyRecord,id:string=crypto.randomUUID(),createdAt=new Date().toISOString(),base?:MeaningJourneyRecord):MeaningJourneyRecord{
 assertMeaningConflictHistory(local);assertMeaningConflictHistory(remote);
 let ancestor:MeaningConflictBranch|null=null;
 if(base){
  assertMeaningConflictHistory(base);
  // After an earlier decision, the device checkpoint can be newer than an
  // offline branch's fork point. Use only an exact retained common ancestor,
  // never manufacture a baseline or weaken its immutable transitions.
  const extendsBranch=(side:MeaningJourneyRecord,branch:MeaningConflictBranch)=>
   ((side.conflictHistory?.head??null)===branch.head&&meaningBranchExtends(branch.record,plain(side)))
   ||!!side.conflictHistory?.branches.some(value=>value.digest===branch.digest)
   ||(branch.head===null&&meaningBranchExtends(branch.record,plain(side)));
  ancestor=[version(base),...(base.conflictHistory?.branches??[])].find(branch=>extendsBranch(local,branch)&&extendsBranch(remote,branch))??null;
  if(!ancestor)invalid();
 }
 const ours=version(local),theirs=version(remote),choice=version(selected);
 if(ours.digest===theirs.digest||![ours.digest,theirs.digest].includes(choice.digest))invalid();
 const prior=histories(local,remote),history:MeaningConflictHistory={version:1,head:id,branches:union(prior.branches,[ours,theirs,...(ancestor?[ancestor]:[])],branch=>branch.digest),decisions:[...prior.decisions,{id,createdAt,parents:[ours.digest,theirs.digest],selected:choice.digest,base:ancestor?.digest??null}]};
 const result={...structuredClone(plain(selected)),conflictHistory:structuredClone(history)};
 if(base&&!retainsHistory(base,result))invalid();
 assertMeaningConflictHistory(result);return result;
}

/** A decision covers exact observed facts, never a later local edit. */
function covers(candidate:MeaningJourneyRecord,other:MeaningJourneyRecord):boolean{
 const history=candidate.conflictHistory;if(!history)return false;
 const wanted=version(other).digest;
 return retainsHistory(other,candidate)&&history.branches.some(branch=>branch.digest===wanted);
}
function retainsHistory(before:MeaningJourneyRecord,after:MeaningJourneyRecord){
 const prior=before.conflictHistory;if(!prior)return true;const next=after.conflictHistory;if(!next)return false;
 return prior.branches.every(row=>next.branches.some(value=>value.digest===row.digest&&backupEqual(value,row)))
  &&prior.decisions.every(row=>next.decisions.some(value=>value.id===row.id&&backupEqual(value,row)));
}
export function mergeMeaningConflictHistory(base:MeaningJourneyRecord,local:MeaningJourneyRecord,remote:MeaningJourneyRecord){
 try{
  for(const row of [base,local,remote])assertMeaningConflictHistory(row);
  if(!retainsHistory(base,local)||!retainsHistory(base,remote))return {ok:false as const};
  if(covers(remote,local))return {ok:true as const,value:remote};
  if(covers(local,remote))return {ok:true as const,value:local};
  if((local.conflictHistory?.head??null)!==(remote.conflictHistory?.head??null))return {ok:false as const};
  // A later revision can contain the exact earlier branch even when both
  // devices have moved past the checkpoint. Compare retained facts, not clocks.
  if(remote.personalMeaning.currentRevision>local.personalMeaning.currentRevision&&meaningBranchExtends(plain(local),plain(remote)))return {ok:true as const,value:remote};
  if(local.personalMeaning.currentRevision>remote.personalMeaning.currentRevision&&meaningBranchExtends(plain(remote),plain(local)))return {ok:true as const,value:local};
  const merged=mergeMeaningBranch(plain(base),plain(local),plain(remote));if(!merged.ok)return merged;
  const head=local.conflictHistory?.head;
  if(head)merged.value.conflictHistory={version:1,head,...histories(local,remote)};
  assertMeaningConflictHistory(merged.value);return merged;
 }catch{return {ok:false as const};}
}

/** Ordinary owner commands cannot edit, drop, or replace prior decisions. */
export function assertUnchangedMeaningConflictHistory(before:MeaningJourneyRecord,after:MeaningJourneyRecord){
 if(!backupEqual(before.conflictHistory,after.conflictHistory))invalid();
}

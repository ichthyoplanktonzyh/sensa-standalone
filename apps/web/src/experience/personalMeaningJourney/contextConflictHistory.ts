/** Context conflict choices retain version references, never duplicate bodies. */
import {backupEqual} from '../../data/library/backupCodec';
import {digestOf} from './digest';
import type {ContextHead} from './contextRecords';

export interface ContextConflictBranch {digest:string;head:string|null;revisionId:string}
export interface ContextConflictDecision {id:string;createdAt:string;parents:[string,string];selected:string}
export interface ContextConflictHistory {version:1;head:string;branches:ContextConflictBranch[];decisions:ContextConflictDecision[]}
type Versions=ReadonlyMap<string,{personalSemanticAnchorId:string;parentRevisionId:string|null}>;
const invalid=():never=>{throw Error('context_conflict_history_invalid');};
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
const branch=(head:ContextHead):ContextConflictBranch=>{const value={head:head.conflictHistory?.head??null,revisionId:head.currentRevisionId};return {...value,digest:digestOf(value)};};
const stable=(head:ContextHead)=>{const {currentRevision:_,currentRevisionId:__,updatedAt:___,conflictHistory:____,lifecycleRevision:_____,status:______,deletedAt:_______,deletedByOperationId:________,...identity}=head;return identity;};
export function contextVersionFollows(versions:Versions,start:string,ancestor:string):boolean{
 const seen=new Set<string>();let cursor:string|null|undefined=start;
 while(cursor&&!seen.has(cursor)){if(cursor===ancestor)return true;seen.add(cursor);cursor=versions.get(cursor)?.parentRevisionId;}return false;
}
export function assertContextConflictHistory(head:ContextHead,versions:Versions):void{
 const history=head.conflictHistory;if(history===undefined)return;
 if(!history||Object.keys(history).some(key=>!['version','head','branches','decisions'].includes(key))||history.version!==1||!uuid(history.head)||!Array.isArray(history.branches)||!Array.isArray(history.decisions))invalid();
 const branches=new Map<string,ContextConflictBranch>(),decisions=new Map<string,ContextConflictDecision>();
 for(const row of history.branches){
  if(!row||Object.keys(row).some(key=>!['digest','head','revisionId'].includes(key))||!uuid(row.revisionId)||(row.head!==null&&!uuid(row.head))||row.digest!==digestOf({head:row.head,revisionId:row.revisionId})||branches.has(row.digest)||versions.get(row.revisionId)?.personalSemanticAnchorId!==head.personalSemanticAnchorId)invalid();
  branches.set(row.digest,row);
 }
 for(const row of history.decisions){
  if(!row||Object.keys(row).some(key=>!['id','createdAt','parents','selected'].includes(key))||!uuid(row.id)||decisions.has(row.id)||!Number.isFinite(Date.parse(row.createdAt))||!Array.isArray(row.parents)||row.parents.length!==2||new Set(row.parents).size!==2||row.parents.some(id=>!branches.has(id))||!row.parents.includes(row.selected))invalid();
  decisions.set(row.id,row);
 }
 const seen=new Set<string>(),visiting=new Set<string>(),used=new Set<string>();
 const walk=(id:string)=>{if(seen.has(id))return;if(visiting.has(id))invalid();const choice=decisions.get(id)??invalid();visiting.add(id);for(const ref of choice.parents){used.add(ref);const row=branches.get(ref)!;if(row.head)walk(row.head);}visiting.delete(id);seen.add(id);};
 walk(history.head);if(seen.size!==decisions.size||used.size!==branches.size)invalid();
 const selected=(id:string)=>branches.get(decisions.get(id)!.selected)!.revisionId;
 for(const row of branches.values())if(row.head&&!contextVersionFollows(versions,row.revisionId,selected(row.head)))invalid();
 if(!contextVersionFollows(versions,head.currentRevisionId,selected(history.head)))invalid();
}
function union<T>(left:readonly T[],right:readonly T[],key:(value:T)=>string):T[]{
 const result=new Map(left.map(row=>[key(row),row]));for(const row of right){const id=key(row);if(result.has(id)&&!backupEqual(result.get(id),row))invalid();result.set(id,row);}return [...result.values()].sort((a,b)=>key(a).localeCompare(key(b)));
}
function retains(before:ContextHead,after:ContextHead){const old=before.conflictHistory,next=after.conflictHistory;return !old||!!next&&old.branches.every(row=>next.branches.some(value=>backupEqual(row,value)))&&old.decisions.every(row=>next.decisions.some(value=>backupEqual(row,value)));}
function covers(candidate:ContextHead,other:ContextHead,versions:Versions){return retains(other,candidate)&&!!candidate.conflictHistory?.branches.some(row=>row.digest===branch(other).digest||(row.head===(other.conflictHistory?.head??null)&&contextVersionFollows(versions,row.revisionId,other.currentRevisionId)));}
function histories(local:ContextHead,remote:ContextHead){return {branches:union(local.conflictHistory?.branches??[],remote.conflictHistory?.branches??[],row=>row.digest),decisions:union(local.conflictHistory?.decisions??[],remote.conflictHistory?.decisions??[],row=>row.id)};}
export function decideContextConflict(local:ContextHead,remote:ContextHead,selected:ContextHead,id:string,createdAt:string,versions:Versions):ContextHead{
 for(const head of [local,remote])assertContextConflictHistory(head,versions);
 if(!backupEqual(stable(local),stable(remote)))invalid();
 const ours=branch(local),theirs=branch(remote),choice=branch(selected);
 if(ours.digest===theirs.digest||![ours.digest,theirs.digest].includes(choice.digest))invalid();
 const prior=histories(local,remote),result:ContextHead={...selected,conflictHistory:{version:1,head:id,branches:union(prior.branches,[ours,theirs],row=>row.digest),decisions:[...prior.decisions,{id,createdAt,parents:[ours.digest,theirs.digest],selected:choice.digest}]}};
 assertContextConflictHistory(result,versions);return result;
}
export function mergeContextHeads(base:ContextHead,local:ContextHead,remote:ContextHead,versions:Versions):{ok:true;value:ContextHead}|{ok:false}{
 try{
  for(const head of [base,local,remote])assertContextConflictHistory(head,versions);
  if(!backupEqual(stable(base),stable(local))||!backupEqual(stable(base),stable(remote)))return {ok:false};
  if(covers(local,remote,versions)&&retains(base,local))return {ok:true,value:local};
  if(covers(remote,local,versions)&&retains(base,remote))return {ok:true,value:remote};
  // An offline edit on the selected lineage is new intent. Adopt the decision
  // while keeping that descendant; edits on its rejected sibling still conflict.
  if(!local.conflictHistory&&remote.conflictHistory&&retains(base,remote)&&contextVersionFollows(versions,local.currentRevisionId,remote.currentRevisionId)){const value={...local,conflictHistory:remote.conflictHistory};assertContextConflictHistory(value,versions);return {ok:true,value};}
  if(!remote.conflictHistory&&local.conflictHistory&&retains(base,local)&&contextVersionFollows(versions,remote.currentRevisionId,local.currentRevisionId)){const value={...remote,conflictHistory:local.conflictHistory};assertContextConflictHistory(value,versions);return {ok:true,value};}
  if(!retains(base,local)||!retains(base,remote)||(local.conflictHistory?.head??null)!==(remote.conflictHistory?.head??null))return {ok:false};
  const selected=contextVersionFollows(versions,local.currentRevisionId,remote.currentRevisionId)?local:contextVersionFollows(versions,remote.currentRevisionId,local.currentRevisionId)?remote:undefined;
  if(!selected)return {ok:false};
  const value=selected.conflictHistory?{...selected,conflictHistory:{version:1 as const,head:selected.conflictHistory.head,...histories(local,remote)}}:selected;
  assertContextConflictHistory(value,versions);return {ok:true,value};
 }catch{return {ok:false};}
}

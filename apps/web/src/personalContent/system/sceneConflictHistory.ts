import {canonicalJsonDigest} from '@sensa/learning-kernel';
import {z} from 'zod';
import {backupEqual} from '../../data/library/backupCodec';
import type {PersonalLearningScene,PersonalLearningSceneRevision} from './personalContentSystem';

export type SceneSnapshot=Omit<PersonalLearningScene,'conflictHistory'>;
export type SceneConflictBranch={digest:string;head:string|null;record:SceneSnapshot};
export type SceneConflictDecision={id:string;createdAt:string;parents:[string,string];selected:string;base:string|null};
export type SceneConflictHistory={version:1;head:string|null;branches:SceneConflictBranch[];decisions:SceneConflictDecision[]};
export const emptySceneConflictHistory=():SceneConflictHistory=>({version:1,head:null,branches:[],decisions:[]});
const uuidSchema=z.string().uuid(),timeSchema=z.number().int().nonnegative();
const image=z.object({mediaId:uuidSchema,kind:z.literal('image'),dataUrl:z.string().startsWith('data:image/').max(8*1024*1024),mimeType:z.string().min(1).max(200),fileName:z.string().min(1).max(500),altText:z.string().max(80)}).strict();
const snapshotSchema=z.object({id:z.string(),kind:z.literal('learning_scene'),sceneId:uuidSchema,learningTargetId:uuidSchema,languageRouteId:uuidSchema,senseId:uuidSchema,senseVersionId:uuidSchema,bindingVersionId:uuidSchema,currentRevision:z.number().int().positive(),revisions:z.array(z.object({revisionId:uuidSchema,revision:z.number().int().positive(),curriculumMembershipId:uuidSchema,body:z.string().max(1000),media:z.array(image).max(3),createdAt:timeSchema}).strict()).min(1),acceptedRevisionId:uuidSchema.nullable(),acceptedPersonalMeaningId:uuidSchema.nullable(),createdAt:timeSchema,updatedAt:timeSchema}).strict();
export function assertSceneTimeline(snapshot:SceneSnapshot):void{
 snapshotSchema.parse(snapshot);
 if(snapshot.revisions.length!==snapshot.currentRevision||new Set(snapshot.revisions.map(row=>row.revisionId)).size!==snapshot.revisions.length)invalid();
 for(const [index,revision] of snapshot.revisions.entries())if(revision.revision!==index+1||!revision.body.trim()&&!revision.media.length)invalid();
 if((snapshot.acceptedRevisionId===null)!==(snapshot.acceptedPersonalMeaningId===null)||snapshot.acceptedRevisionId!==null&&!snapshot.revisions.some(row=>row.revisionId===snapshot.acceptedRevisionId))invalid();
}
const invalid=():never=>{throw Error('libraryBackup.errors.inconsistent');};
const plain=(scene:PersonalLearningScene):SceneSnapshot=>{const {conflictHistory:_,...value}=scene;return value;};
const version=(scene:PersonalLearningScene):SceneConflictBranch=>{const value={head:scene.conflictHistory.head,record:plain(scene)};return {...value,digest:canonicalJsonDigest(value)};};
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
export function sceneBranchExtends(before:SceneSnapshot,after:SceneSnapshot):boolean{
 return (['id','kind','sceneId','learningTargetId','languageRouteId','senseId','senseVersionId','bindingVersionId','createdAt'] as const).every(key=>backupEqual(before[key],after[key]))
  &&after.updatedAt>=before.updatedAt&&after.currentRevision>=before.currentRevision
  &&before.revisions.every((revision,index)=>backupEqual(revision,after.revisions[index]));
}
function union<T>(left:readonly T[],right:readonly T[],key:(value:T)=>string):T[]{
 const rows=new Map(left.map(row=>[key(row),row]));
 for(const row of right){const id=key(row);if(rows.has(id)&&!backupEqual(rows.get(id),row))invalid();rows.set(id,row);}
 return [...rows.values()].sort((a,b)=>key(a).localeCompare(key(b)));
}
const histories=(left:PersonalLearningScene,right:PersonalLearningScene)=>({
 branches:union(left.conflictHistory.branches,right.conflictHistory.branches,row=>row.digest),
 decisions:union(left.conflictHistory.decisions,right.conflictHistory.decisions,row=>row.id),
});
export const sceneHistoryRecords=(scene:PersonalLearningScene):SceneSnapshot[]=>[plain(scene),...scene.conflictHistory.branches.map(branch=>branch.record)];
export function findSceneRevision(scene:PersonalLearningScene,pin:{sceneId:string;revisionId:string;revision:number}):PersonalLearningSceneRevision|undefined{
 for(const snapshot of sceneHistoryRecords(scene))if(snapshot.sceneId===pin.sceneId){const revision=snapshot.revisions.find(row=>row.revisionId===pin.revisionId&&row.revision===pin.revision);if(revision)return revision;}
}
/** An acceptance pointer must resolve to the exact preserved World witness. */
export function assertSceneAcceptance(snapshot:SceneSnapshot,meaning:any):void{
 if(snapshot.acceptedPersonalMeaningId===null)return;
 if(meaning?.personalMeaning?.personalMeaningId!==snapshot.acceptedPersonalMeaningId)invalid();
 const revision=snapshot.revisions.find(row=>row.revisionId===snapshot.acceptedRevisionId)??invalid();
 const records=[meaning,...(meaning.conflictHistory?.branches??[]).map((branch:any)=>branch.record)];
 if(!records.some(record=>record.personalSemanticAnchorRevisions?.some((anchor:any)=>{
  const pin=anchor.structuredPayload?.learningScene;
  return anchor.anchorKind==='scene'&&pin?.sceneId===snapshot.sceneId&&pin.revisionId===revision.revisionId&&pin.revision===revision.revision&&pin.learningTargetId===snapshot.learningTargetId&&pin.curriculumMembershipId===revision.curriculumMembershipId
   &&anchor.bodyText===(revision.body.trim()||null)&&backupEqual(anchor.structuredPayload.media,revision.media);
 })))invalid();
}
export function assertSceneConflictHistory(scene:PersonalLearningScene):void{
 assertSceneTimeline(plain(scene));
 const history=scene.conflictHistory;
 if(!history||history.version!==1||!Array.isArray(history.branches)||!Array.isArray(history.decisions))invalid();
 const branches=new Map<string,SceneConflictBranch>(),decisions=new Map<string,SceneConflictDecision>();
 for(const branch of history.branches){
  if(!branch?.record||'conflictHistory'in branch.record||branch.digest!==canonicalJsonDigest({head:branch.head,record:branch.record})||branches.has(branch.digest)||(branch.head!==null&&!uuid(branch.head)))invalid();
  for(const key of ['id','kind','learningTargetId','languageRouteId','senseId','senseVersionId','bindingVersionId'] as const)if(branch.record[key]!==scene[key])invalid();
  assertSceneTimeline(branch.record);
  branches.set(branch.digest,branch);
 }
 for(const decision of history.decisions){
  if(!decision||!uuid(decision.id)||decisions.has(decision.id)||!Number.isFinite(Date.parse(decision.createdAt))||!Array.isArray(decision.parents)||decision.parents.length!==2||new Set(decision.parents).size!==2||!decision.parents.includes(decision.selected)||decision.parents.some(id=>!branches.has(id))||(decision.base!==null&&!branches.has(decision.base)))invalid();
  decisions.set(decision.id,decision);
 }
 if(history.head===null){if(branches.size||decisions.size)invalid();return;}
 if(!decisions.has(history.head))invalid();
 const done=new Set<string>(),visiting=new Set<string>(),used=new Set<string>(),stack=[{id:history.head,exit:false}];
 while(stack.length){const {id,exit}=stack.pop()!;if(done.has(id))continue;if(exit){visiting.delete(id);done.add(id);continue;}const decision=decisions.get(id)??invalid();if(visiting.has(id))invalid();visiting.add(id);stack.push({id,exit:true});for(const ref of [...decision.parents,...decision.base?[decision.base]:[]]){const branch=branches.get(ref)!;used.add(ref);if(branch.head)stack.push({id:branch.head,exit:false});}}
 if(done.size!==decisions.size||used.size!==branches.size)invalid();
 const selected=(id:string)=>branches.get(decisions.get(id)!.selected)!.record;
 const covers=(head:string|null,digest:string)=>{const pending=head?[head]:[],seen=new Set<string>();for(let at=0;at<pending.length;at++){const id=pending[at]!;if(seen.has(id))continue;seen.add(id);const decision=decisions.get(id)??invalid();for(const ref of [...decision.parents,...decision.base?[decision.base]:[]]){if(ref===digest)return true;const branch=branches.get(ref)!;if(branch.head)pending.push(branch.head);}}return false;};
 for(const decision of decisions.values())if(decision.base){const base=branches.get(decision.base)!;for(const id of decision.parents){const parent=branches.get(id)!;if(!sceneBranchExtends(base.record,parent.record)&&!covers(parent.head,base.digest))invalid();}}
 for(const branch of branches.values())if(branch.head&&!sceneBranchExtends(selected(branch.head),branch.record))invalid();
 if(!sceneBranchExtends(selected(history.head),plain(scene)))invalid();
 const revisions=new Map<string,PersonalLearningSceneRevision>();
 for(const snapshot of sceneHistoryRecords(scene))for(const revision of snapshot.revisions){const key=snapshot.sceneId+':'+revision.revisionId;if(revisions.has(key)&&!backupEqual(revisions.get(key),revision))invalid();revisions.set(key,revision);}
}
function retains(before:PersonalLearningScene,after:PersonalLearningScene):boolean{
 return sceneHistoryRecords(after).some(snapshot=>sceneBranchExtends(plain(before),snapshot))
  &&before.conflictHistory.branches.every(row=>after.conflictHistory.branches.some(next=>backupEqual(row,next)))&&before.conflictHistory.decisions.every(row=>after.conflictHistory.decisions.some(next=>backupEqual(row,next)));
}
export function decideSceneConflict(local:PersonalLearningScene,remote:PersonalLearningScene,selected:PersonalLearningScene,decision:{id:string;createdAt:string},base?:PersonalLearningScene):PersonalLearningScene{
 for(const scene of [local,remote,...base?[base]:[]])assertSceneConflictHistory(scene);
 const ours=version(local),theirs=version(remote),choice=version(selected);
 if(ours.digest===theirs.digest||![ours.digest,theirs.digest].includes(choice.digest))invalid();
 const extendsBranch=(side:PersonalLearningScene,branch:SceneConflictBranch)=>side.conflictHistory.head===branch.head&&sceneBranchExtends(branch.record,plain(side))||side.conflictHistory.branches.some(row=>row.digest===branch.digest)||branch.head===null&&sceneBranchExtends(branch.record,plain(side));
 const ancestor=base?[version(base),...base.conflictHistory.branches].find(branch=>extendsBranch(local,branch)&&extendsBranch(remote,branch)):undefined;
 if(base&&!ancestor)invalid();
 const prior=histories(local,remote),next={...structuredClone(plain(selected)),conflictHistory:{version:1 as const,head:decision.id,branches:union(prior.branches,[ours,theirs,...ancestor?[ancestor]:[]],row=>row.digest),decisions:union(prior.decisions,[{...decision,parents:[ours.digest,theirs.digest] as [string,string],selected:choice.digest,base:ancestor?.digest??null}],row=>row.id)}};
 if(base&&!retains(base,next))invalid();assertSceneConflictHistory(next);return next;
}
export function mergeSceneHistory(base:PersonalLearningScene|undefined,local:PersonalLearningScene,remote:PersonalLearningScene):PersonalLearningScene|undefined{
 for(const scene of [local,remote,...base?[base]:[]])assertSceneConflictHistory(scene);
 if(base&&(!retains(base,local)||!retains(base,remote)))invalid();
 const covers=(candidate:PersonalLearningScene,other:PersonalLearningScene)=>retains(other,candidate)&&candidate.conflictHistory.branches.some(branch=>branch.digest===version(other).digest);
 if(covers(local,remote))return local;if(covers(remote,local))return remote;
 if(local.conflictHistory.head!==remote.conflictHistory.head)return;
 if(backupEqual(plain(local),plain(remote)))return {...local,conflictHistory:{version:1,head:local.conflictHistory.head,...histories(local,remote)}};
 // An unchanged base establishes causality. A timeline prefix alone cannot
 // establish which concurrent acceptance link should survive.
 if(base&&backupEqual(local,base))return remote;
 if(base&&backupEqual(remote,base))return local;
 if(local.acceptedRevisionId!==remote.acceptedRevisionId||local.acceptedPersonalMeaningId!==remote.acceptedPersonalMeaningId)return;
 if(sceneBranchExtends(plain(local),plain(remote)))return {...remote,conflictHistory:{version:1,head:remote.conflictHistory.head,...histories(local,remote)}};
 if(sceneBranchExtends(plain(remote),plain(local)))return {...local,conflictHistory:{version:1,head:local.conflictHistory.head,...histories(local,remote)}};
}

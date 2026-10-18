/** Controlled cursor/index transport for fault tests. Full manifest input is a
 * fixture builder only; the shipped synchronizer receives index pages. */
import {createHash} from 'node:crypto';
import {librarySyncManifest,librarySyncPatch,librarySyncCommit,type LibrarySyncManifest,type LibrarySyncHead} from '@sensa/contracts/sensa';
import {decodeLibrarySyncBlock,encodeLibrarySyncBlock,splitLibrarySyncText} from '@sensa/contracts/sensa/library-sync-blocks';
export class IndexedSyncFixture{
 private stages=new Map<string,{descriptor:any;rows:LibrarySyncManifest['rows'];pages:Map<number,string>;digest:string}>();
 private floor=0;
 private readonly observedRefs=new Map<number,string>();
 private readonly versions=new Map<number,LibrarySyncManifest>();
 readonly receipts=new Map<string,{digest:string;head:LibrarySyncHead}>();
 constructor(private readonly blocks:Map<string,string>){}
 private text(refs:string[]){return refs.map(ref=>decodeLibrarySyncBlock(this.blocks.get(ref)!)).join('');}
 private pack(value:unknown){return splitLibrarySyncText(JSON.stringify(value)).map(text=>{const data=encodeLibrarySyncBlock(text),hash=createHash('sha256').update(data).digest('hex');this.blocks.set(hash,data);return hash;});}
 observe(revision:number,refs:string[]|null){if(!refs?.length)return;const witness=JSON.stringify(refs);if(this.observedRefs.get(revision)===witness)return;const value=JSON.parse(this.text(refs));if(value.version!==8)throw Error('library_sync_incompatible_checkpoint');this.versions.set(revision,librarySyncManifest.parse(value));this.observedRefs.set(revision,witness);}
 head(revision:number,refs:string[]|null):LibrarySyncHead{
  this.observe(revision,refs);const current=this.versions.get(revision);return {revision,manifest:current?{libraryId:current.libraryId,learnerId:current.learnerId,snapshotRevision:Math.max(this.floor,Math.min(...this.versions.keys())),floor:Math.max(this.floor,Math.min(...this.versions.keys())),records:current.rows.length}:null};
 }
 private pageRows<T extends {blocks:string[]|null}>(rows:T[]):T[]{const selected:T[]=[];let refs=0,bytes=0;for(const row of rows){const n=row.blocks?.length??0,b=Buffer.byteLength(JSON.stringify(row));if(selected.length&&(selected.length===512||refs+n>4096||bytes+b>4*1024*1024))break;selected.push(row);refs+=n;bytes+=b;}return selected;}
 page(path:string,body:any,revision:number,refs:string[]|null):unknown|undefined{
  this.observe(revision,refs);
  if(path==='/staging/discard'){const receipt=this.receipts.get(body.operationId);if(receipt)return {head:receipt.head,currentRevision:revision};this.stages.delete(body.operationId);return {head:null,currentRevision:revision};}
  if(path.startsWith('/receipt/'))return {currentRevision:revision,head:this.receipts.get(path.slice('/receipt/'.length))?.head??null};
  if(path==='/staging/begin'){if(!this.stages.has(body.operationId))this.stages.set(body.operationId,{descriptor:body,rows:[],pages:new Map(),digest:createHash('sha256').update('sensa-initial-publication-v1').digest('hex')});return {staged:true};}
  if(path==='/staging/page'){const stage=this.stages.get(body.operationId)!;const prior=stage.pages.get(body.page);if(prior)return {digest:prior};stage.digest=createHash('sha256').update(stage.digest+createHash('sha256').update(JSON.stringify(body)).digest('hex')).digest('hex');stage.rows.push(...body.rows);stage.pages.set(body.page,stage.digest);return {digest:stage.digest};}
  if(path==='/head')return this.head(revision,refs);
  if(path==='/snapshot'){
   const rows=[...this.versions.get(body.snapshotRevision)!.rows].sort((a,b)=>a.table<b.table?-1:a.table>b.table?1:a.key<b.key?-1:a.key>b.key?1:0).filter(row=>!body.after||row.table>body.after.table||row.table===body.after.table&&row.key>body.after.key);
   const selected=this.pageRows(rows),last=selected.at(-1);return {snapshotRevision:body.snapshotRevision,after:body.after,next:last?{table:last.table,key:last.key}:body.after,rows:selected,done:selected.length===rows.length};
  }
  if(path==='/pull'){
   const before=this.versions.get(body.after.revision),after=this.versions.get(body.after.revision+1);if(!after)throw Error('library_sync_snapshot_required');
   const id=(row:{table:string;key:string})=>JSON.stringify([row.table,row.key]),old=new Map(before?.rows.map(row=>[id(row),row])??[]),next=new Map(after.rows.map(row=>[id(row),row]));
   const changes=[...after.rows.filter(row=>JSON.stringify(old.get(id(row))?.blocks)!==JSON.stringify(row.blocks)),...[...old.values()].filter(row=>!next.has(id(row))).map(row=>({...row,blocks:null}))];
   if(!changes.length)changes.push(after.rows.find(row=>row.table==='meta'&&row.key==='identity')!);
   const selected=this.pageRows(changes.slice(body.after.offset)),complete=body.after.offset+selected.length===changes.length,position=complete?{revision:body.after.revision+1,offset:0}:{revision:body.after.revision,offset:body.after.offset+selected.length};
   return {from:body.after,next:position,toRevision:body.toRevision,changes:selected,done:position.revision===body.toRevision};
  }
 }
 commit(raw:unknown,revision:number,refs:string[]|null){
  const input=librarySyncCommit.parse(raw),digest=createHash('sha256').update(JSON.stringify(input)).digest('hex'),prior=this.receipts.get(input.operationId);
  if(prior){if(prior.digest!==digest)throw Error('operation_conflict');return {revision,manifest:refs,head:prior.head};}
  if(revision!==input.baseRevision)throw Error('library_sync_conflict');this.observe(revision,refs);
  let next:LibrarySyncManifest;
  if('staging' in input){const stage=this.stages.get(input.operationId)!;if(stage.digest!==input.staging.digest||stage.rows.length!==input.staging.records)throw Error('operation_conflict');next=librarySyncManifest.parse({version:8,libraryId:stage.descriptor.libraryId,learnerId:stage.descriptor.learnerId,rows:stage.rows});}
  else if('manifest' in input)next=librarySyncManifest.parse(JSON.parse(this.text(input.manifest)));
  else{const patch=librarySyncPatch.parse(JSON.parse(this.text(input.patch))),old=this.versions.get(revision)!;const rows=new Map(old.rows.map(row=>[JSON.stringify([row.table,row.key]),row]));for(const row of patch.changes){const id=JSON.stringify([row.table,row.key]);if(row.blocks)rows.set(id,{...row,blocks:row.blocks});else rows.delete(id);}next={version:8,libraryId:patch.libraryId,learnerId:patch.learnerId,rows:[...rows.values()]};}
  const manifest=this.pack(next);this.observe(revision+1,manifest);const head={...this.head(revision+1,manifest),receipt:{operationId:input.operationId,requestDigest:digest}};this.receipts.set(input.operationId,{digest,head});return {revision:revision+1,manifest,head};
 }
 compact(revision:number){this.floor=revision;}
 clear(){this.stages.clear();this.floor=0;this.observedRefs.clear();this.versions.clear();this.receipts.clear();}
}

/** Actual Intake, teacher, provisioning and runtime functions; fake IDB and bounded model transport. */
import assert from 'node:assert/strict';
import {indexedDB,IDBFactory} from 'fake-indexeddb';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const compiled=await build({stdin:{contents:['store','intake','teacher','providers','personalLearning','learning','drafts','backup','packages','backupValidation','dataControl'].map(n=>`export * from './apps/web/src/data/library/${n}';`).join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'}});
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined});
const temp=await mkdtemp(join(tmpdir(),'sensa-personal-'));await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);
const api=await import(pathToFileURL(join(temp,'core.mjs')).href);
const id=()=>crypto.randomUUID(),library=await api.openLibrary(),accountId=id();await api.command({id:id(),kind:'fixture.owner',input:{}},async(tx:any)=>tx.put('meta','service-owner',{subject:accountId,accountId}));
const provider=await api.saveProvider(id(),{id:id(),expectedRevision:0,name:'Fixture',kind:'compatible',endpoint:'https://fixture.invalid/v1',model:'fixture'},'fixture-secret');
for(const purpose of ['teacher','content','review']){const {settings}=await api.providerSnapshot();await api.assignProvider(id(),purpose,provider.id,settings.revision);}
const proposal={explanation:'临时使用并归还。',expression:{surface:'borrow',type:'word',language:'en'},semanticSpec:{schemaVersion:'sensa-sense-semantic-spec-v1',coreMeaningFocus:'临时取得他人物品，并预期归还。',prototypeScenes:[{summary:'一个人向同伴借用物品，约好稍后归还。',participantRoles:['借用者','所有者'],states:['临时使用'],directionOrCausality:null}],includedCases:[],excludedCases:[],neighborContrasts:[],openQuestions:[]}};
const raw=()=>({version:'sensa-intake-v1',libraryId:library.id,clientId:id(),operationId:id(),snapshot:{sentence:'Private marker: May asked to borrow an umbrella.',language:'en',source:{url:'https://example.org/article',title:'Private fixture',capturedAt:new Date().toISOString()},expression:{text:'borrow',start:29,end:35}},resolution:null,acceptance:null});
const calls:any[]=[];let holdTeacher=false;let mode:'good'|'reject'|'review-fail'|'hold'|'leak'='good',teacherTurn=0,release:(()=>void)|undefined,arrived:(()=>void)|undefined;
const realFetch=globalThis.fetch;globalThis.fetch=async(_url,input)=>{const body=JSON.parse(String(input?.body));calls.push(body);let value:unknown;
 if(body.tools){if(holdTeacher)await new Promise<void>(resolve=>{release=resolve;arrived?.();});teacherTurn++;value={model:'fixture',choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:id(),type:'function',function:teacherTurn===1?{name:'ask_learner',arguments:JSON.stringify({question:'是否需要归还这件物品？'})}:{name:'propose_meaning',arguments:JSON.stringify(proposal)}}]}}]};}
 else{const review=body.messages[0].content.includes('independent Sensa');if(review&&mode==='review-fail')throw Error('Offline');if(!review&&mode==='hold'){await new Promise<void>(resolve=>{release=resolve;arrived?.();});}
 const result=review?{accepted:mode!=='reject',reason:mode==='reject'?'场景改变了原意':'符合固定含义与来源'}:{scene:mode==='leak'?'一个人想要 borrow 一把雨伞。':'一个人向同伴临时借用一把雨伞，约好之后归还。',senseFocus:'临时使用并预期归还'};
 value={model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]};}
 return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});};
const prepare=async(meaningId:string)=>api.preparePersonal(meaningId,provider,await api.selectedReviewProvider(),new AbortController().signal,()=>{});
assert.equal(await api.selectedReviewProvider(),null);

try{
 const slow=raw();await api.receiveWebIntake(accountId,slow);await assert.rejects(api.enrollPersonal(id(),slow.operationId,false));const draft=await api.readLibrary((tx:any)=>tx.get('drafts',slow.operationId));let session=await api.createTeacher(id(),draft);await api.continueTeacher(session.id,provider,new AbortController().signal,()=>{});session=await api.getTeacher(session.id);assert.equal(session.status,'waiting');await api.sayToTeacher(id(),session.id,session.revision,'是的，需要归还。');await api.continueTeacher(session.id,provider,new AbortController().signal,()=>{});session=await api.getTeacher(session.id);assert.equal(session.status,'proposal');assert.equal((await api.readLearning()).targets.length,0);
 const meaning=await api.acceptTeacher(id(),session.id,session.revision);assert.equal((await api.personalLearningSnapshot()).length,0);await api.enrollPersonal(id(),meaning.id,false);await api.enrollPersonal(id(),meaning.id,false);assert.equal((await api.personalLearningSnapshot()).length,1);assert.equal((await api.readLearning()).targets.length,0);
 const defaultBefore=calls.length;mode='leak';await prepare(meaning.id);
 assert.equal(calls.length-defaultBefore,1,'Default preparation only calls the generator');
 assert.equal((await api.personalLearningSnapshot())[0].status,'rejected','Code validator blocks target-expression leakage without model review');
 assert.equal((await api.readLearning()).targets.length,0);
 await api.setModelReviewEnabled(id(),true,(await api.providerSnapshot()).settings.revision);
 const before=calls.length;mode='review-fail';await assert.rejects(prepare(meaning.id));assert.equal(calls.length-before,2);assert(!JSON.stringify(calls.slice(before)).includes('Private marker'));assert.equal((await api.readLearning()).targets.length,0);
 mode='good';await prepare(meaning.id);assert.equal(calls.length-before,3,'Retry must reuse saved candidate and call only the reviewer');let task=(await api.personalLearningSnapshot())[0];assert.equal(task.status,'ready');const learning=await api.readLearning();assert.equal(learning.targets.length,1);assert.equal(learning.runs.length,0);assert.equal(learning.targets[0].material.snapshot.provisioningPath,'on_demand');assert.equal(learning.targets[0].material.snapshot.personalAnchorUseGrantIds.length,0);
 await api.confirmLearningQuantity(id(),20);let run=await api.startLearning(id(),task.targetId,20);run=await api.actLearning(id(),run.id,run.revision,{kind:'reveal'});run=await api.actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'});assert.equal((await api.readLearning()).targets[0].memoryRevision,1);
 // Fast-track acceptance is independent from membership and supports explicit source consent.
 const fastRaw=raw();fastRaw.snapshot.sentence='Private marker: May offered to lend an umbrella.';fastRaw.snapshot.expression={text:'lend',start:31,end:35};const fast={...fastRaw,resolution:{kind:'proposal',proposal:{...proposal,expression:{...proposal.expression,surface:'lend'}}},acceptance:{kind:'direct',consent:'accept_context_expression_sense',authorization:'browser:explicit_accept_button'}};await api.receiveWebIntake(accountId,fast);const fastMeaning=(await api.listMeanings()).find((m:any)=>m.draftId===fast.operationId);await api.enrollPersonal(id(),fastMeaning.id,true);mode='reject';await prepare(fastMeaning.id);task=(await api.personalLearningSnapshot()).find((t:any)=>t.id===fastMeaning.id);assert.equal(task.status,'rejected');assert.equal((await api.readLearning()).targets.length,1);assert(JSON.stringify(calls.at(-1)).includes('Private marker'));
 // A cancellation fences a late generator, even if its HTTP implementation ignores abort.
 mode='hold';const held=new Promise<void>(resolve=>{arrived=resolve;});const work=prepare(fastMeaning.id);await held;await api.stopPersonalPreparation(id(),fastMeaning.id);release!();await assert.rejects(work);assert.equal((await api.readLearning()).targets.length,1);
 // A failed final write cannot publish a ready material or leak a partial target.
 mode='good';const put=api.LibraryTransaction.prototype.put;api.LibraryTransaction.prototype.put=function(table:any,key:any,value:any){if(table==='learningTargets')throw Error('injected disk error');return put.call(this,table,key,value);};await assert.rejects(prepare(fastMeaning.id));api.LibraryTransaction.prototype.put=put;assert.equal((await api.readLearning()).targets.length,1);
 await api.setModelReviewEnabled(id(),false,(await api.providerSnapshot()).settings.revision);
 assert.equal(await api.selectedReviewProvider(),null);const beforeCodeOnly=calls.length;await prepare(fastMeaning.id);assert.equal(calls.length,beforeCodeOnly,'Disabling model review reuses the saved candidate with zero model calls');
 const codeAttempt=await api.readLibrary(async(tx:any)=>(await tx.all('contentAttempts')).find((a:any)=>a.status==='ready'&&a.reviewProvider===null));assert.equal(codeAttempt.review,null);assert(codeAttempt.validation.content);assert.equal((await api.readLearning()).targets.length,2);
 const dump=JSON.stringify(await api.readLibrary(async(tx:any)=>({attempts:await tx.all('contentAttempts'),tasks:await tx.all('personalLearning')})));assert(!dump.includes('fixture-secret'));
 if(process.argv.includes('--backup')){
  // Include published resources, review/relearning history and a resumable reveal step.
  await api.finishLearning(id(),run.id);
  const content=(await api.readLearning()).targets.find((t:any)=>t.id===run.targetId).material.content;
  const pack=await api.installPackage(new TextEncoder().encode(JSON.stringify({format:'sensa-learning-package-v1',id:id(),version:'1',title:'Backup fixture',targetLanguage:'en',familiarLanguage:'zh-CN',entries:[{senseId:id(),senseVersionId:id(),bindingId:id(),bindingVersionId:id(),expression:'borrow',meaning:proposal.semanticSpec.coreMeaningFocus,content}]})));
  const [packageTarget]=await api.enrollPackage(id(),pack.key);
  let packageRun=await api.startLearning(id(),packageTarget,20);
  packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'reveal'});packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'rate',rating:'good'});await api.finishLearning(id(),packageRun.id);
  const due=(await api.readLearning()).targets.find((t:any)=>t.id===packageTarget).memory.dueAt.toISOString();packageRun=await api.startLearning(id(),packageTarget,20,due);
  packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'reveal'},due);packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'rate',rating:'again'},due);await api.finishLearning(id(),packageRun.id);
  const relearnAt=(await api.readLearning()).targets.find((t:any)=>t.id===packageTarget).relearnAt;packageRun=await api.startLearning(id(),packageTarget,20,relearnAt);packageRun=await api.actLearning(id(),packageRun.id,packageRun.revision,{kind:'reveal'},relearnAt);
  const inFlightDraft=await api.saveDraft(id(),{id:id(),expectedRevision:0,text:'An interrupted clarification'}),inFlightSession=await api.createTeacher(id(),inFlightDraft);
  holdTeacher=true;const teacherArrived=new Promise<void>(resolve=>{arrived=resolve;});const teacherWork=api.continueTeacher(inFlightSession.id,provider,new AbortController().signal,()=>{});await teacherArrived;
  const password='local-backup-test-password', exported=await api.exportLibraryBackup(password);
  assert.equal(exported.summary.interrupted,1);await api.stopTeacher(id(),inFlightSession.id,(await api.getTeacher(inFlightSession.id)).revision);release!();await assert.rejects(teacherWork);holdTeacher=false;
  const sourceRows=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
  api.validateBackupRows(sourceRows);const invalid=structuredClone(sourceRows);invalid.learningTargets.find((r:any)=>r.value.id===packageTarget).value.memoryRevision++;assert.throws(()=>api.validateBackupRows(invalid));

  assert(!new TextDecoder().decode(exported.file).includes('Private marker'));
  assert.equal((await api.inspectLibraryBackup(exported.file,password)).targets,3);
  await assert.rejects(api.inspectLibraryBackup(exported.file,'wrong-password'));
  const damaged=exported.file.slice();damaged[damaged.length-10]^=1;await assert.rejects(api.inspectLibraryBackup(damaged,password));
  await assert.rejects(api.restoreLibraryBackup(exported.file,password),/libraryBackup.errors.occupied/);
  const source=await api.readLearning();
  Object.assign(globalThis,{indexedDB:new IDBFactory()});
  let restored=await import(pathToFileURL(join(temp,'core.mjs')).href+'?fresh');
  const fresh=await restored.openLibrary();
  const owner=async(subject:string)=>restored.command({id:id(),kind:'service.fixture',input:{subject}},async(tx:any)=>tx.put('meta','service-owner',{subject,accountId:subject}));
  await owner(id());await assert.rejects(restored.restoreLibraryBackup(exported.file,password),/libraryBackup.errors.accountMismatch/);
  await owner(accountId);
  const originalPut=restored.LibraryTransaction.prototype.put;
  restored.LibraryTransaction.prototype.put=function(table:any,key:any,value:any){if(table==='learningEvents')throw Error('injected disk error');return originalPut.call(this,table,key,value);};
  await assert.rejects(restored.restoreLibraryBackup(exported.file,password),/disk error/);
  restored.LibraryTransaction.prototype.put=originalPut;
  assert.equal((await restored.readLearning()).targets.length,0);
  await restored.restoreLibraryBackup(exported.file,password);
  await assert.rejects(restored.openLibrary(),/libraryReplaced/);
  restored=await import(pathToFileURL(join(temp,'core.mjs')).href+'?reopened');
  await restored.openLibrary();
  assert.deepEqual(await restored.readLearning(),source);
  assert.equal((await restored.getTeacher(inFlightSession.id)).status,'stopped');assert.equal(restored.hasCredential(provider),false);
  const identity=await restored.openLibrary();assert.equal(identity.id,library.id);assert.equal(identity.learnerId,library.learnerId);assert.equal(identity.deviceId,fresh.deviceId);assert.notEqual(identity.deviceId,library.deviceId);
  await assert.rejects(restored.restoreLibraryBackup(exported.file,password),/libraryBackup.errors.occupied/);
  await restored.actLearning(id(),packageRun.id,packageRun.revision,{kind:'rate',rating:'good'},relearnAt);
  await restored.exportLibraryBackup(password);
  const preview=await restored.inspectLocalClear();
  await restored.confirmLearningQuantity(id(),19);await assert.rejects(restored.clearLocalLibrary(preview),/clearChanged/);
  const confirmed=await restored.inspectLocalClear();
  const originalClear=restored.LibraryTransaction.prototype.clear;
  restored.LibraryTransaction.prototype.clear=function(table:any){if(table==='learningEvents')throw new DOMException('synthetic storage limit','QuotaExceededError');return originalClear.call(this,table);};
  await assert.rejects(restored.clearLocalLibrary(confirmed),/storageFull/);restored.LibraryTransaction.prototype.clear=originalClear;
  assert.equal((await restored.readLearning()).targets.length,3);
  const lateBytes=new TextEncoder().encode(JSON.stringify(pack.bundle)),lateDescriptor={id:pack.bundle.id,version:pack.bundle.version,title:pack.bundle.title,description:'fixture',entryCount:1,byteLength:lateBytes.length,sha256:await restored.sha256(lateBytes),url:'https://fixture.invalid/package.json'};
  let releaseDownload!:()=>void;globalThis.fetch=async()=>{await new Promise<void>(resolve=>{releaseDownload=resolve;});return new Response(lateBytes);};
  const late=restored.downloadPackage(lateDescriptor,new AbortController().signal,()=>{});
  await restored.clearLocalLibrary(confirmed);releaseDownload();await assert.rejects(late,/libraryReplaced/);await assert.rejects(restored.openLibrary(),/libraryReplaced/);
  assert.equal((await restored.readLearning()).targets.length,0);assert.equal((await restored.readLearning()).events.length,0);
  const empty=await import(pathToFileURL(join(temp,'core.mjs')).href+'?cleared');assert.notEqual((await empty.openLibrary()).id,library.id);assert.equal((await empty.inspectLocalClear()).pending,0);
  await empty.restoreLibraryBackup(exported.file,password);
  console.log('PASS: local erasure preview CAS, full transaction rollback, stale-page and late-download fences, new empty library and backup restore.');
  console.log('PASS: encrypted backup, wrong password/corruption, account and occupied-library guards, transaction rollback, fresh-library restore, preserved runtime dates/facts and new device identity.');
 }
 console.log('PASS: slow Intake/clarification/acceptance, fast acceptance, explicit membership/consent, separate generation/review, rejected material blocked, saved-candidate retry, cancellation fencing, atomic publication rollback and shared local runtime. Fake IDB/HTTP; no paid models.');
}finally{globalThis.fetch=realFetch;await rm(temp,{recursive:true,force:true});}

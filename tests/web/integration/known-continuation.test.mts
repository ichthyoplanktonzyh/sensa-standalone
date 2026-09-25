import {test} from 'vitest';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {indexedDB} from 'fake-indexeddb';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';

test("known-continuation", async () => {
const compiled=await build({stdin:{contents:[
 ...['store','learning','backupValidation'].map(name=>`export * from './apps/web/src/data/library/${name}';`),
 "export {learningSystem} from './apps/web/src/learning/system';",
 "export {contentSupplySystem} from './apps/web/src/contentSupply/system';",
 "export * from './apps/web/src/contentSupply/provisioning/hybridMaterialization';",
].join('\n'),resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',define:{'import.meta.env':'{}'}});
Object.assign(globalThis,{indexedDB,window:new EventTarget(),location:{origin:'http://127.0.0.1:9998'},BroadcastChannel:undefined});
const temp=await mkdtemp(join(tmpdir(),'sensa-supplement-'));
try{
 await writeFile(join(temp,'core.mjs'),compiled.outputFiles[0]!.text);
 const api=await import(pathToFileURL(join(temp,'core.mjs')).href),id=()=>crypto.randomUUID();
 await api.openLibrary();const account=id(),context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 await api.command({id:id(),kind:'fixture.owner',input:{}},async(tx:any)=>tx.put('meta','service-owner',{subject:account,accountId:account}));
 const ids:string[]=[];
 for(const expression of ['fragile','sustain','borrow']){
  const fixture=portablePackageFixture({packageId:id(),expression,meaning:'固定测试义项',scene:'一个具体的测试场景。'});
  const pack=await api.contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
  ids.push(...await api.enrollPackage(id(),pack.key,context));
 }
 await api.confirmLearningQuantity(id(),context,20);
 const [targetId]=ids;
 let run=await api.startLearning(id(),targetId,context,20);
 const before=await api.readLearning(),target=before.targets.find((t:any)=>t.id===targetId),membership=target.curriculumMemberships[0],pinned=structuredClone(run);
 run=await api.actLearning(id(),run.id,run.revision,{kind:'reveal'});
 run=await api.actLearning(id(),run.id,run.revision,{kind:'rate',rating:'good'});await api.finishLearning(id(),run.id);
 // Declaration continues directly to the next eligible target and does not forge learning outcomes.
 const nextId=ids[1];await api.startLearning(id(),nextId,context,20);
 const eventCount=(await api.readLearning()).events.length;
 const continued=await api.learningSystem.execute({kind:'declare_mastery_and_continue',operationId:id(),targetId:nextId,languageContext:context,dailyLimit:20});
 assert.equal(continued,true);
 let state=await api.readLearning(),declared=state.targets.find((t:any)=>t.id===nextId);
 assert.equal(state.runs.find((run:any)=>run.id===state.active)?.targetId,ids[2]);
 assert.equal(declared.completedAt,null);assert.equal(declared.memory,null);assert.equal(state.events.length,eventCount);
 assert.equal(await api.learningSystem.execute({kind:'declare_mastery_and_continue',operationId:id(),targetId:ids[2],languageContext:context,dailyLimit:20}),false);
 state=await api.readLearning();assert.equal(state.active,undefined);assert.equal(state.events.length,eventCount);
 const finalRows=await api.readLibrary(async(tx:any)=>Object.fromEntries(await Promise.all(api.libraryTables.map(async(table:string)=>[table,await tx.entries(table)]))));
 api.validateBackupRows(finalRows);
 assert.deepEqual(before.runs.find((r:any)=>r.id===pinned.id),pinned);
 console.log('PASS: resource-plan backup restore; declared-known advances queue without completion/evidence. No browser, model or TTS calls.');
}finally{await rm(temp,{recursive:true,force:true});}

});

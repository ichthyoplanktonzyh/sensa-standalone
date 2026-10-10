import {test,expect} from 'vitest';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system';
import {learningSystem} from '../../../apps/web/src/learning/system';
import {createLearningQuestionService,learningQuestionScope} from '../../../apps/web/src/learning/system/learningQuestion';
import {command,openLibrary} from '../../../apps/web/src/data/library/store';
import type {ModelMessage} from '../../../apps/web/src/data/library/transport';

test('questions pin one revealed Step, disclose no media, and cannot create learning or semantic facts',async()=>{
 Object.assign(globalThis,{window:new EventTarget(),BroadcastChannel:undefined});
 const id=()=>crypto.randomUUID(),languageContext=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 await openLibrary();await command({id:id(),kind:'fixture.owner',input:{}},async tx=>tx.put('meta','service-owner',{subject:id(),accountId:id()}));
 const fixture=portablePackageFixture({expression:'borrow'}),pack=await contentSupplySystem.execute({kind:'install_portable_package',bytes:fixture.bytes,expectedArchiveDigest:fixture.archiveDigest});
 await learningSystem.execute({kind:'enroll_package',operationId:id(),packageKey:pack.key,languageContext});
 await learningSystem.execute({kind:'confirm_quantity',operationId:id(),languageContext,dailyLimit:20});
 const ready=await learningSystem.read({kind:'workspace',languageContext});
 await learningSystem.execute({kind:'start',operationId:id(),targetId:ready.queue.nextTargetId!,languageContext,dailyLimit:20});
 const readRuntime=()=>learningSystem.read({kind:'runtime',languageContext});
 let called:ModelMessage[]=[];
 let recipientKey='teacher-1:1';const recipient=async()=>({key:recipientKey,label:'Synthetic teacher · https://teacher.invalid'});
 const answer=async(messages:ModelMessage[])=>{called=messages;return 'In this adopted sense, borrow means temporary use followed by return.';};
 const service=createLearningQuestionService({readRuntime,recipient,answer});
 const first=(await readRuntime()).runtime!;
 if(first.kind!=='lightweight')throw new Error('fixture must be lightweight');
 const input={scope:learningQuestionScope(first),languageContext,recipient:recipientKey,question:'Can I use lend instead?',history:[],signal:new AbortController().signal};
 await expect(service.ask(input)).rejects.toThrow('localFlow.stepChanged');expect(called).toEqual([]);
 await learningSystem.execute({kind:'act',operationId:id(),runId:first.runId,expectedRevision:first.revision,action:{kind:'reveal'}});
 const runtime=(await readRuntime()).runtime!;if(runtime.kind!=='lightweight')throw new Error('fixture must be lightweight');
 const before=await learningSystem.read({kind:'workspace',languageContext});
 const question={...input,scope:learningQuestionScope(runtime)};
 expect(await service.ask(question)).toContain('temporary');
 const disclosed=JSON.stringify(called);expect(disclosed).toContain('borrow');expect(disclosed).not.toMatch(/data:|audioUrl|imageUrl|learnerApprovedScene/);
 expect(await learningSystem.read({kind:'workspace',languageContext})).toEqual(before);
 await service.ask({...question,personalScene:'Not yet approved'});expect(JSON.stringify(called)).not.toContain('Not yet approved');
 await service.ask({...question,sharePersonalContext:true,personalScene:'My explicitly approved scene'});expect(JSON.stringify(called)).toContain('My explicitly approved scene');
 // Controlled projection marks adopted text as private-derived. This tests
 // disclosure, not Content Attempt grant creation/admission.
 const privateMaterial=createLearningQuestionService({recipient,answer,readRuntime:async()=>{
  const projection=await readRuntime();if(projection.runtime?.kind!=='lightweight')throw new Error('fixture must be lightweight');
  return {...projection,runtime:{...projection.runtime,questionUsesPersonalContext:true}};
 }});
 const adoptedCue=runtime.questionResources.find(resource=>resource.materialRoleKey==='experience_recall_cue')!.contentPayload.scene as string;
 await privateMaterial.ask(question);expect(JSON.stringify(called)).not.toContain(adoptedCue);
 await privateMaterial.ask({...question,sharePersonalContext:true});expect(JSON.stringify(called)).toContain(adoptedCue);
 recipientKey='teacher-2:1';called=[];
 await expect(privateMaterial.ask({...question,sharePersonalContext:true})).rejects.toThrow('localFlow.requestConfigChanged');expect(called).toEqual([]);recipientKey=input.recipient;
 const controller=new AbortController();controller.abort();called=[];
 await expect(service.ask({...question,signal:controller.signal})).rejects.toThrow();expect(called).toEqual([]);
 let release!:()=>void,started!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
 const late=createLearningQuestionService({readRuntime,recipient,answer:async()=>{started();await held;return 'Late answer';}});
 const reply=late.ask(question);const rejected=expect(reply).rejects.toThrow('localFlow.stepChanged');await entered;
 await learningSystem.execute({kind:'act',operationId:id(),runId:runtime.runId,expectedRevision:runtime.revision,action:{kind:'rate',rating:'again'}});
 release();await rejected;
 const after=await learningSystem.read({kind:'workspace',languageContext});expect(after.records).toEqual([]);expect(after.targets[0]!.nextReviewAt).toBeNull();
});

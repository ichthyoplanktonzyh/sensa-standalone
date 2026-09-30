import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'vitest';
import {unzipSync,zipSync} from 'fflate';
import {portableBookMemberPath} from '@sensa/content-validator/portable-book';
import {defaultSensaLanguageRoute,sensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import {contentSupplySystem} from '../../../apps/web/src/contentSupply/system/index.ts';
import {learningSystem} from '../../../apps/web/src/learning/system/index.ts';
import {portableBookDeliveryFixture} from '../../../scripts/support/portablePackageFixture.mts';

test('Book update rejection and cancellation preserve installed content before explicit idempotent enrollment',async()=>{
 Object.assign(globalThis,{window:new EventTarget(),location:new URL('https://sensa.fixture.invalid/'),BroadcastChannel:undefined});
 const packageId=crypto.randomUUID();
 const previous=portableBookDeliveryFixture({packageId,memberExpressions:['borrow','water','drink']});
 const update=portableBookDeliveryFixture({packageId,version:2,memberExpressions:['borrow','water','drink']});
 const responses=new Map([...previous.responses,...update.responses]);
 const realFetch=globalThis.fetch;
 globalThis.fetch=async input=>{
  const bytes=responses.get(String(input));
  return bytes?new Response(bytes):new Response(null,{status:404});
 };
 const install=(descriptor:typeof previous.descriptor,signal=new AbortController().signal,onProgress=(_fraction:number)=>{})=>contentSupplySystem.execute({kind:'install_catalog_item',descriptor,signal,onProgress});
 const context=sensaPinnedLanguageContext(defaultSensaLanguageRoute);
 try{
  await install(previous.descriptor);
  const installed=await contentSupplySystem.read({kind:'workspace'});
  assert.equal(installed.packages.length,3);
  assert.equal((await learningSystem.read({kind:'workspace',languageContext:context})).targets.length,0,'installation must not create learning targets');

  const files=unzipSync(update.bookBytes);
  files[portableBookMemberPath(update.manifest.members.at(-1)!)]=new TextEncoder().encode('invalid final member');
  const malformed=zipSync(files);
  const hash=createHash('sha256').update(malformed).digest('hex');
  const descriptor={...update.descriptor,sha256:hash,byteLength:malformed.byteLength,url:`https://content.fixture.invalid/${hash}.sensa-book`};
  responses.set(descriptor.url,malformed);
  await assert.rejects(install(descriptor),/localFlow\.catalogMismatch/u);
  assert.deepEqual(await contentSupplySystem.read({kind:'workspace'}),installed);

  const cancel=new AbortController();
  globalThis.fetch=async()=>new Response(new ReadableStream({
   start(controller){
    controller.enqueue(update.bookBytes.subarray(0,Math.floor(update.bookBytes.length/2)));
    controller.enqueue(update.bookBytes.subarray(Math.floor(update.bookBytes.length/2)));
    controller.close();
   },
  }));
  await assert.rejects(install(update.descriptor,cancel.signal,fraction=>{if(fraction>0&&fraction<1)cancel.abort();}),/localFlow\.downloadCancelled/u);
  assert.deepEqual(await contentSupplySystem.read({kind:'workspace'}),installed);
  globalThis.fetch=async input=>new Response(responses.get(String(input))!);
  await install(update.descriptor);
  assert.equal((await contentSupplySystem.read({kind:'workspace'})).packages.filter(pack=>pack.portableOrigin.manifest.metadata.version===2).length,3);
  assert.equal((await learningSystem.read({kind:'workspace',languageContext:context})).targets.length,0);

  await learningSystem.execute({kind:'confirm_quantity',operationId:crypto.randomUUID(),languageContext:context,dailyLimit:20});
  const enroll=()=>learningSystem.execute({kind:'enroll_book',operationId:crypto.randomUUID(),languageContext:context,publicationArchiveSha256:update.descriptor.sha256});
  await enroll();
  const first=await learningSystem.read({kind:'workspace',languageContext:context});
  assert.equal(first.targets.length,3);
  assert.equal(first.enrollments.length,1);
  await enroll();
  const repeated=await learningSystem.read({kind:'workspace',languageContext:context});
  assert.deepEqual(repeated.targets.map(target=>target.targetId).sort(),first.targets.map(target=>target.targetId).sort());
  assert.deepEqual(repeated.enrollments,first.enrollments);
 }finally{globalThis.fetch=realFetch;}
});

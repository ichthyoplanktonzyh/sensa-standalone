import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {defaultReadingAssignments,canonicalConsumerJson} from '@sensa/contracts/sensa';
import {localSettings,saveLocalSettings,localConnectionFor,runLocalReading,localModels} from '../../../apps/browser-extension/src/localModels.ts';

test('an account-free extension keeps model credentials local and calls only the permitted provider',async()=>{
 const values:Record<string,unknown>={};
 const permitted=new Set<string>();
 const calls:{url:string;authorization:string;body:unknown}[]=[];
 let semanticResponse='{"proposal":null}';
 const formerChrome=(globalThis as any).chrome,formerFetch=globalThis.fetch;
 (globalThis as any).chrome={
  storage:{local:{get:async(key:string)=>({[key]:structuredClone(values[key])}),set:async(next:Record<string,unknown>)=>Object.assign(values,structuredClone(next))}},
  permissions:{contains:async({origins}:{origins:string[]})=>origins.every(origin=>permitted.has(origin))},
 };
 globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(input),authorization:new Headers(init?.headers).get('authorization')??'',body:init?.body?JSON.parse(String(init.body)):null});
  if(String(input).endsWith('/models'))return Response.json({data:[{id:'test-model'}]});
  return Response.json({choices:[{message:{content:(calls.at(-1)?.body as any)?.response_format?semanticResponse:'Translated text'}}]});
 };
 try{
  const id=crypto.randomUUID(),baseUrl='https://models.example.test/v1',origin='https://models.example.test/*';
  const provider={id,name:'My model',baseUrl,model:'test-model',enabled:true,apiKey:'private-device-key'};
  const assignments={...defaultReadingAssignments,selection:id};
  await expect(saveLocalSettings({expectedRevision:0,providers:[provider],assignments})).rejects.toThrow('provider_permission_required');
  expect(values.sensaLocalModels).toBeUndefined();
  permitted.add(origin);
  const saved=await saveLocalSettings({expectedRevision:0,providers:[provider],assignments});
  expect(saved.providers[0]).toMatchObject({id,keyConfigured:true});
  expect(JSON.stringify(saved)).not.toContain(provider.apiKey);
  expect((values.sensaLocalModels as any).providers[0].apiKey).toBe(provider.apiKey);
  await expect(saveLocalSettings({expectedRevision:0,providers:[provider],assignments})).rejects.toThrow('settings_conflict');
  const preserved=await saveLocalSettings({expectedRevision:1,providers:[{...provider,apiKey:undefined}],assignments});
  expect(preserved.revision).toBe(2);
  const concurrent=await Promise.allSettled([
   saveLocalSettings({expectedRevision:2,providers:[{...provider,apiKey:undefined}],assignments}),
   saveLocalSettings({expectedRevision:2,providers:[{...provider,apiKey:undefined}],assignments}),
  ]);
  expect(concurrent.map(result=>result.status).sort()).toEqual(['fulfilled','rejected']);
  expect((await localSettings()).revision).toBe(3);
  const connection=await localConnectionFor('selection');
  expect(connection?.id).toBe(id);
  const result=await runLocalReading(connection!,{id:crypto.randomUUID(),feature:'selection',text:'Hello',context:'A page',instruction:'',languages:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},sourceLanguageTag:'en',glossary:[]});
  expect(result).toEqual({status:'ready',text:'Translated text',error:null});
  expect((await localModels(id)).models).toEqual(['test-model']);
  const {runLocalLookup}=await import('../../../apps/browser-extension/src/localModels.ts');
  const snapshot={sentence:'She took her time.',language:'en',languageSource:'detector' as const,languageConfidence:.9,source:{url:'https://example.test/article',title:'Article',capturedAt:new Date().toISOString()},expression:null};
  const languages={targetLanguageTag:'en',supportLanguageTag:'zh-CN',languageRouteId:crypto.randomUUID(),languageRouteRevision:1};
  const lookup=await runLocalLookup(connection!,crypto.randomUUID(),snapshot,languages);
  expect(lookup).toMatchObject({status:'unresolved',proposal:null,provenance:null});
  semanticResponse='{"proposal":{"unsupported":true}}';
  await expect(runLocalLookup(connection!,crypto.randomUUID(),snapshot,languages)).rejects.toThrow('model_invalid_response');
  expect(calls.map(call=>call.url)).toEqual([baseUrl+'/chat/completions',baseUrl+'/models',baseUrl+'/chat/completions',baseUrl+'/chat/completions']);
  expect(calls.every(call=>call.authorization==='Bearer '+provider.apiKey)).toBe(true);
  expect(JSON.stringify(calls[0]?.body)).toContain('Hello');
  permitted.delete(origin);
  await expect(localConnectionFor('selection')).rejects.toThrow('provider_permission_required');
  expect((await localSettings()).providers[0]?.keyConfigured).toBe(true);
 }finally{globalThis.fetch=formerFetch;(globalThis as any).chrome=formerChrome;}
});

test('guest captures keep only a bounded receipt history after repeated Web delivery',async()=>{
 const values:Record<string,unknown>={};
 const formerChrome=(globalThis as any).chrome;
 (globalThis as any).chrome={storage:{local:{get:async(key:string)=>({[key]:structuredClone(values[key])}),set:async(next:Record<string,unknown>)=>Object.assign(values,structuredClone(next))}}};
 try{
  const {bindLocalLibrary,queueLocalCapture,pendingLocal,acknowledgeLocal,localIntakeStatus}=await import('../../../apps/browser-extension/src/localIntake.ts');
  const libraryId=crypto.randomUUID(),clientId=crypto.randomUUID();
  await bindLocalLibrary(libraryId);
  const snapshot={sentence:'Slow mornings suit her.',language:'en',languageSource:'detector' as const,languageConfidence:.9,source:{url:'https://example.test/article',title:'Article',capturedAt:new Date().toISOString()},expression:null};
  for(let index=0;index<101;index++){
   const operationId=crypto.randomUUID();
   expect((await queueLocalCapture(operationId,snapshot,null,null)).savedLocally).toBe(true);
   const [request]=await pendingLocal(libraryId,clientId);
   expect(request?.intake.operationId).toBe(operationId);
   const requestDigest=createHash('sha256').update(canonicalConsumerJson(request)).digest('hex');
   await acknowledgeLocal({contractVersion:'sensa-browser-intake-delivery-v1',libraryId,clientId,operationId,requestDigest,result:{route:'inbox',intakeId:crypto.randomUUID(),status:'pending_sense'},appliedAt:new Date().toISOString()});
  }
  expect((await localIntakeStatus()).pending).toBe(0);
  expect((await localIntakeStatus()).recent).toHaveLength(20);
  expect((values.sensaLocalIntake as unknown[]).length).toBeLessThanOrEqual(21);
 }finally{(globalThis as any).chrome=formerChrome;}
});

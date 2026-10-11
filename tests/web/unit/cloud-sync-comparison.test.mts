import {test,expect} from 'vitest';
import {buildCloudSyncComparison} from '../../../apps/web/src/data/library/cloudSyncComparison';
import {encodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import type {LibraryReplicaEntry} from '../../../apps/web/src/data/library/replication/libraryReplica';
import {MemoryJourneyRepository} from '../../../apps/web/src/experience/personalMeaningJourney/repository';
import {createJourneyModules} from '../../../apps/web/src/experience/personalMeaningJourney/gateway';
import {semanticLookupPayload,deleteFirstMeaning} from '../support/semanticLookupFixtures';
import {semanticRecords} from '../support/semanticWorldRecordFixture.mts';

const id=(table:string,key:string)=>JSON.stringify([table,key]);
const branch=(rows:Iterable<{table:LibraryReplicaEntry['table'];key:string;value:unknown}>)=>new Map([...rows].map(row=>[id(row.table,row.key),{...row,value:encodeBackupValue(row.value)}]));
test('Scene previews show each original branch body and image, with its own expression label',()=>{
 const key=id('annotations','scene'),rows=(body:string,url:string,expression:string)=>branch([
  {table:'annotations',key:'scene',value:{kind:'learning_scene',learningTargetId:'target',currentRevision:2,revisions:[{revision:1,body:'Old context',media:[]},{revision:2,body,media:[{dataUrl:url}]}]}},
  {table:'learningTargets',key:'target',value:{expression}},
 ]);
 const result=buildCloudSyncComparison([key],{base:branch([]),local:rows('Red umbrella','data:image/png;base64,red','borrow'),remote:rows('Blue umbrella','data:image/png;base64,blue','borrow an umbrella')});
 expect(result.records[0]!.local).toMatchObject({available:true,title:'borrow',fields:[{label:'expression',text:'borrow'},{label:'context',text:'Red umbrella'}]});
 expect(result.records[0]!.remote).toMatchObject({available:true,title:'borrow an umbrella',fields:[{label:'expression',text:'borrow an umbrella'},{label:'context',text:'Blue umbrella'}]});
 expect(result.images[result.records[0]!.local.images[0]!]).toBe('data:image/png;base64,red');expect(result.images[result.records[0]!.remote.images[0]!]).toBe('data:image/png;base64,blue');
});
test('each Meaning preview reads its own branch Registry and retains Context and semantic boundaries',async()=>{
 const repository=new MemoryJourneyRepository();await createJourneyModules({repository}).semanticIntake.submit(semanticLookupPayload());
 const base=await repository.load(),local=structuredClone(base),remote=structuredClone(base);
 local.registry.senseVersions[0]!.semanticSpec.coreMeaningFocus='Local: temporarily borrow an umbrella.';
 remote.registry.senseVersions[0]!.semanticSpec.coreMeaningFocus='Remote: borrow the umbrella and return it tomorrow.';
 remote.registry.expressionVersions[0]!.surfaceForm='borrow an umbrella';
 const key=id('semanticMeanings',base.meanings[0]!.personalMeaning.personalMeaningId);
 const result=buildCloudSyncComparison([key],{base:branch(semanticRecords(base)),local:branch(semanticRecords(local)),remote:branch(semanticRecords(remote))}).records[0]!;
 expect(result.local.available).toBe(true);expect(result.remote.available).toBe(true);
 expect(result.local.fields).toContainEqual({label:'meaning',text:'Local: temporarily borrow an umbrella.'});
 expect(result.remote.fields).toContainEqual({label:'meaning',text:'Remote: borrow the umbrella and return it tomorrow.'});
 expect(result.base.fields).toContainEqual({label:'meaning',text:base.registry.senseVersions[0]!.semanticSpec.coreMeaningFocus});
 expect(result.remote.title).toBe('borrow an umbrella');expect(result.local.title).toBe('borrow');
 expect(result.local.fields).toContainEqual({label:'context',text:'Private source: May asked to borrow an umbrella.'});
 expect(result.local.fields).toContainEqual({label:'excluded',text:'永久赠送'});
 const deleted=buildCloudSyncComparison([key],{base:branch(semanticRecords(base)),local:branch(semanticRecords(deleteFirstMeaning(base))),remote:branch(semanticRecords(remote))});
 expect(deleted.records[0]!.local.removed).toBe(true);expect(deleted.records[0]!.remote.removed).toBe(false);
 const missing=branch(semanticRecords(base));for(const [id,row] of missing)if(row.table==='semanticRegistry')missing.delete(id);
 expect(buildCloudSyncComparison([key],{base:missing,local:missing,remote:missing}).records[0]!.local.available).toBe(false);
 const sparse=structuredClone(base.meanings[0]!);
 for(const name of Object.keys(sparse))if(Array.isArray((sparse as any)[name]))(sparse as any)[name]=[];
 const empty=branch([{table:'semanticMeanings',key:sparse.personalMeaning.personalMeaningId,value:sparse}]);
 expect(buildCloudSyncComparison([key],{base:empty,local:empty,remote:empty}).records[0]!.local.available).toBe(false);
});

test('Drafts show actual text and absent versions are explicit; unsupported facts never expose raw JSON',()=>{
 const key=id('drafts','draft-one'),opaque=id('meta','private-key');
 const result=buildCloudSyncComparison([key,opaque],{
  base:branch([{table:'drafts',key:'draft-one',value:{text:'Before'}}]),
  local:branch([{table:'drafts',key:'draft-one',value:{text:'On this device'}},{table:'meta',key:'private-key',value:{secret:'do not display raw JSON'}}]),
  remote:branch([]),
 });
 expect(result.records[0]!.local.fields).toEqual([{label:'content',text:'On this device'}]);
 expect(result.records[0]!.base.fields).toEqual([{label:'content',text:'Before'}]);
 expect(result.records[0]!.remote).toMatchObject({available:true,removed:true,fields:[]});
 expect(result.records[1]!.local).toMatchObject({available:false,fields:[],title:null});
 expect(JSON.stringify(result)).not.toContain('do not display raw JSON');
});

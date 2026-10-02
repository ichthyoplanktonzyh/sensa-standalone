import assert from 'node:assert/strict';
import {test,vi} from 'vitest';
import {readSensaPortableLightweightPackage} from '@sensa/content-validator/portable-lightweight';
import {portablePackageFixture} from '../../../scripts/support/portablePackageFixture.mts';
import {prepareStandalonePortablePackage} from '../../../apps/web/src/contentSupply/portable/portablePreparation.ts';

const state=vi.hoisted(()=>({task:null as unknown,target:null as unknown}));
vi.mock('../../../apps/web/src/data/library/store.ts',()=>({
 openLibrary:async()=>{},
 readLibrary:async(work:(tx:{get:(table:string)=>Promise<unknown>})=>unknown)=>work({get:async(table:string)=>table==='personalLearning'?state.task:state.target}),
}));
import {exportPersonalPortablePackage} from '../../../apps/web/src/contentSupply/portable/personalPortablePackage.ts';

test('selected personal image pixels can be shared without disclosing the original private filename or image identity',async()=>{
 const fixture=portablePackageFixture();
 const content=structuredClone(prepareStandalonePortablePackage(fixture.bytes,readSensaPortableLightweightPackage(fixture.bytes).archiveDigest).content.entries[0]!.content);
 const cue=content.resources.find(item=>item.materialRoleKey==='experience_recall_cue')!;
 const fileName='Private-address-Apartment-704.png';
 const imageId='private-local-image-identity';
 const image=Uint8Array.from([137,80,78,71,13,10,26,10]);
 cue.contentPayload.images=[{id:imageId,name:fileName,dataUrl:`data:image/png;base64,${Buffer.from(image).toString('base64')}`}];
 state.task={id:'c03e321c-5fe9-4e73-843e-918bfb692fa8',status:'ready',targetId:'private-target',curriculumMembershipId:'private-membership',languageContext:{targetLanguageTag:'en',supportLanguageTag:'zh-CN'},source:{senseId:'borrow-temporarily'}};
 state.target={curriculumMemberships:[{id:'private-membership',revision:1,material:{content,snapshot:{createdAt:'2026-10-01T00:00:00.000Z'}}}]};
 const output=await exportPersonalPortablePackage('c03e321c-5fe9-4e73-843e-918bfb692fa8');
 const archive=readSensaPortableLightweightPackage(output.bytes);
 const exportedImage=archive.package.resources.experienceRecallCue.images![0]!;
 assert.equal(exportedImage.altText,'Learning image 1');
 assert.deepEqual(archive.mediaById.get(exportedImage.mediaId),image,'selected material image content is preserved');
 for(const privateValue of [fileName,imageId,'private-target','private-membership'])assert(!JSON.stringify(archive.package).includes(privateValue));
 assert.equal((cue.contentPayload.images as {name:string}[])[0]!.name,fileName,'export never rewrites the local material');
});

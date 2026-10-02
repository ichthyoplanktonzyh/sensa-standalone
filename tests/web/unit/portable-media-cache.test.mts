import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'vitest';
import {externalizePortablePackageCache,hydratePortablePackageCache} from '../../../apps/web/src/data/library/portableMediaCache.ts';

const bytes=Uint8Array.from({length:1024*1024+7},(_,i)=>(i*17+11)%256);
const digest=createHash('sha256').update(bytes).digest('hex');
const dataUrl=`data:audio/mpeg;base64,${Buffer.from(bytes).toString('base64')}`;
const declaration={mediaId:'sound',kind:'audio' as const,mimeType:'audio/mpeg',sizeBytes:bytes.length,sha256:digest};
const record=(url=dataUrl,media=declaration)=>({portableOrigin:{manifest:{media:[media]}},content:{audioUrl:url},untouched:'plain text'});

test('large media decoding preserves exact bytes across base64 chunks and verifies native SHA-256',async()=>{
 const value=record();
 const result=await externalizePortablePackageCache('fixture',value);
 assert.deepEqual(result.write.media[0]?.bytes,bytes);
 assert.equal(result.write.media[0]?.sha256,digest);
 assert.equal(JSON.stringify(result.storedValue).includes('data:audio/'),false);
 assert.equal(value.content.audioUrl,dataUrl,'conversion does not mutate caller material');
});

test('hydration verifies cold blobs and preserves base64 chunk boundaries',async()=>{
 const coldBytes=bytes.slice();coldBytes[0]^=1;
 const coldDigest=createHash('sha256').update(coldBytes).digest('hex');
 const reference={audio:{$sensaPortableMedia:{format:'sensa-portable-media-reference-v1',sha256:coldDigest,mimeType:'audio/mpeg'}}};
 let reads=0;
 const hydrated=await hydratePortablePackageCache(reference,async requested=>{
  reads++;assert.equal(requested,coldDigest);return {sha256:coldDigest,sizeBytes:coldBytes.length,bytes:coldBytes};
 });
 assert.equal(reads,1);
 assert.deepEqual(hydrated,{audio:`data:audio/mpeg;base64,${Buffer.from(coldBytes).toString('base64')}`});
 const badReference={audio:{$sensaPortableMedia:{format:'sensa-portable-media-reference-v1',sha256:'f'.repeat(64),mimeType:'audio/mpeg'}}};
 await assert.rejects(hydratePortablePackageCache(badReference,async()=>({sha256:'f'.repeat(64),sizeBytes:bytes.length,bytes})),/portable_media_blob_invalid/u);
});

test('malformed or mismatched large media cannot enter the portable cache',async()=>{
 const corrupt=dataUrl.slice(0,300_000)+'!'+dataUrl.slice(300_001);
 await assert.rejects(externalizePortablePackageCache('fixture',record(corrupt)),/portable_media_bytes_missing/u);
 await assert.rejects(externalizePortablePackageCache('fixture',record(dataUrl,{...declaration,sizeBytes:bytes.length+1})),/portable_media_declaration_mismatch/u);
 await assert.rejects(externalizePortablePackageCache('fixture',record(dataUrl,{...declaration,sha256:'e'.repeat(64)})),/portable_media_bytes_missing/u);
});

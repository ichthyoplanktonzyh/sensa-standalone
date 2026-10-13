import assert from 'node:assert/strict';
import {test} from 'vitest';
import {gzipSync} from 'fflate';
import {sha256} from '@sensa/learning-kernel';
import {librarySyncBlockChars} from '../../../packages/contracts/src/sensa/librarySync.ts';
import {decodeLibrarySyncBlock,encodeLibrarySyncBlock,librarySyncRecordSegments,splitLibrarySyncText,encodeLibrarySyncBinaryChunk,decodeLibrarySyncBinaryChunk,librarySyncBinaryChunkBytes} from '../../../packages/contracts/src/sensa/librarySyncBlocks.ts';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec.ts';

test('transport body sharing preserves each exact row and never merges facts or user keys',()=>{
 const content={text:'语境中的含义 🧠'.repeat(150),nested:{'$sensa':'ordinary user text'}};
 const rows=[{id:'initial',at:new Date('2026-10-05T00:00:00Z'),content,unset:undefined},{id:'review',at:new Date('2026-10-06T00:00:00Z'),content,unset:undefined}];
 const segments=rows.map(row=>librarySyncRecordSegments(encodeBackupValue(row)));
 rows.forEach((row,index)=>{assert.equal(segments[index].join(''),JSON.stringify(encodeBackupValue(row)));assert.deepEqual(decodeBackupValue(JSON.parse(segments[index].map(segment=>splitLibrarySyncText(segment).map(encodeLibrarySyncBlock).map(decodeLibrarySyncBlock).join('')).join(''))),row);});
 assert.equal(segments[0][1],segments[1][1]);assert.notEqual(segments[0][0],segments[1][0]);
 assert.equal(encodeLibrarySyncBlock(segments[0][1]),encodeLibrarySyncBlock(segments[1][1]),'unchanged content has deterministic compressed bytes');
});

test('UTF-8 compression does not lose a surrogate pair at the block boundary',()=>{
 const text='x'.repeat(librarySyncBlockChars-1)+'🧠中文'+'y'.repeat(librarySyncBlockChars);
 const parts=splitLibrarySyncText(text);assert.equal(parts[0].length,librarySyncBlockChars-1);
 assert.equal(parts.map(encodeLibrarySyncBlock).map(decodeLibrarySyncBlock).join(''),text);
 assert.throws(()=>encodeLibrarySyncBlock('\ud800'),/library_sync_format/u);
 assert.throws(()=>decodeLibrarySyncBlock('\ud800'),/library_sync_format/u);
 const bom='\ufeff'+'x'.repeat(4096);assert.equal(decodeLibrarySyncBlock(encodeLibrarySyncBlock(bom)),bom);
 assert.equal(decodeLibrarySyncBlock('\ufeffplain'), '\ufeffplain');
 assert.throws(()=>encodeLibrarySyncBlock('x'.repeat(librarySyncBlockChars+1)),/library_sync_format/u);
});

test('corrupt and forged compressed blocks fail before any row can be parsed',()=>{
 const text='x'.repeat(4096),packed=JSON.parse(encodeLibrarySyncBlock(text));
 assert.equal(decodeLibrarySyncBlock(JSON.stringify(packed)),text);
 assert.throws(()=>decodeLibrarySyncBlock(JSON.stringify([packed[0],'0'.repeat(64),packed[2]])),/library_sync_format/u);
 assert.throws(()=>decodeLibrarySyncBlock(JSON.stringify([packed[0],packed[1],'not base64'])),/library_sync_format/u);
 const bytes=gzipSync(new TextEncoder().encode(text),{mtime:0});
 const badCrc=bytes.slice();badCrc[badCrc.length-8]^=1;
 assert.throws(()=>decodeLibrarySyncBlock(JSON.stringify([packed[0],packed[1],btoa(String.fromCharCode(...badCrc))])),/library_sync_format/u);
 // A forged footer plus digest of only the prefix must not turn truncated
 // inflation into accepted content.
 new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint32(bytes.length-4,2,true);
 const forged=JSON.stringify([packed[0],sha256('xx'),btoa(String.fromCharCode(...bytes))]);
 assert.throws(()=>decodeLibrarySyncBlock(forged),/library_sync_format/u);
 new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint32(bytes.length-4,librarySyncBlockChars*3+1,true);
 assert.throws(()=>decodeLibrarySyncBlock(JSON.stringify([packed[0],packed[1],btoa(String.fromCharCode(...bytes))])),/library_sync_format/u);
});

test('private shared representation emits the exact logical wire without exposing storage references',async()=>{
 const {externalizeSharedRecordContent}=await import('../../../apps/web/src/data/library/sharedRecordContent');
 const value=encodeBackupValue({id:'source',content:{text:'Exact retained material '.repeat(100)},protocolBinding:{id:'immutable',rules:'pinned rule '.repeat(100)}}),shared=externalizeSharedRecordContent(value);
 const segments=librarySyncRecordSegments(shared.value,digest=>{const body=shared.bodies.get(digest);assert.ok(body);return body;});
 assert.equal(segments.join(''),JSON.stringify(value));assert.ok(!segments.join('').includes('sensa-shared-content-v1'));
 assert.throws(()=>librarySyncRecordSegments(shared.value),/library_sync_format/u);
});
test('binary chunks are exact, bounded and reject corrupt digest/CRC, extra members and forged inflation',async()=>{
 const bytes=Uint8Array.from({length:librarySyncBinaryChunkBytes},(_,i)=>(i*137+i*i)%256),encoded=await encodeLibrarySyncBinaryChunk(bytes);assert.ok(encoded.length<=librarySyncBlockChars);assert.deepEqual(decodeLibrarySyncBinaryChunk(encoded),bytes);assert.equal(await encodeLibrarySyncBinaryChunk(bytes),encoded);
 await assert.rejects(encodeLibrarySyncBinaryChunk(new Uint8Array(librarySyncBinaryChunkBytes+1)),/library_sync_format/u);
 const value=JSON.parse(encoded);assert.throws(()=>decodeLibrarySyncBinaryChunk(JSON.stringify([...value.slice(0,2),'f'.repeat(64),value[3]])),/library_sync_format/u);assert.throws(()=>decodeLibrarySyncBinaryChunk(JSON.stringify([value[0],librarySyncBinaryChunkBytes+1,value[2],value[3]])),/library_sync_format/u);
 const pack=(chunk:Uint8Array)=>{let text='';for(let at=0;at<chunk.length;at+=16384)text+=String.fromCharCode(...chunk.subarray(at,at+16384));return btoa(text);};
 const packed=Uint8Array.from(atob(value[3]),c=>c.charCodeAt(0)),crc=packed.slice();crc[crc.length-8]^=1;assert.throws(()=>decodeLibrarySyncBinaryChunk(JSON.stringify([value[0],value[1],value[2],pack(crc)])),/library_sync_format/u);
 const extra=gzipSync(new Uint8Array(1),{mtime:0}),members=new Uint8Array(packed.length+extra.length);members.set(packed);members.set(extra,packed.length);assert.throws(()=>decodeLibrarySyncBinaryChunk(JSON.stringify([value[0],value[1],value[2],pack(members)])),/library_sync_format/u);
 const forged=packed.slice();new DataView(forged.buffer).setUint32(forged.length-4,2,true);assert.throws(()=>decodeLibrarySyncBinaryChunk(JSON.stringify([value[0],2,sha256(bytes.subarray(0,2)),pack(forged)])),/library_sync_format/u);
});

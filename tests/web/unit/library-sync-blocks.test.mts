import assert from 'node:assert/strict';
import {test} from 'vitest';
import {gzipSync} from 'fflate';
import {sha256} from '@sensa/learning-kernel';
import {librarySyncBlockChars} from '../../../packages/contracts/src/sensa/librarySync.ts';
import {decodeLibrarySyncBlock,encodeLibrarySyncBlock,librarySyncRecordSegments,splitLibrarySyncText} from '../../../packages/contracts/src/sensa/librarySyncBlocks.ts';
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

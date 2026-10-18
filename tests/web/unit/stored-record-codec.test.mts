import {test,expect} from 'vitest';
import {gzipSync,strToU8} from 'fflate';
import {sha256} from '@sensa/learning-kernel';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {packStoredRecord,unpackStoredRecord,StoredRecordMemo,externalizeSharedRecordContent,expandSharedRecordContent} from '../../../apps/web/src/data/library/sharedRecordContent';

// Platform variation at the existing codec seam, not a new product setting.
for(const encode of [false,true])for(const decode of [false,true])test.skipIf(encode&&typeof Reflect.get(Uint8Array.prototype,'toBase64')!=='function'||decode&&typeof Reflect.get(Uint8Array,'fromBase64')!=='function')(`stored records roundtrip exact UTF-8 bytes with native base64 encode=${encode}, decode=${decode}`,()=>{
 const encoder=Object.getOwnPropertyDescriptor(Uint8Array.prototype,'toBase64'),decoder=Object.getOwnPropertyDescriptor(Uint8Array,'fromBase64');
 if(encode)expect(typeof encoder?.value).toBe('function');if(decode)expect(typeof decoder?.value).toBe('function');
 try{
  if(!encode)Object.defineProperty(Uint8Array.prototype,'toBase64',{configurable:true,value:undefined});
  if(!decode)Object.defineProperty(Uint8Array,'fromBase64',{configurable:true,value:undefined});
  const value={text:('汉字🙂\u0000'+Array.from({length:256},(_,index)=>String.fromCodePoint(index)).join('')).repeat(100),date:new Date('2026-10-09T00:00:00.000Z'),optional:undefined,nested:{$sensa:'shared',value:'literal user object'}};
  const plain=JSON.stringify(encodeBackupValue(value)),packed=packStoredRecord(plain);
  const envelope=JSON.parse(packed);expect(envelope[0]).toBe('sensa-record-gzip-v1');expect(envelope[1]).toBe(sha256(strToU8(plain)));
  expect(btoa(atob(envelope[2]))).toBe(envelope[2]);
  expect(unpackStoredRecord(packed)).toBe(plain);expect(decodeBackupValue(JSON.parse(unpackStoredRecord(packed)))).toEqual(value);
  // The legacy writer can feed either reader, without a wire-format change.
  const compressed=gzipSync(strToU8(plain));let binary='';for(const byte of compressed)binary+=String.fromCharCode(byte);
  const legacy=JSON.stringify(['sensa-record-gzip-v1',sha256(strToU8(plain)),btoa(binary)]);
  expect(unpackStoredRecord(legacy)).toBe(plain);
  for(const bad of [JSON.stringify([envelope[0],'0'.repeat(64),envelope[2]]),JSON.stringify([envelope[0],envelope[1],'bad#base64']),JSON.stringify([envelope[0],envelope[1],btoa('not a gzip body')])])expect(()=>unpackStoredRecord(bad)).toThrow();
 }finally{
  if(encoder)Object.defineProperty(Uint8Array.prototype,'toBase64',encoder);else Reflect.deleteProperty(Uint8Array.prototype,'toBase64');
  if(decoder)Object.defineProperty(Uint8Array,'fromBase64',decoder);else Reflect.deleteProperty(Uint8Array,'fromBase64');
 }
});

test('short uncompressed records remain byte-for-byte opaque',()=>{
 for(const text of ['["undefined"]','["string","短内容🙂"]','{"unusual":"valid JSON"}'])expect(unpackStoredRecord(packStoredRecord(text))).toBe(text);
});

test('activation memo preserves strict digest, wire and collision checks after exact repeated text',()=>{
 const memo=new StoredRecordMemo(),plain=JSON.stringify(encodeBackupValue({content:{text:'retained🙂'.repeat(1024)}})),packed=packStoredRecord(plain);
 expect(unpackStoredRecord(packed,memo)).toBe(plain);expect(unpackStoredRecord(packed,memo)).toBe(plain);
 const envelope=JSON.parse(packed);envelope[1]='0'.repeat(64);
 for(let retry=0;retry<2;retry++)expect(()=>unpackStoredRecord(JSON.stringify(envelope),memo)).toThrow('sqlite_shared_content_invalid');
 const wire=encodeBackupValue({content:{text:'retained🙂'.repeat(1024)}}),shared=externalizeSharedRecordContent(wire,memo);
 expect(externalizeSharedRecordContent(wire,memo)).toEqual(shared);
 expect(expandSharedRecordContent(shared.value,digest=>shared.bodies.get(digest),memo)).toEqual(wire);
 expect(()=>expandSharedRecordContent(shared.value,()=>JSON.stringify(encodeBackupValue({text:'altered'.repeat(1024)})),memo)).toThrow('sqlite_shared_content_invalid');
 expect(()=>externalizeSharedRecordContent(shared.value,memo)).toThrow('libraryBackup.errors.format');
 memo.clear();expect(unpackStoredRecord(packed,memo)).toBe(plain);
});

test('activation memo bounds UTF-8 keys plus results, bypasses large values and clears failed work',()=>{
 const memo=new StoredRecordMemo(12,2);let calls=0;
 const read=(kind:'hash'|'unpack',input:string,output:string)=>memo.transform(kind,input,()=>{calls++;return output;});
 expect(read('hash','汉','🙂')).toBe('🙂');expect(read('hash','汉','🙂')).toBe('🙂');expect(calls).toBe(1);
 read('unpack','汉','🙂');expect(calls).toBe(2); // 7+7 UTF-8 bytes evicts the first key.
 read('hash','汉','🙂');expect(calls).toBe(3);
 for(let i=0;i<2;i++)read('hash','large','a'.repeat(13));expect(calls).toBe(5);
 for(let i=0;i<2;i++)expect(()=>memo.transform('hash','failed',()=>{calls++;throw Error('failed');})).toThrow('failed');expect(calls).toBe(7);
 memo.clear();read('hash','汉','🙂');expect(calls).toBe(8);
 const count=new StoredRecordMemo(1000,2);let countCalls=0;
 const hit=(key:string)=>count.transform('hash',key,()=>{countCalls++;return key;});
 hit('a');hit('b');hit('a');hit('c');hit('b');expect(countCalls).toBe(4);
});

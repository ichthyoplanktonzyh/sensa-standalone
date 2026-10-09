import {test,expect} from 'vitest';
import {gzipSync,strToU8} from 'fflate';
import {sha256} from '@sensa/learning-kernel';
import {encodeBackupValue,decodeBackupValue} from '../../../apps/web/src/data/library/backupCodec';
import {packStoredRecord,unpackStoredRecord} from '../../../apps/web/src/data/library/sharedRecordContent';

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

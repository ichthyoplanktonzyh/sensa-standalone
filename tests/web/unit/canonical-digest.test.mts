import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'vitest';
import {sha256,canonicalJsonDigest} from '@sensa/learning-kernel';

test('synchronous digests preserve standard UTF-8, surrogate and block-boundary behavior',()=>{
 for(const text of ['', 'abc', '你好', '𠮷🙂', '\ud800', '\udc00', '\ud800a\udc00', ...[55,56,63,64,65,127,128,65536].map(size=>'a'.repeat(size))]){
  const expected=createHash('sha256').update(text,'utf8').digest('hex');
  assert.equal(sha256(text),expected);
  assert.equal(sha256(new TextEncoder().encode(text)),expected);
 }
 const value={audioUrl:'data:audio/mpeg;base64,'+'a'.repeat(70_000),meaning:'你好🙂'};
 assert.equal(canonicalJsonDigest(value),createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex'));
 const original=canonicalJsonDigest(value);
 assert.equal(canonicalJsonDigest(structuredClone(value)),original);
 value.audioUrl+='b';
 assert.notEqual(canonicalJsonDigest(value),original,'a changed resource must not reuse an object-identity digest');
 for(let index=0;index<48;index++){
  const entry={audioUrl:'data:audio/mpeg;base64,'+'c'.repeat(70_000)+index};
  assert.equal(canonicalJsonDigest(entry),createHash('sha256').update(JSON.stringify(entry),'utf8').digest('hex'));
 }
 assert.equal(canonicalJsonDigest(value),createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex'),'eviction must not change digest semantics');
 const bytes=new Uint8Array([1,2,3]);
 const before=sha256(bytes);bytes[0]=4;
 assert.notEqual(sha256(bytes),before,'mutable bytes must always be hashed by their actual contents');
});

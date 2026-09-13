import {canonicalConsumerJson} from '@sensa/contracts/sensa';

export async function contentHash(value:unknown){
  const bytes=new TextEncoder().encode(canonicalConsumerJson(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

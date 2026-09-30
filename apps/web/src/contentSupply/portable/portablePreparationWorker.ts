import {preparePublishedBook} from './portablePreparation';
import type {SensaPortableBookDescriptor} from '@sensa/contracts/sensa';

/** A single owned job: computation only, never opens the learner library. */
self.onmessage=(event:MessageEvent<{bytes:Uint8Array;descriptor:SensaPortableBookDescriptor}>)=>{
 try{
  self.postMessage({ok:true,value:preparePublishedBook(event.data.bytes,event.data.descriptor)});
 }catch(error){
  self.postMessage({ok:false,message:error instanceof Error?error.message:'localFlow.resourceInvalid'});
 }
};

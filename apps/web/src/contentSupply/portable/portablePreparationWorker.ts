import {inspectPublishedBookPreview,inspectPortablePackage,prepareStandalonePortablePackage,preparePublishedBook} from './portablePreparation';
import type {PortablePreparationRequest} from './portablePreparationClient';

/** A single owned job: computation only, never opens the learner library. */
self.onmessage=(event:MessageEvent<PortablePreparationRequest>)=>{
 try{
  const request=event.data;
  const value=request.kind==='book'?preparePublishedBook(request.bytes,request.descriptor)
   :request.kind==='book_preview'?inspectPublishedBookPreview(request.bytes,request.descriptor)
   :request.kind==='preview'?inspectPortablePackage(request.bytes)
   :prepareStandalonePortablePackage(request.bytes,request.expectedArchiveDigest);
  self.postMessage({ok:true,value});
 }catch(error){
  self.postMessage({ok:false,message:error instanceof Error?error.message:'localFlow.resourceInvalid'});
 }
};

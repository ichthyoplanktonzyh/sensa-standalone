import {canonicalConsumerJson,sensaContentGenerationRequestSchema,sensaMaterialCandidateBundleSchema,validateBundleSnapshot} from '@sensa/contracts/sensa';

/** Re-admit frozen evidence for every on-demand source, without provider calls. */
export function assertReadyContentAttempt(attempt:any):void{
 if(attempt.status!=='ready')return;
 const request=sensaContentGenerationRequestSchema.parse(attempt.request);
 const bundle=sensaMaterialCandidateBundleSchema.parse(attempt.bundle);
 if(attempt.reviewProvider===null?attempt.review!==null:attempt.review?.accepted!==true)throw new Error('Ready preparation requires its configured review.');
 const admitted=validateBundleSnapshot(request,bundle,attempt.review,new Date(attempt.createdAt));
 const equal=(a:unknown,b:unknown)=>canonicalConsumerJson(a)===canonicalConsumerJson(b);
 if(!admitted.content||!equal(admitted.content,attempt.validation?.content)||!equal(attempt.review,attempt.validation?.review))throw new Error('Ready preparation lacks admitted candidate evidence.');
}

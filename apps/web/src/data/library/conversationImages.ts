import {sensaContextImageSchema,sensaContextImagesSchema,type SensaContextImage} from '@sensa/contracts/sensa';
export const conversationImageSchema=sensaContextImageSchema;
export const conversationImagesSchema=sensaContextImagesSchema;
export type ConversationImage=SensaContextImage;
/** Normalize selected files locally before persistence or transmission. */
export async function prepareConversationImage(file:File):Promise<ConversationImage>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('localFlow.imageType');
 if(file.size>10*1024*1024)throw Error('localFlow.imageSize');
 let bitmap:ImageBitmap;
 try{bitmap=await createImageBitmap(file);}catch{throw Error('localFlow.imageRead');}
 try{
  const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('localFlow.imageRead');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  let dataUrl=canvas.toDataURL('image/jpeg',0.82);
  if(dataUrl.length>256000)dataUrl=canvas.toDataURL('image/jpeg',0.55);
  if(dataUrl.length>256000)throw Error('localFlow.imageSize');
  return conversationImageSchema.parse({id:crypto.randomUUID(),name:file.name.slice(0,200),dataUrl});
 }finally{bitmap.close();}
}

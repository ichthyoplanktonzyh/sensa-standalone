import {z} from 'zod';
import {command,readLibrary} from './store';
import {conversationImagesSchema,type ConversationImage} from './conversationImages';
const inputSchema=z.object({id:z.string().uuid(),expectedRevision:z.number().int().min(0),text:z.string().trim().max(16000),images:conversationImagesSchema.optional(),familiarExpression:z.string().max(100).optional(),startingPoint:z.enum(['from_experience','from_sense','from_expression']).nullable().optional()}).strict().refine(v=>v.text.length>0||!!v.images?.length);
export type LocalDraft={id:string;revision:number;text:string;images?:ConversationImage[];familiarExpression?:string;startingPoint?:'from_experience'|'from_sense'|'from_expression'|null;createdAt:string;updatedAt:string};
export async function saveDraft(operationId:string,raw:z.input<typeof inputSchema>){
 const input=inputSchema.parse(raw);
 return command({id:operationId,kind:'draft.save',input},async tx=>{
  const current=await tx.get<LocalDraft>('drafts',input.id);
  if((current?.revision??0)!==input.expectedRevision)throw new Error('localFlow.draftChanged');
  const now=new Date().toISOString();
  const next:LocalDraft={id:input.id,revision:input.expectedRevision+1,text:input.text,familiarExpression:input.familiarExpression,startingPoint:input.startingPoint,createdAt:current?.createdAt??now,updatedAt:now};
  if(input.images?.length)next.images=input.images;
  tx.put('drafts',input.id,next);return next;
 });
}
export const listDrafts=()=>readLibrary(async tx=>(await tx.all<LocalDraft>('drafts')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));

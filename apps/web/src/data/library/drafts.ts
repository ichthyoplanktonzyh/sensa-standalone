import {z} from 'zod';
import {command,readLibrary} from './store';
const inputSchema=z.object({id:z.string().uuid(),expectedRevision:z.number().int().min(0),text:z.string().trim().min(1).max(16000),familiarExpression:z.string().max(100).optional(),startingPoint:z.enum(['from_experience','from_sense','from_expression']).nullable().optional()}).strict();
export type LocalDraft={id:string;revision:number;text:string;familiarExpression?:string;startingPoint?:'from_experience'|'from_sense'|'from_expression'|null;createdAt:string;updatedAt:string};
export async function saveDraft(operationId:string,raw:z.input<typeof inputSchema>){
 const input=inputSchema.parse(raw);
 return command({id:operationId,kind:'draft.save',input},async tx=>{
  const current=await tx.get<LocalDraft>('drafts',input.id);
  if((current?.revision??0)!==input.expectedRevision)throw new Error('这份材料已在另一页面修改。你的输入还在，请先读取最新版本。');
  const now=new Date().toISOString();
  const next:LocalDraft={id:input.id,revision:input.expectedRevision+1,text:input.text,familiarExpression:input.familiarExpression,startingPoint:input.startingPoint,createdAt:current?.createdAt??now,updatedAt:now};
  tx.put('drafts',input.id,next);return next;
 });
}
export const listDrafts=()=>readLibrary(async tx=>(await tx.all<LocalDraft>('drafts')).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));

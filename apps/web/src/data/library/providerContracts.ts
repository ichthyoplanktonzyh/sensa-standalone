/** Pure connection metadata. Validation must not initialize model execution,
 * credentials, account clients or a browser page. */
import {z} from 'zod';

export const purposes=['teacher','content','review','reference'] as const;
export type Purpose=typeof purposes[number];
const endpointSchema=z.string().trim().url().transform(value=>value.replace(/\/+$/u,'')).refine(value=>{
 const url=new URL(value);return !url.username&&!url.password&&!url.search&&!url.hash&&(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)));
},'localFlow.endpointInvalid');
export const providerInputSchema=z.object({id:z.string().uuid(),expectedRevision:z.number().int().min(0),name:z.string().trim().min(1).max(80),kind:z.enum(['compatible','sensa']),endpoint:endpointSchema,model:z.string().trim().min(1).max(100)}).strict();
export type Provider={id:string;revision:number;name:string;kind:'compatible'|'sensa';endpoint:string;model:string};
export type ProviderSettings={modelReviewEnabled?:boolean;revision:number;assignments:Partial<Record<Purpose,string>>};

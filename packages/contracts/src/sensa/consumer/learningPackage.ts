import {z} from 'zod';
import {sensaRuntimeLearningReleaseSchema} from '../runtimeLearningRelease.js';
import {sensaLightweightInitialMaterializationContentSchema} from '../lightweightLearningContent.js';
const id=z.string().uuid(),label=z.string().trim().min(1).max(500);
export const learningPackageSchema=z.object({
 format:z.literal('sensa-learning-package-v1'),id,version:label,title:label,
 targetLanguage:z.literal('en'),familiarLanguage:z.literal('zh-CN'),
 assurance:z.object({release:sensaRuntimeLearningReleaseSchema,audio:z.record(z.string(),z.string().regex(/^data:audio\/mpeg;base64,[A-Za-z0-9+/]+={0,2}$/u))}).strict().optional(),
 entries:z.array(z.object({senseId:id,senseVersionId:id,bindingId:id,bindingVersionId:id,expression:label,assurancePackageKey:label.optional(),meaning:z.string().trim().min(1).max(8000),content:sensaLightweightInitialMaterializationContentSchema}).strict()).min(1).max(100),
}).strict().superRefine((p,c)=>{const keys=p.entries.map(e=>e.senseVersionId+':'+e.bindingVersionId);if(new Set(keys).size!==keys.length)c.addIssue({code:'custom',message:'Duplicate learning target'});});
export const learningPackageDescriptorSchema=z.object({id,version:label,title:label,description:z.string().max(2000),entryCount:z.number().int().min(1).max(100),byteLength:z.number().int().min(1).max(8*1024*1024),sha256:z.string().regex(/^[a-f0-9]{64}$/u),url:z.string().url().refine(value=>{const u=new URL(value);return !u.username&&!u.password&&(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname));})}).strict();
export const learningPackageCatalogSchema=z.object({items:z.array(learningPackageDescriptorSchema).max(100)}).strict();
export type LearningPackageBundle=z.infer<typeof learningPackageSchema>;
export type LearningPackageDescriptor=z.infer<typeof learningPackageDescriptorSchema>;

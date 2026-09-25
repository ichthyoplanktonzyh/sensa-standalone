import {z} from 'zod';
/** Offline, owned image bytes; never arbitrary external URLs. */
export const sensaContextImageSchema=z.object({id:z.string().uuid(),name:z.string().max(200),dataUrl:z.string().max(72*1024*1024).regex(/^data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/u)}).strict();
export const sensaContextImagesSchema=z.array(sensaContextImageSchema).max(4);
export type SensaContextImage=z.infer<typeof sensaContextImageSchema>;
/** HTML is declarative. The renderer supplies the click/drag state behavior. */
export const SENSA_INTERACTIVE_HTML_TAGS=['div','span','p','strong','em','b','i','small','h1','h2','h3','button','section','article','ul','ol','li','br','hr','label','input'] as const;
export const sensaInteractiveHtmlSchema=z.string().trim().min(1).max(48000).refine(html=>!/<\s*\/?\s*(?:script|iframe|object|embed|link|meta|base|form|style)\b|\bon\w+\s*=|\s(?:src|href|action|srcdoc)\s*=|url\s*\(|@import/iu.test(html),'Interactive HTML must be self-contained declarative markup.').refine(html=>{const names=[...html.matchAll(/<\s*\/?\s*([a-z][a-z0-9-]*)\b/giu)].map(m=>m[1].toLowerCase());return names.length>0&&names.every(name=>(SENSA_INTERACTIVE_HTML_TAGS as readonly string[]).includes(name));},'Unsupported interactive HTML element.');

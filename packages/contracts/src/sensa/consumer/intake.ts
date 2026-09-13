import {z} from 'zod';
import {sensaLanguageTagSchema} from '../language.js';
const sourceUrl=z.string().url().max(4096).refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;},'HTTP(S) source required');
/**
 * How a capture came to name a language, so a judgement can be re-examined
 * later without re-running the capture.
 *
 * `declared` is the material stating its own language — a page's `lang`
 * attribute, a subtitle track's code; `detector` is a local text detector,
 * `model` is a model answer, `learner` is the learner picking one. Nothing ranks
 * them, because a learner who states the language is the authority and a
 * detector that disagrees is wrong.
 */
export const captureLanguageSources=['declared','detector','model','learner'] as const;
export const captureLanguageSourceSchema=z.enum(captureLanguageSources);
export type CaptureLanguageSource=z.infer<typeof captureLanguageSourceSchema>;
export const captureSnapshotSchema=z.object({
  sentence:z.string().min(1).max(12000).refine(s=>s.trim().length>0),
  /**
   * The language this capture is in, or `null` when nothing established one.
   *
   * `null` is a first-class answer rather than a placeholder for English: a
   * short selection on a page that declares no language genuinely has no known
   * language, and stamping the learner's target language on it would file the
   * capture under a language nobody observed. Whoever holds the language
   * context decides what a tag means; the capture only says what it is.
   */
  language:sensaLanguageTagSchema.nullable(),
  languageSource:captureLanguageSourceSchema.nullable(),
  languageConfidence:z.number().min(0).max(1).nullable(),
  source:z.object({url:sourceUrl.nullable(),title:z.string().max(1000),capturedAt:z.string().datetime({offset:true}),
    video:z.object({platform:z.literal('youtube'),videoId:z.string().regex(/^[a-zA-Z0-9_-]{11}$/u),startMs:z.number().int().min(0).max(86400000),endMs:z.number().int().min(0).max(86400000)}).strict().optional(),
  }).strict(),
  expression:z.object({text:z.string().min(1).max(2000),start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict().nullable(),
}).strict().superRefine((value,ctx)=>{
  // A capture knows a language and how it knows it, or it knows neither. One
  // without the other is a claim with no basis or a basis with no claim.
  if((value.language===null)!==(value.languageSource===null)||(value.language===null)!==(value.languageConfidence===null))ctx.addIssue({code:'custom',message:'A language, source and confidence are decided together',path:['languageSource']});
  const e=value.expression;if(e&&(e.end<=e.start||Array.from(value.sentence).slice(e.start,e.end).join('')!==e.text||e.end>Array.from(value.sentence).length))ctx.addIssue({code:'custom',message:'Invalid code point occurrence',path:['expression']});
  const video=value.source.video;if(video){const url=value.source.url?new URL(value.source.url):null;const id=url?.pathname==='/watch'?url.searchParams.get('v'):url?.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/u)?.[1];if(!url||!['www.youtube.com','youtube.com','m.youtube.com','www.youtube-nocookie.com'].includes(url.hostname)||id!==video.videoId||video.endMs<video.startMs)ctx.addIssue({code:'custom',message:'Invalid video source',path:['source','video']});}
});
export type CaptureSnapshot=z.infer<typeof captureSnapshotSchema>;
/**
 * Product duplicate identity excludes changing title/capture time; original
 * provenance stays immutable.
 *
 * `language` is part of the identity — the same sentence in two languages is two
 * captures — while `languageSource` is deliberately not: how a language was
 * worked out is provenance, and a capture detected twice is still one capture.
 */
export function captureIdentity(snapshot:CaptureSnapshot){return {sentence:snapshot.sentence,language:snapshot.language,url:snapshot.source.url,expression:snapshot.expression,...(snapshot.source.video?{video:snapshot.source.video}:{})};}
/** Playback link is derived from the captured locator, without changing the original page URL. */
export function captureSourceLink(source:CaptureSnapshot['source']){
  return source.video?`https://www.youtube.com/watch?v=${source.video.videoId}&t=${Math.floor(source.video.startMs/1000)}s`:source.url;
}

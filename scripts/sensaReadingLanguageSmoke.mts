/**
 * The reading service runs in the learner's own two languages.
 *
 * The service is told the pair by each request rather than remembering one, so
 * this guards the three consequences of that: the prompt names the languages the
 * request actually carried, an explanation is asked for in the learner's
 * familiar language while a translation is rendered into it, and a pair this
 * release cannot name is refused instead of being passed to a model as a bare
 * code. It also guards the idempotency property that makes a request id safe to
 * retry: the digest covers the pair, so the same id under another pair is a
 * conflict rather than the other language's answer replayed. The learner's own
 * glossary rides the same way: it is stated as data, and it is digested too.
 */
import assert from 'node:assert/strict';
import {readingRequestSchema} from '@sensa/contracts/sensa';
import {readingSystemPrompt} from '../apps/api/src/sensa/reading/service.ts';
import {contentHash} from '../apps/api/src/sensa/shared/contentHash.ts';

const base={id:'2f1c5f5c-3a1f-4f5e-9d6b-7c8a9b0c1d2e',text:'She took her time.','context':'','instruction':''};

// The shipped pair still works, and it is named from the request rather than
// from a constant that happens to match it.
const shipped=readingRequestSchema.parse({...base,feature:'selection',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'en'});
assert.match(readingSystemPrompt(shipped),/into natural Chinese \(Simplified\)/,'the catalog names Simplified Chinese unambiguously, which is also what a prompt should say');
assert.match(readingSystemPrompt(shipped),/quoted English text/,'a translation names the text’s language when the caller established one');

// The defect this replaced: the service used to translate into Chinese and
// explain in Chinese whatever the learner was reading.
const japanese=readingRequestSchema.parse({...base,feature:'selection',languages:{familiarLanguageTag:'ja',targetLanguageTag:'id'},sourceLanguageTag:'id'});
const japanesePrompt=readingSystemPrompt(japanese);
assert.match(japanesePrompt,/into natural Japanese/);
assert.match(japanesePrompt,/quoted Indonesian text/);
assert(!/Chinese|English/u.test(japanesePrompt),'a prompt must not name a language the request did not carry');

// An explanation is read by the learner, so it comes back in their familiar
// language, while the prompt still tells the model which language is being
// learned — that contrast is what makes an explanation useful.
const explanation=readingRequestSchema.parse({...base,feature:'action',text:'take one’s time',languages:{familiarLanguageTag:'fr',targetLanguageTag:'de'},sourceLanguageTag:'de'});
const explanationPrompt=readingSystemPrompt(explanation);
assert.match(explanationPrompt,/learner of German/);
assert.match(explanationPrompt,/explain in French/);
assert(!/Chinese|English/u.test(explanationPrompt));

// A translation of text already in the learner's familiar language is the one
// instruction that would tell a model to translate a language into itself, so
// the prompt still names both honestly and the decision to skip it belongs to
// the caller that knows the text.
const familiarText=readingRequestSchema.parse({...base,feature:'page',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'zh-CN'});
assert.match(readingSystemPrompt(familiarText),/quoted Chinese \(Simplified\) text into natural Chinese \(Simplified\)/);

// What the request carries beside the text is evidence, not a second thing to
// translate: a model told only "here is some context" may hand back a
// translation of the context as well, and a cue or a paragraph on its own is
// exactly the case that needs the surrounding text.
const withContext=readingRequestSchema.parse({...base,feature:'page',text:'her time.',context:'She took her time.\nThey looked up at the sky.',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'en'});
assert.match(readingSystemPrompt(withContext),/surrounding text from the same document/);
assert.match(readingSystemPrompt(withContext),/never material of its own to translate/);
assert.notEqual(await contentHash(withContext),await contentHash({...withContext,context:''}),'context is part of what was asked, so a retry under different context is a different request');

// The learner's own words win over the model's: the glossary travels with the
// request, is stated as data rather than as prose, and is part of what was asked,
// so editing it makes the same request id a different question.
const glossed=readingRequestSchema.parse({...base,feature:'page',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'en',glossary:[{term:'prompt',rendering:'提示词'}]});
const glossedPrompt=readingSystemPrompt(glossed);
assert.match(glossedPrompt,/glossary of their own word choices/);
assert.match(glossedPrompt,/"term":"prompt","rendering":"提示词"/,'a glossary is stated as data, so a term of the learner’s own cannot be read as prompt structure');
assert.match(glossedPrompt,/never an instruction about the task/);
assert.match(glossedPrompt,/not part of the text/,'a glossary is a preference about wording, not material to translate');
assert.match(readingSystemPrompt(readingRequestSchema.parse({...glossed,feature:'action'})),/提示词/,'an explanation is written in the learner’s words too');
assert(!/glossary/u.test(readingSystemPrompt(shipped)),'a learner who wrote no glossary is not told about one');
assert.notEqual(await contentHash(glossed),await contentHash({...glossed,glossary:[]}),'the glossary is part of the question, so the same id under a different one is a conflict');

// The task lives in the prompt, not in a default instruction the learner would
// read: an instruction written in one language is wrong for every other one.
assert.equal(readingRequestSchema.parse({...base,feature:'action',languages:{familiarLanguageTag:'ko',targetLanguageTag:'it'}}).instruction,'');
assert.match(readingSystemPrompt(readingRequestSchema.parse({...base,feature:'action',languages:{familiarLanguageTag:'ko',targetLanguageTag:'it'}})),/otherwise explain how the quoted expression is used in this context/);

// An unestablished language is a supported answer: the prompt says "the quoted
// text" rather than naming a language nobody observed.
const undetermined=readingRequestSchema.parse({...base,feature:'selection',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'}});
assert.equal(undetermined.sourceLanguageTag,null);
assert.match(readingSystemPrompt(undetermined),/Translate the quoted text into natural Chinese \(Simplified\)/);

// A pair is a pair: one language on both sides, and a language this release
// cannot name, are both refused at the boundary.
const refuses=(label:string,value:unknown)=>assert.equal(readingRequestSchema.safeParse(value).success,false,label);
refuses('one language cannot be both sides',{...base,feature:'selection',languages:{familiarLanguageTag:'en',targetLanguageTag:'en'}});
refuses('a language the catalog cannot name cannot be asked for',{...base,feature:'selection',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'yue'}});
refuses('a missing pair is not a defaulted one',{...base,feature:'selection'});
refuses('an unplaceable text language is refused too',{...base,feature:'selection',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'yue'});

// Idempotency: the request digest covers the pair, so a retry under another pair
// can never replay the previous language's answer.
const englishPair=readingRequestSchema.parse({...base,feature:'selection',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'en'});
const spanishPair=readingRequestSchema.parse({...base,feature:'selection',languages:{familiarLanguageTag:'zh-CN',targetLanguageTag:'es'},sourceLanguageTag:'es'});
assert.notEqual(await contentHash(englishPair),await contentHash(spanishPair),'the same request id under a different pair must digest differently');
assert.equal(await contentHash(englishPair),await contentHash({...englishPair}),'the same request must digest the same');

console.log('PASS: the reading service builds every prompt from the pair the request carries — translation into the learner’s familiar language naming the text’s own language, explanation in the familiar language while naming the one being learned — refuses a pair or a text language this release cannot name, and digests the pair so a retry cannot replay another language’s answer. Context travels as evidence about the text rather than as a second thing to translate, and is digested with it. Pure prompt and schema; no provider call.');

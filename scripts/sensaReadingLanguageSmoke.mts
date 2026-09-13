/**
 * The reading service runs in the learner's own two languages.
 *
 * The service is told the pair by each request rather than remembering one, so
 * this guards the three consequences of that: the prompt names the languages the
 * request actually carried, an explanation is asked for in the operation's
 * Support Language while a translation is rendered into it, and a context this
 * release cannot name is refused instead of being passed to a model as a bare
 * code. It also guards the idempotency property that makes a request id safe to
 * retry: the digest covers the pair, so the same id under another pair is a
 * conflict rather than the other language's answer replayed. The learner's own
 * glossary rides the same way: it is stated as data, and it is digested too.
 */
import assert from 'node:assert/strict';
import {readingAssignmentsSchema,readingFeatures,readingRequestSchema} from '@sensa/contracts/sensa';
import {readingSystemPrompt} from '../apps/api/src/sensa/reading/service.ts';
import {contentHash} from '../apps/api/src/sensa/shared/contentHash.ts';

// Every feature the reading service offers needs two things: a key in the
// assignment map, so a learner can point it at a connection, and a place in the
// request's own enum, so a caller can ask for it. `meaning` is the one feature
// that lives elsewhere — it is served by the lookup route — and it is the one
// this leaves out on purpose. A map written out again somewhere else is the
// defect this guards: the Web application kept its own copy and stopped parsing
// every account's model settings the day a feature was added here.
for(const feature of readingFeatures)assert.ok(feature in readingAssignmentsSchema.shape,`${feature} needs an assignment of its own`);
assert.deepEqual([...readingRequestSchema.shape.feature.options].sort(),readingFeatures.filter(feature=>feature!=='meaning').sort(),
 'the reading route serves exactly the features a request can name, apart from the one served by the lookup route');

const base={id:'2f1c5f5c-3a1f-4f5e-9d6b-7c8a9b0c1d2e',text:'She took her time.','context':'','instruction':''};

// The shipped pair still works, and it is named from the request rather than
// from a constant that happens to match it.
const shipped=readingRequestSchema.parse({...base,feature:'selection',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'en'});
assert.match(readingSystemPrompt(shipped),/into natural Chinese \(Simplified\)/,'the catalog names Simplified Chinese unambiguously, which is also what a prompt should say');
assert.match(readingSystemPrompt(shipped),/quoted English text/,'a translation names the text’s language when the caller established one');

// The defect this replaced: the service used to translate into Chinese and
// explain in Chinese whatever the learner was reading.
const japanese=readingRequestSchema.parse({...base,feature:'selection',languages:{supportLanguageTag:'ja',targetLanguageTag:'id'},sourceLanguageTag:'id'});
const japanesePrompt=readingSystemPrompt(japanese);
assert.match(japanesePrompt,/into natural Japanese/);
assert.match(japanesePrompt,/quoted Indonesian text/);
assert(!/Chinese|English/u.test(japanesePrompt),'a prompt must not name a language the request did not carry');

// An explanation is read by the learner, so it comes back in the Support
// language, while the prompt still tells the model which language is being
// learned — that contrast is what makes an explanation useful.
const explanation=readingRequestSchema.parse({...base,feature:'action',text:'take one’s time',languages:{supportLanguageTag:'fr',targetLanguageTag:'de'},sourceLanguageTag:'de'});
const explanationPrompt=readingSystemPrompt(explanation);
assert.match(explanationPrompt,/learner of German/);
assert.match(explanationPrompt,/explain in French/);
assert(!/Chinese|English/u.test(explanationPrompt));

// A translation of text already in the operation's Support Language is the one
// instruction that would tell a model to translate a language into itself, so
// the prompt still names both honestly and the decision to skip it belongs to
// the caller that knows the text.
const familiarText=readingRequestSchema.parse({...base,feature:'page',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'zh-CN'});
assert.match(readingSystemPrompt(familiarText),/quoted Chinese \(Simplified\) text into natural Chinese \(Simplified\)/);

// A page may contain a third observed language. It remains a fact about this
// input and does not mutate either role in the Route.
const thirdLanguage=readingRequestSchema.parse({...base,feature:'selection',text:'Elle prend son temps.',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'fr'});
assert.match(readingSystemPrompt(thirdLanguage),/quoted French text into natural Chinese \(Simplified\)/);
assert.equal(thirdLanguage.languages.targetLanguageTag,'en');

// What the request carries beside the text is evidence, not a second thing to
// translate: a model told only "here is some context" may hand back a
// translation of the context as well, and a cue or a paragraph on its own is
// exactly the case that needs the surrounding text.
const withContext=readingRequestSchema.parse({...base,feature:'page',text:'her time.',context:'She took her time.\nThey looked up at the sky.',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'en'});
assert.match(readingSystemPrompt(withContext),/surrounding text from the same document/);
assert.match(readingSystemPrompt(withContext),/never material of its own to translate/);
assert.notEqual(await contentHash(withContext),await contentHash({...withContext,context:''}),'context is part of what was asked, so a retry under different context is a different request');

// The learner's own words win over the model's: the glossary travels with the
// request, is stated as data rather than as prose, and is part of what was asked,
// so editing it makes the same request id a different question.
const glossed=readingRequestSchema.parse({...base,feature:'page',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'en',glossary:[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'prompt',rendering:'提示词'}]});
const glossedPrompt=readingSystemPrompt(glossed);
assert.match(glossedPrompt,/glossary of their own word choices/);
assert.match(glossedPrompt,/"term":"prompt","rendering":"提示词"/,'a glossary is stated as data, so a term of the learner’s own cannot be read as prompt structure');
assert.match(glossedPrompt,/never an instruction about the task/);
assert.match(glossedPrompt,/not part of the text/,'a glossary is a preference about wording, not material to translate');
assert.match(readingSystemPrompt(readingRequestSchema.parse({...glossed,feature:'action'})),/提示词/,'an explanation is written in the learner’s words too');
assert(!/glossary/u.test(readingSystemPrompt(shipped)),'a learner who wrote no glossary is not told about one');
assert.notEqual(await contentHash(glossed),await contentHash({...glossed,glossary:[]}),'the glossary is part of the question, so the same id under a different one is a conflict');

// Writing runs the other way. Every other feature renders something the learner
// met into their own language; this one takes the sentence they wrote in that
// language and produces the one they are learning, so a prompt that got the
// direction from the pair the wrong way round would hand back their own words.
const writing=readingRequestSchema.parse({...base,feature:'writing',text:'我把会议改到了周四。',context:'Subject: Thursday sync',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'}});
const writingPrompt=readingSystemPrompt(writing);
assert.match(writingPrompt,/Chinese \(Simplified\) input text into natural English/);
assert.match(writingPrompt,/do not answer a question it asks/,'the learner’s text may be a question they are asking someone else, and it is not the model’s to answer');
assert.match(writingPrompt,/keep its meaning, tone and register/);
assert(!/into natural Chinese/u.test(writingPrompt),'writing must not translate into the learner’s own language, which is what translation does');
assert.match(readingSystemPrompt(readingRequestSchema.parse({...writing,glossary:[{inputLanguageTag:'zh-CN',outputLanguageTag:'en',term:'提示词',rendering:'prompt'}]})),/use the other side/,'a glossary is read in whichever direction the operation runs');
assert.equal(readingRequestSchema.safeParse({...writing,glossary:[{inputLanguageTag:'en',outputLanguageTag:'zh-CN',term:'prompt',rendering:'提示词'}]}).success,false,'a glossary for another direction cannot leak into this request');

// The task lives in the prompt, not in a default instruction the learner would
// read: an instruction written in one language is wrong for every other one.
assert.equal(readingRequestSchema.parse({...base,feature:'action',languages:{supportLanguageTag:'ko',targetLanguageTag:'it'}}).instruction,'');
assert.match(readingSystemPrompt(readingRequestSchema.parse({...base,feature:'action',languages:{supportLanguageTag:'ko',targetLanguageTag:'it'}})),/otherwise explain how the quoted expression is used in this context/);

// An unestablished language is a supported answer: the prompt says "the quoted
// text" rather than naming a language nobody observed.
const undetermined=readingRequestSchema.parse({...base,feature:'selection',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'}});
assert.equal(undetermined.sourceLanguageTag,null);
assert.match(readingSystemPrompt(undetermined),/Translate the quoted text into natural Chinese \(Simplified\)/);

// Target and Support may be the same; an unnameable language is still refused.
const refuses=(label:string,value:unknown)=>assert.equal(readingRequestSchema.safeParse(value).success,false,label);
const immersion=readingRequestSchema.parse({...base,feature:'selection',languages:{supportLanguageTag:'en',targetLanguageTag:'en'},sourceLanguageTag:'en'});
assert.match(readingSystemPrompt(immersion),/English text into natural English/);
refuses('a language the catalog cannot name cannot be asked for',{...base,feature:'selection',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'yue'}});
refuses('a missing pair is not a defaulted one',{...base,feature:'selection'});
refuses('an unplaceable text language is refused too',{...base,feature:'selection',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'yue'});

// Idempotency: the request digest covers the pair, so a retry under another pair
// can never replay the previous language's answer.
const englishPair=readingRequestSchema.parse({...base,feature:'selection',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'en'},sourceLanguageTag:'en'});
const spanishPair=readingRequestSchema.parse({...base,feature:'selection',languages:{supportLanguageTag:'zh-CN',targetLanguageTag:'es'},sourceLanguageTag:'es'});
assert.notEqual(await contentHash(englishPair),await contentHash(spanishPair),'the same request id under a different pair must digest differently');
assert.equal(await contentHash(englishPair),await contentHash({...englishPair}),'the same request must digest the same');

console.log('PASS: the reading service builds every prompt from its pinned context, keeps third-language input observational, scopes glossary entries to the concrete direction, supports immersion, refuses unnameable tags, and digests the context. Pure prompt and schema; no provider call.');

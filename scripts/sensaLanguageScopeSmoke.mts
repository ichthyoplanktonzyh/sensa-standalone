/** What a reading surface shows when the learner's material spans languages.
 *
 * Two rules decide every reading surface, so they live in one module and are
 * exercised here against the real record and binding shapes the screens pass in:
 * a scope never hides a language that is present, and counts in different
 * languages are never added together.
 */
import assert from 'node:assert/strict';
import {inLanguageScope, languagesPresent, meaningLanguageTags, resolveLanguageScope} from '../apps/web/src/experience/library/languageScope.ts';
import {projectLearningStatistics} from '../apps/web/src/experience/learningJourney/learningStatistics.ts';
import type {LearningRecordView} from '../apps/web/src/experience/learningJourney/learningHistory.ts';

const record=(recordId:string,languageTag:string,kind:LearningRecordView['kind'],occurredAt:string):LearningRecordView=>
  ({recordId,targetId:'target-'+recordId,expression:'expression-'+recordId,languageTag,occurredAt,kind,label:kind,detail:''});

const now=new Date(2026,8,20,12);
const range={now,range:'all' as const,start:'',end:'',kind:'all' as const};

// What languages a set of things contains.
assert.deepEqual(languagesPresent(['es',undefined,'en','es']),['en','es'],'each language is present once, in a stable order');
assert.deepEqual(languagesPresent([undefined,undefined]),[],'an untagged set names no language');
assert.deepEqual(languagesPresent([]),[]);

// Which language a surface reads in.
assert.equal(resolveLanguageScope(null,['en','es'],'es'),'es','the active target language is the default while it is present');
assert.equal(resolveLanguageScope(null,['en'],'es'),'all','a world holding none of the active language reads as every language, never as empty');
assert.equal(resolveLanguageScope(null,[],'es'),'all','a surface with nothing to scope reads as every language');
assert.equal(resolveLanguageScope('en',['en','es'],'es'),'en','the learner\'s own choice wins over the active language');

// What falls inside a scope.
assert.equal(inLanguageScope('es','es'),true);
assert.equal(inLanguageScope('en','es'),false,'another language is not answerable from this scope');
assert.equal(inLanguageScope(undefined,'es'),false,'an untagged thing belongs to no single language');
assert.equal(inLanguageScope('en','all'),true,'the cross-language scope matches every language');
assert.equal(inLanguageScope(undefined,'all'),true);

// One meaning, two languages: reachable from both, filed under neither.
const twoLanguageMeaning=meaningLanguageTags([{languageTag:'en'},{languageTag:'es'},{languageTag:'en'}]);
assert.deepEqual(twoLanguageMeaning,['en','es'],'a meaning connected to two languages answers with both');
assert.equal(twoLanguageMeaning.includes('es'),true);
assert.equal(twoLanguageMeaning.includes('en'),true);
assert.deepEqual(meaningLanguageTags([]),[],'a meaning with no connected expression names no language');

// Records in two languages: each language is counted on its own, and the whole
// set is the union rather than a merged number.
const records=[
  record('a','en','initial_learning','2026-09-18T09:00:00.000Z'),
  record('b','en','retention_review','2026-09-18T10:00:00.000Z'),
  record('c','es','initial_learning','2026-09-19T09:00:00.000Z'),
  record('d','es','relearning','2026-09-19T10:00:00.000Z'),
  record('e','es','retention_review','2026-09-19T11:00:00.000Z'),
];
const languages=languagesPresent(records.map(item=>item.languageTag));
assert.deepEqual(languages,['en','es']);
const perLanguage=languages.map(tag=>({tag,counts:projectLearningStatistics(records.filter(item=>inLanguageScope(item.languageTag,tag)),range).counts}));
assert.deepEqual(perLanguage,[{tag:'en',counts:{initial_learning:1,retention_review:1,relearning:0}},{tag:'es',counts:{initial_learning:1,retention_review:1,relearning:1}}],'each language is counted from its own records only');
const merged=projectLearningStatistics(records.filter(item=>inLanguageScope(item.languageTag,'all')),range);
assert.equal(merged.records.length,records.length,'the cross-language scope loses no record');
assert.equal(perLanguage.reduce((total,row)=>total+row.counts.initial_learning,0),merged.counts.initial_learning,'the per-language rows account for exactly the whole set');
// The scoped surfaces filter by the same membership rule, so a scope of one
// language can only ever contain that language.
for(const scope of languages){
  const scoped=records.filter(item=>inLanguageScope(item.languageTag,scope));
  assert.ok(scoped.length>0&&scoped.every(item=>item.languageTag===scope),`a ${scope} scope contains only ${scope} records`);
  assert.ok(scoped.length<records.length,`a ${scope} scope is not the whole set`);
}
// An active language that is not in the records still reads the whole set.
assert.equal(resolveLanguageScope(null,languages,'fr'),'all');

console.log('PASS: a reading surface follows the learner\u2019s language choice, never renders a present language as empty, and counts each language from its own records instead of merging them.');

import {localFlowText} from '../../../i18n/localFlowText';
import type {RuntimeLearningContent} from '../../../learning/content/learningCatalog';

export function StudyResources({content}:{content:RuntimeLearningContent}){
 return <div className="space-y-6">
  <div><h2 className="text-3xl font-medium">{content.lemma}</h2><p className="mt-3 text-lg">{content.guideLabelL1}</p><p className="mt-3 text-sm leading-7 text-fg-secondary">{content.definitionL2}</p></div>
  <section className="space-y-3"><h3 className="font-medium">{localFlowText('assurancePronunciation')}</h3>{content.pronunciations.map(pronunciation=><div key={pronunciation.accentLocale} className="rounded-xl border border-border-subtle p-4"><p className="mb-3 text-sm">{pronunciation.accentLocale} · {pronunciation.ipa}</p>{pronunciation.audioUrl&&<audio controls preload="none" src={pronunciation.audioUrl} aria-label={localFlowText('assuranceAudio',{label:pronunciation.accentLocale})} className="w-full max-w-full"/>}</div>)}</section>
  <section className="space-y-4"><h3 className="font-medium">{localFlowText('assuranceExamples')}</h3>{content.learningExamples.map(example=><div key={example.exampleKey} className="space-y-3 rounded-xl border border-border-subtle p-4"><p className="text-lg leading-8">{example.textL2}</p><p className="text-sm leading-6 text-fg-secondary">{example.textL1}</p>{example.audioUrl&&<audio controls preload="none" src={example.audioUrl} aria-label={localFlowText('assuranceAudio',{label:example.textL2})} className="w-full max-w-full"/>}</div>)}</section>
  {content.supportTabs.flatMap(tab=>tab.patterns).map(pattern=><p key={pattern.canonicalPattern} className="text-sm leading-7">{pattern.canonicalPattern}</p>)}
 </div>;
}

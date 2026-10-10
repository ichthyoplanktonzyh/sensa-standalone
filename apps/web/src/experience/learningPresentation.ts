import type { RuntimeLearningContent, LearningExample } from '../learning/content/learningCatalog';
import type { Word } from './types';
import i18n from '../i18n';

/** Presentation-only bridge required by the existing detail and learning cards. */
export function toWordPresentation(content: RuntimeLearningContent): Word {
  const label=(learningKey:string,contentKey:string)=>i18n.hasResourceBundle(i18n.language,'learning')
    ? i18n.t(learningKey,{ns:'learning'})
    : i18n.t(contentKey,{ns:'content'});
  const currentMeaning=label('assurance.currentMeaning','contentUi.meaning3');
  const emphasize = (example: LearningExample): string =>
    `${example.textL2.slice(0, example.targetStart)}<b>${example.targetSurface}</b>${example.textL2.slice(example.targetEnd)}`;
  const sentences = content.learningExamples.map((example) => ({
    exampleId: example.exampleKey,
    src: `Sensa ${i18n.t('contentUi.learningExample',{ns:'content'})}`,
    theme: 'forest',
    en: emphasize(example),
    zh: example.textL1,
    audioUrl: example.audioUrl ?? undefined,
    sourceKind: 'learning_example' as const,
  }));
  return {
    id: content.senseKey,
    w: content.lemma,
    syl: content.syllables ?? content.lemma,
    ph: content.ipa,
    tags: ['Sensa', currentMeaning],
    total: content.learningExamples.length,
    def: `<b>${content.partOfSpeech}</b> ${content.definitionL2} ${content.guideLabelL1}`,
    senses: [{ pos: content.partOfSpeech, items: [content.guideLabelL1] }],
    senseDetails: [{
      id: content.senseKey,
      pos: content.partOfSpeech,
      text: content.guideLabelL1,
      def: content.definitionL2,
      tag: currentMeaning,
      sentences,
    }],
    options: content.recognitionAssessment.options.map((option) => ({
      pos: content.partOfSpeech,
      text: option.textL1,
      ok: option.isCorrect,
    })),
    audioOptions: content.recognitionAssessment.options.map((option) => ({
      pos: content.partOfSpeech,
      text: option.textL1,
      ok: option.isCorrect,
    })),
    sentences,
    mnemo: {
      [label('assurance.boundary','contentUi.scenesAndBoundaries')]: [[currentMeaning, content.guideLabelL1]],
      [label('assurance.experienceTitle','contentUi.typicalScene')]: content.experienceSketch.labelsL1.map((item) => [item, '']),
    },
  };
}

import type { RuntimeLearningContent, LearningExample } from '../learning/content/learningCatalog';
import type { Word } from './types';

/** Presentation-only bridge required by the existing detail and learning cards. */
export function toWordPresentation(content: RuntimeLearningContent): Word {
  const emphasize = (example: LearningExample): string =>
    `${example.textL2.slice(0, example.targetStart)}<b>${example.targetSurface}</b>${example.textL2.slice(example.targetEnd)}`;
  const sentences = content.learningExamples.map((example) => ({
    exampleId: example.exampleKey,
    src: 'Sensa 学习例句',
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
    tags: ['Sensa', '核心义项'],
    total: content.learningExamples.length,
    def: `<b>${content.partOfSpeech}</b> ${content.definitionL2} ${content.guideLabelL1}`,
    senses: [{ pos: content.partOfSpeech, items: [content.guideLabelL1] }],
    senseDetails: [{
      id: content.senseKey,
      pos: content.partOfSpeech,
      text: content.guideLabelL1,
      def: content.definitionL2,
      tag: '当前学习义项',
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
      '义项边界': [['当前学习义项', content.guideLabelL1]],
      '经验速写': content.experienceSketch.labelsL1.map((label) => [label, '']),
    },
  };
}

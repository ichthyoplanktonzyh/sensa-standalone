import type { Word } from './types';
import { BUNDLED_LEARNING_PACKAGES,bundledLearningRelease } from '../learning/content/bundledLearningContent';
import type {SensaPinnedLanguageContext} from '@sensa/contracts/sensa';
import { toWordPresentation } from './learningPresentation';

/**
 * A small, read-only projection used by the free-practice prototype.
 *
 * Practice deliberately has its own identity. A word can contribute several
 * practice items, while formal learning and review remain owned by the
 * runtime queues.
 */
export interface PracticeExample {
  /** Exact immutable Example identity when this item comes from a Package. */
  exampleId: string;
  text: string;
  translation: string;
  sourceLabel: '学习例句';
  audioUrl: string | null;
}

export interface PracticeSenseItem {
  senseId: string;
  wordId: string;
  word: string;
  syllable: string;
  phonetic: string;
  pronunciationAudioUrl: string | null;
  pos: string;
  meaning: string;
  example: PracticeExample;
  sourceWord: Word;
  referenceLanguages?:SensaPinnedLanguageContext;
}

const escapeSequenceEntities: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/** Strip authored markup while retaining readable sentence text. */
export const stripExampleMarkup = (value: string): string =>
  value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/gi, (entity) => {
      return escapeSequenceEntities[entity.toLowerCase()] || entity;
    })
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Project approved Package practice resources without deriving identity from
 * a Word registry. Runtime Packages use stable package and Sense identities.
 */
const packagePracticeExample = (
  pkg: (typeof BUNDLED_LEARNING_PACKAGES)[number],
): (typeof pkg.content.learningExamples)[number] | undefined => {
  const grants = pkg.content.practiceManifest?.grants ?? [];
  // The manifest is authoritative. Prefer the approved Portable Listening
  // inventory, then Immersive Browse, and never invent a fallback Example.
  const resourceKeys = grants.find((grant) => grant.taskFamily === 'portable_listening')?.resourceKeys
    ?? grants.find((grant) => grant.taskFamily === 'immersive_browse')?.resourceKeys
    ?? [];
  return pkg.content.learningExamples.find((example) => resourceKeys.includes(example.exampleKey));
};

export const RUNTIME_PRACTICE_SENSES: PracticeSenseItem[] = BUNDLED_LEARNING_PACKAGES.flatMap((pkg) => {
  const example = packagePracticeExample(pkg);
  if (!example) return [];
  return [{
    senseId: pkg.senseId,
    wordId: pkg.packageId,
    word: pkg.content.lemma,
    referenceLanguages:{targetLanguageTag:bundledLearningRelease.release.targetLanguage,supportLanguageTag:bundledLearningRelease.release.learnerLocale},
    syllable: pkg.content.syllables ?? pkg.content.lemma,
    phonetic: pkg.content.ipa,
    pronunciationAudioUrl: pkg.content.pronunciations.find(pronunciation=>pronunciation.accentLocale===pkg.content.accentLocale)?.audioUrl ?? null,
    pos: pkg.content.partOfSpeech,
    meaning: pkg.content.guideLabelL1,
    example: {
      exampleId: example.exampleKey,
      text: stripExampleMarkup(example.textL2),
      translation: stripExampleMarkup(example.textL1),
      sourceLabel: '学习例句' as const,
      audioUrl: example.audioUrl,
    },
    get sourceWord(){return toWordPresentation(pkg.content);},
  }];
});

/** Formal/default practice inventory is Package-only. */
export const PRACTICE_SENSES: PracticeSenseItem[] = RUNTIME_PRACTICE_SENSES;

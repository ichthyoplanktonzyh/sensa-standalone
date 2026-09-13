import type { SenseDetail, Sentence, Word } from './types';
import { WORDS } from './data';
import { BUNDLED_LEARNING_PACKAGES } from '../learning/content/bundledLearningContent';
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

const stableWordId = (word: Word): string => {
  const sourceId = word.id?.trim();
  if (sourceId) return sourceId;
  return `w_${word.w.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
};

const stableSenseId = (word: Word, groupIndex: number, itemIndex: number): string =>
  `${stableWordId(word)}:sense:${groupIndex}:${itemIndex}`;

const flattenedSenseCount = (word: Word): number =>
  word.senses.reduce((count, group) => count + group.items.length, 0);

const matchingSenseDetail = (
  word: Word,
  meaning: string,
  groupIndex: number,
  flatIndex: number,
  senseId: string
): SenseDetail | undefined => {
  const details = word.senseDetails || [];
  if (details.length === 0) return undefined;

  const byId = details.find((detail) => detail.id === senseId);
  if (byId) return byId;

  const normalizedMeaning = meaning.trim();
  const byText = details.find((detail) => detail.text.trim() === normalizedMeaning);
  if (byText) return byText;

  // Most of the legacy fixtures order senseDetails in the same flattened
  // order as senses. Only use that positional mapping when it is unambiguous.
  if (details.length === flattenedSenseCount(word)) {
    return details[flatIndex];
  }

  // A one-item group can safely use its matching group-level detail.
  if (word.senses[groupIndex]?.items.length === 1) {
    return details[groupIndex];
  }

  return undefined;
};

const practiceExampleFrom = (
  word: Word,
  detail: SenseDetail | undefined,
  senseId: string,
): PracticeExample => {
  const sourceSentence: Sentence | undefined = detail?.sentences?.[0] || word.sentences?.[0];
  if (!sourceSentence) {
    return {
      exampleId: `${senseId}:example:primary`,
      text: `${word.w} — 暂无学习例句`,
      translation: '',
      sourceLabel: '学习例句',
      audioUrl: null,
    };
  }

  return {
    exampleId: `${senseId}:example:primary`,
    text: stripExampleMarkup(sourceSentence.en),
    translation: stripExampleMarkup(sourceSentence.zh),
    sourceLabel: '学习例句',
    audioUrl: null,
  };
};

/** Flatten legacy word data into stable, sense-granular practice items. */
export const flattenPracticeSenses = (words: readonly Word[]): PracticeSenseItem[] => {
  const result: PracticeSenseItem[] = [];
  words.forEach((word) => {
    let flatIndex = 0;
    word.senses.forEach((group, groupIndex) => {
      group.items.forEach((meaning, itemIndex) => {
        const senseId = stableSenseId(word, groupIndex, itemIndex);
        const detail = matchingSenseDetail(word, meaning, groupIndex, flatIndex, senseId);
        result.push({
          senseId,
          wordId: stableWordId(word),
          word: word.w,
          syllable: word.syl,
          phonetic: word.ph,
          pronunciationAudioUrl: null,
          pos: group.pos,
          meaning,
          example: practiceExampleFrom(word, detail, senseId),
          sourceWord: word,
        });
        flatIndex += 1;
      });
    });
  });
  return result;
};

export const LEGACY_PRACTICE_SENSES = flattenPracticeSenses(WORDS);

/**
 * Project approved Package practice resources without deriving identity from
 * a legacy Word registry. Legacy practice remains available for independent
 * reference surfaces, but installed runtime Packages are listed first and
 * use their stable package/sense IDs.
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
    syllable: pkg.content.syllables ?? pkg.content.lemma,
    phonetic: pkg.content.ipa,
    pronunciationAudioUrl: (
      pkg.content.pronunciations.find((pronunciation) => pronunciation.accentLocale === 'en-US')
      ?? pkg.content.pronunciations[0]
    )?.audioUrl ?? null,
    pos: pkg.content.partOfSpeech,
    meaning: pkg.content.guideLabelL1,
    example: {
      exampleId: example.exampleKey,
      text: stripExampleMarkup(example.textL2),
      translation: stripExampleMarkup(example.textL1),
      sourceLabel: '学习例句' as const,
      audioUrl: example.audioUrl,
    },
    sourceWord: toWordPresentation(pkg.content),
  }];
});

/** Formal/default practice inventory is Package-only; the legacy projection is isolated. */
export const PRACTICE_SENSES: PracticeSenseItem[] = RUNTIME_PRACTICE_SENSES;

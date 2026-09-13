import {sensaLanguageForDeclaredTag, sensaLanguageForIso6393} from '@sensa/contracts/sensa';
import type {CaptureLanguageSource} from '@sensa/contracts/sensa';

/**
 * What language a piece of captured text is in, and how that was worked out.
 *
 * Naming the language is a statement about the text. What it means for a
 * learner — their target language, their familiar language, or neither — is not
 * this client's to decide, because only the library holds the language profile.
 * So `null` travels all the way there instead of being filled in with a default.
 */
export interface CaptureLanguage {
  language: string | null;
  languageSource: CaptureLanguageSource | null;
}

export const unknownCaptureLanguage: CaptureLanguage = {language: null, languageSource: null};

/**
 * Below this many characters a detector is reading trigrams that Spanish and
 * Portuguese share, so a short selection on a page that declares nothing is
 * reported as undetermined rather than filed under a coin flip.
 */
export const minDetectableCharacters = 10;

/** A detector reads statistics, not a whole page: more than this adds nothing it
 * has not already seen and only widens the message to the service worker. */
export const maxDetectableCharacters = 512;

/** The material's own declaration, placed against the catalog. Cheapest
 * evidence, and the last resort for text too short to detect. */
export function declaredCaptureLanguage(root: Pick<Document, 'documentElement'> = document): CaptureLanguage {
  const declared = root.documentElement?.lang?.trim();
  if (!declared) return unknownCaptureLanguage;
  const language = sensaLanguageForDeclaredTag(declared);
  return language ? {language: language.tag, languageSource: 'declared'} : unknownCaptureLanguage;
}

/**
 * The language of `text`, detected locally and falling back to what the page
 * declares.
 *
 * The text comes first because it is the thing being labelled: a site that
 * serves many languages under one `lang` attribute is common, and the captured
 * sentence is better evidence than the document's claim about itself. The
 * declaration is the fallback for text too short for the detector to answer,
 * which is exactly the short-selection case.
 */
export async function detectCaptureLanguage(text: string): Promise<CaptureLanguage> {
  const sample = text.trim().slice(0, maxDetectableCharacters);
  if (sample.length >= minDetectableCharacters) {
    try {
      const answer = await chrome.runtime.sendMessage({kind: 'detect-language', text: sample});
      if (typeof answer?.language === 'string') {
        const language = sensaLanguageForIso6393(answer.language);
        if (language) return {language: language.tag, languageSource: 'detector'};
      }
    } catch {
      // A sleeping service worker or a reloading extension is not a reason to
      // lose the capture: the page declaration below is still evidence, and
      // failing that, an undetermined language is a supported answer.
    }
  }
  return declaredCaptureLanguage();
}

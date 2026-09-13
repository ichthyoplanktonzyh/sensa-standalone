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

/**
 * Below this many characters, "does this learner already read this?" is not a
 * question a detector can answer safely: trigram statistics are what tells
 * Spanish from Portuguese, and a short sample of two related languages reads the
 * same to them. Text this short inherits the language of the surface it sits on
 * instead of being sent for a coin flip.
 */
export const minSkimmableCharacters = 50;

/** Who a reading surface is writing for: the learner's own language, and whether
 * the text in hand is already in it. */
export interface ReaderLanguage {
  familiarLanguageTag: string;
  alreadyReadable: boolean;
}

/**
 * What this learner already reads, and whether this text is part of it.
 *
 * Text in the learner's own language gains nothing from being translated into
 * that same language, and asking the model to say so would spend a request and a
 * share of the daily budget to hand a paragraph back unchanged. So the question
 * is asked before the request is made — and asked here, of the background, which
 * is the only side that holds the pair the Web application published. A content
 * script can say what language text is in; what that language means to this
 * learner is not its to work out, so the answer comes back as an answer about
 * the learner rather than as the pair itself.
 *
 * `surfaceLanguage` is the language of the surface the text came from — a page's
 * own declaration, a caption track's code — and answers for text too short for a
 * detector to speak for itself. `null` means nothing could place the text, and
 * text nothing can place is not skipped: the learner gets a translation they did
 * not need rather than missing one they did.
 */
export async function readerLanguage(text: string, surfaceLanguage: string | null = null): Promise<ReaderLanguage | null> {
  try {
    const response = await chrome.runtime.sendMessage({kind: 'reading-language', text: text.slice(0, maxDetectableCharacters), surfaceLanguage});
    const answer = response?.value;
    if (typeof answer?.familiarLanguageTag !== 'string') return null;
    return {familiarLanguageTag: answer.familiarLanguageTag, alreadyReadable: answer.alreadyReadable === true};
  } catch {
    // A service worker that is asleep, or an extension reloaded under a live
    // page, is not a reason to withhold a translation the learner asked for:
    // translating everything is the safe direction, and its only cost is a
    // translation that was not needed.
    return null;
  }
}

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
      // The background answers inside the envelope it uses for every other
      // message — `{value}` or `{error}` — so the code is read from `value`, and
      // a response that never arrived is not mistaken for a detector that found
      // nothing.
      const response = await chrome.runtime.sendMessage({kind: 'detect-language', text: sample});
      const code = response?.value?.language;
      if (typeof code === 'string') {
        const language = sensaLanguageForIso6393(code);
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

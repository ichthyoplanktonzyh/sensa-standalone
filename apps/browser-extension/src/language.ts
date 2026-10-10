import {sensaCanonicalLanguageTag,sensaLanguageForIso6393} from '@sensa/contracts/sensa';
import type {CaptureLanguageSource} from '@sensa/contracts/sensa';

/**
 * What language a piece of captured text is in, and how that was worked out.
 *
 * Naming the language is a statement about the text. What it means for a
 * learner — a Target Language, a Support Language, both, or neither — is not
 * this client's to decide, because only the library holds the active Route.
 * So `null` travels all the way there instead of being filled in with a default.
 */
export interface CaptureLanguage {
  language: string | null;
  languageSource: CaptureLanguageSource | null;
  languageConfidence:number|null;
}

export const unknownCaptureLanguage: CaptureLanguage = {language: null, languageSource: null,languageConfidence:null};

/**
 * Very short selections offer little language evidence. Without a source
 * declaration they remain undetermined instead of forcing a detector guess.
 */
export const minDetectableCharacters = 10;

/** A detector reads statistics, not a whole page: more than this adds nothing it
 * has not already seen and only widens the message to the service worker. */
export const maxDetectableCharacters = 512;

/**
 * Below this many characters, "does this already match the Support Language?" is not a
 * question a detector can answer safely. Text this short can inherit the
 * source's declaration; an uncertain longer sample must not inherit a global
 * page language and thereby skip a foreign paragraph.
 */
export const minSkimmableCharacters = 50;

/** Which Support Language a reading surface is rendering into, and whether the
 * text in hand is already in that exact language. */
export interface ReaderLanguage {
  supportLanguageTag: string;
  sourceLanguageTag: string | null;
  alreadyReadable: boolean;
}

/**
 * Whether this text already matches the current Route's Support Language.
 *
 * Text in the Route's Support Language gains nothing from being translated into
 * that same language, and asking the model to say so would spend a request and a
 * share of the daily budget to hand a paragraph back unchanged. So the question
 * is asked before the request is made — and asked here, of the background, which
 * is the only side that holds the selected Route from the collection the Web
 * application published. A content script can say what language text is in;
 * it cannot infer what that language means for this operation, so the answer is
 * about the Route rather than a claim about languages the learner knows.
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
    if (typeof answer?.supportLanguageTag !== 'string') return null;
    return {supportLanguageTag: answer.supportLanguageTag, sourceLanguageTag: typeof answer.sourceLanguageTag==='string'?sensaCanonicalLanguageTag(answer.sourceLanguageTag):null, alreadyReadable: answer.alreadyReadable === true};
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
type DeclaredLanguageSurface={documentElement:Pick<HTMLElement,'lang'>|null};
export function declaredCaptureLanguage(root: DeclaredLanguageSurface = document): CaptureLanguage {
  const declared = root.documentElement?.lang?.trim();
  if (!declared) return unknownCaptureLanguage;
  const language=sensaCanonicalLanguageTag(declared);
  return language&&language!=='und'?{language,languageSource:'declared',languageConfidence:1}:unknownCaptureLanguage;
}

/**
 * The language of `text`, detected locally. Only short text falls back to the
 * page declaration; uncertainty about a longer paragraph remains uncertainty.
 *
 * The text comes first because it is the thing being labelled: a site that
 * serves many languages under one `lang` attribute is common, and the captured
 * sentence is better evidence than the document's claim about itself. The
 * declaration is the fallback for text too short for the detector to answer,
 * which is exactly the short-selection case.
 */
export async function detectCaptureLanguage(text: string,root:DeclaredLanguageSurface=document): Promise<CaptureLanguage> {
  const sample = text.trim().slice(0, maxDetectableCharacters);
  if (sample.length >= minDetectableCharacters) {
    try {
      // The background answers inside the envelope it uses for every other
      // message — `{value}` or `{error}` — so the code is read from `value`, and
      // a response that never arrived is not mistaken for a detector that found
      // nothing.
      const response = await chrome.runtime.sendMessage({kind: 'detect-language', text: sample});
      const observation=response?.value?.language;
      if(observation&&typeof observation.code==='string'&&typeof observation.confidence==='number'){
        const language=sensaLanguageForIso6393(observation.code)?.tag??sensaCanonicalLanguageTag(observation.code);
        if(language)return {language,languageSource:'detector',languageConfidence:observation.confidence};
      }
    } catch {
      // An undetermined language is a supported capture, not a reason to label
      // a longer foreign paragraph with the website's global UI language.
    }
  }
  return sample.length<minSkimmableCharacters?declaredCaptureLanguage(root):unknownCaptureLanguage;
}

/** Page headings and short blocks do not contain enough evidence for a
 * reliable statistical language choice. Their own declaration is evidence,
 * not the learner's Route and not a silent default to English. */
export async function detectBlockLanguage(text:string,root:DeclaredLanguageSurface=document):Promise<CaptureLanguage>{
 const declared=declaredCaptureLanguage(root);
 return text.trim().length<minSkimmableCharacters&&declared.language?declared:detectCaptureLanguage(text,root);
}

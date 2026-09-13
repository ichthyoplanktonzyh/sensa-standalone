import {defaultSensaLanguageRoute,sensaLanguage,sensaLanguages,sensaResolveLanguageSupport,type SensaLanguageSupportResolution} from '@sensa/contracts/sensa';
import { languageRoutesSnapshot } from '../../data/library/language';

/**
 * The language spoken media is produced in.
 *
 * Two providers speak for the learner: the device's own speech synthesizer and
 * the clip provider behind real-world listening. Both were asked for English no
 * matter which language the learner was studying, so a Spanish word was read
 * aloud with an English voice and searched for in an English corpus. Neither
 * takes an interface language, and neither may take one: what a word sounds like
 * belongs to the word.
 */

/** The locale device speech synthesis is asked for. A synthesizer matches an
 * installed voice by locale, so a bare language subtag finds nothing on most
 * systems; the catalog carries the locale that does. */
export function spokenLanguageSupport(languageTag:string):SensaLanguageSupportResolution {
  return sensaResolveLanguageSupport(languageTag,sensaLanguages.map(language=>language.tag));
}

function supportedLanguage(languageTag:string){
  const resolution=spokenLanguageSupport(languageTag);
  if(resolution.status==='unavailable'||!resolution.effectiveLanguageTag)throw new Error('localFlow.languageCapabilityUnavailable');
  return sensaLanguage(resolution.effectiveLanguageTag)!;
}

export function speechLocaleFor(languageTag: string): string {
  return supportedLanguage(languageTag).speechLocale;
}

/**
 * The active target language at the moment of playback.
 *
 * Read per playback rather than cached: choosing a language is a standing
 * decision and the next word the learner plays must already belong to it. A
 * library that cannot be read speaks the shipped pair instead of failing — a
 * missing voice is a smaller defect than a silent player.
 */
export async function activeSpeechLanguage(): Promise<{
  languageTag: string;
  speechLocale: string;
}> {
  let languageTag = defaultSensaLanguageRoute.targetLanguageTag;
  try {
    languageTag = (await languageRoutesSnapshot()).activeRoute.targetLanguageTag;
  } catch {
    // Storage is unavailable; the shipped pair is still a real language.
  }
  return { languageTag, speechLocale: speechLocaleFor(languageTag) };
}

/** The accent filters the clip provider offers are per language, and only
 * English's are known here. Another language offers no accent filter rather than
 * a row of English ones that would return nothing. */
export function clipAccentsFor(languageTag: string): readonly string[] {
  return supportedLanguage(languageTag).wiktionaryCode === 'en'
    ? ['all', 'us', 'uk', 'aus', 'ca', 'ie']
    : ['all'];
}

/** The clip provider names a language in English and in lower case. The catalog
 * name of Chinese carries its script in parentheses, so only the leading word is
 * used; every other catalog name is already the single word the provider wants. */
export function clipLanguageFor(languageTag: string): string {
  const name = supportedLanguage(languageTag).names.en;
  return name.split(/[\s(]/u)[0]!.toLocaleLowerCase('en');
}

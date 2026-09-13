import {sensaLanguage,sensaLanguageDisplayName} from '@sensa/contracts/sensa';
import {extensionLanguage,t} from './i18n';

/**
 * Reading text aloud in the language it is written in.
 *
 * The device's own synthesizer is the only voice this extension has: it needs no
 * key, sends nothing anywhere and costs nothing, which is what makes it usable on
 * any page. What it must never do is speak in the wrong language — a word read
 * with the wrong voice is a wrong pronunciation presented as the word's — and
 * this surface used to ask for English whatever the learner was reading, so a
 * learner of Spanish was told their browser had no English voice.
 *
 * The rules here are the Web application's device speech, deliberately: the same
 * learner should hear the same voice on both surfaces. They are written twice
 * because the two surfaces are bundled separately and share no code, so the other
 * copy is `apps/web/src/experience/services/audioService.ts`.
 */

/** The locale device speech is asked for. A synthesizer matches an installed
 * voice by locale, and a bare language subtag finds nothing on most systems, so
 * the catalog carries the locale that does. Nothing is guessed: a language this
 * release cannot place has no locale, and text nothing can place is not read
 * aloud. */
export function speechLocaleFor(languageTag: string | null): string | null {
  return languageTag ? sensaLanguage(languageTag)?.speechLocale ?? null : null;
}

export type SpeechFailure = 'unsupported' | 'no_language' | 'no_voice';
export type SpeechAttempt =
  | {ok: true; stop: () => void}
  | {ok: false; reason: SpeechFailure; languageTag: string | null};

/** Speech is asked for slightly slower than the learner set, as the Web
 * application asks for it: the point of hearing a word is hearing it. */
const speechRate = (value: number | undefined) => Math.min(2, Math.max(0.5, Number.isFinite(value) ? value! : 1)) * 0.92;

/**
 * Chrome fills its voice list asynchronously, so an empty list on the first call
 * is not the same as a browser with no voices installed. Waiting briefly for the
 * event costs a moment; refusing a learner a voice they have is a bug they would
 * have to work around by pressing the button twice.
 */
function readyVoices(): Promise<SpeechSynthesisVoice[]> {
  const synthesis = window.speechSynthesis;
  const voices = synthesis.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      synthesis.removeEventListener('voiceschanged', finish);
      resolve(synthesis.getVoices());
    };
    const timer = setTimeout(finish, 500);
    synthesis.addEventListener('voiceschanged', finish);
  });
}

/**
 * The installed voices that can pronounce this locale, best first.
 *
 * Only voices that live on the machine: a network voice would be a request the
 * learner did not ask for and, on a page whose text is under study, one nobody
 * could audit. A voice matching the whole locale is preferred over one matching
 * only the language, since `es-MX` and `es-ES` are not the same reading.
 */
function voicesFor(locale: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const normalize = (lang: string) => lang.replace('_', '-').toLowerCase();
  const installed = voices.filter(voice => voice.localService);
  const wanted = locale.toLowerCase();
  const exact = installed.filter(voice => normalize(voice.lang).startsWith(wanted));
  if (exact.length) return exact;
  const primary = wanted.split('-')[0]!;
  return installed.filter(voice => normalize(voice.lang).split('-')[0] === primary);
}

/** Among voices that can pronounce the language, prefer the ones whose names say
 * they are the higher-quality engines rather than whichever the browser listed
 * first. The Web application additionally names its preferred Apple voices for
 * English; this surface takes what the platform offers. */
const preferred = (pool: SpeechSynthesisVoice[]) =>
  pool.find(voice => voice.name.includes('Natural') || voice.name.includes('Google')) ?? pool[0]!;

/**
 * Speak `text` in the language it is written in, or say why it cannot be spoken.
 *
 * A failure is a result rather than a silent no-op: every caller has to tell the
 * learner something, and "no voice for this language" and "this text has no
 * known language" are different things to tell them.
 */
export async function speakText(text: string, languageTag: string | null, options: {rate?: number; onEnd?: () => void} = {}): Promise<SpeechAttempt> {
  if (!text.trim() || typeof window === 'undefined' || !('speechSynthesis' in window)) return {ok: false, reason: 'unsupported', languageTag};
  const locale = speechLocaleFor(languageTag);
  if (!locale) return {ok: false, reason: 'no_language', languageTag};
  const pool = voicesFor(locale, await readyVoices());
  if (!pool.length) return {ok: false, reason: 'no_voice', languageTag};
  const synthesis = window.speechSynthesis;
  synthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale;
  utterance.voice = preferred(pool);
  utterance.rate = speechRate(options.rate);
  utterance.pitch = 1;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    options.onEnd?.();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  try {
    synthesis.speak(utterance);
  } catch {
    finish();
    return {ok: false, reason: 'no_voice', languageTag};
  }
  return {ok: true, stop: () => {
    if (finished) return;
    finished = true;
    utterance.onend = utterance.onerror = null;
    synthesis.cancel();
  }};
}

/** What to tell the learner when speech did not happen. The language is named
 * because "no voice" is only actionable if the learner knows which voice is
 * missing. */
export function speechFailureText(attempt: Extract<SpeechAttempt, {ok: false}>): string {
  if (attempt.reason === 'no_language') return t('speechNoLanguage');
  if (attempt.reason === 'no_voice') return t('speechNoVoice', {language: attempt.languageTag ? sensaLanguageDisplayName(attempt.languageTag, extensionLanguage()) : ''});
  return t('speechUnavailable');
}

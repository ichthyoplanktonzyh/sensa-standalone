import {franc} from 'franc';

/**
 * The ISO 639-3 code a local detector answers for `text`, or nothing.
 *
 * `franc` reads trigram statistics, which is why it runs in the background
 * service worker rather than in the content script: its tables are a quarter of
 * a megabyte, and a page should not pay for them to detect one selection. The
 * content script messages this worker instead, and the answer travels back as a
 * plain code.
 *
 * The answer is deliberately NOT placed against the language catalog here —
 * `sensaLanguageForIso6393` does that at the caller, so this module stays a
 * detector and never becomes a second language table.
 */
export function detectIso6393(text: string): string | null {
  const code = franc(text);
  return code === 'und' ? null : code;
}

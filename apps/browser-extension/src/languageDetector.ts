import {franc} from 'franc';
import {sensaLanguages} from '@sensa/contracts/sensa';

/**
 * The ISO 639-3 codes this release can place, which is also the only set a
 * detector is allowed to choose from.
 *
 * Left open, the detector answers `sco` for plain English — Scots and English
 * share enough trigrams that a paragraph of one reads as the other — and an
 * answer no release can place is the same as no answer at all. Handing it the
 * catalog turns "which of six thousand languages is this?" into "which of the
 * languages we support is this?", which is the question actually being asked and
 * the one it answers correctly.
 */
const detectable = sensaLanguages.map(language => language.iso6393);

/**
 * The ISO 639-3 code a local detector answers for `text`, or nothing.
 *
 * `franc` reads trigram statistics, which is why it runs in the background
 * service worker rather than in the content script: its tables are a quarter of
 * a megabyte, and a page should not pay for them to detect one selection. The
 * content script messages this worker instead, and the answer travels back as a
 * plain code.
 *
 * The answer is deliberately NOT placed against the catalog here —
 * `sensaLanguageForIso6393` does that at the caller, so this module stays a
 * detector and never becomes a second language table. The catalog above is a
 * candidate list, not a table: nothing here reads a name, a role or a script.
 */
export function detectIso6393(text: string): string | null {
  const code = franc(text, {only: detectable});
  return code === 'und' ? null : code;
}

import {francAll} from 'franc';

/**
 * The open-set ISO 639-3 observation a local detector answers, or nothing.
 *
 * `franc` reads trigram statistics, which is why it runs in the background
 * service worker rather than in the content script: its tables are a quarter of
 * a megabyte, and a page should not pay for them to detect one selection. The
 * content script messages this worker instead, and the answer travels back as a
 * plain code.
 *
 * Confidence is the separation from the runner-up, not a manufactured
 * probability. Most importantly, the candidate set is not restricted to what
 * this release supports: an unsupported observation stays unsupported.
 */
export function detectIso6393(text: string):{code:string;confidence:number}|null {
  const [first,second]=francAll(text);
  if(!first||first[0]==='und')return null;
  return {code:first[0],confidence:Math.max(0,Math.min(1,first[1]-(second?.[1]??0)))};
}

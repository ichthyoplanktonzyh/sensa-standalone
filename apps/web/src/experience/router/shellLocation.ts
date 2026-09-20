/**
 * The shell's navigation state, expressed as a URL.
 *
 * Two independent dimensions had been two `useState`s in App:
 *
 *   - `mainStack` -- the navigation history of the main page shell. A bounded
 *     ScreenHost mounts only its current and outgoing entries; history remains
 *     in the URL instead of remaining alive as hidden DOM.
 *   - `viewMode`  -- whether a full-screen learning flow covers the shell.
 *     Entering a flow must NOT discard the sheet stack: leaving it returns
 *     the learner to exactly the sheets they came from.
 *
 * Encoding one in the pathname and the other in a search param keeps both
 * dimensions independent, which a single "current route" could not express.
 *
 *   /                              main shell, empty stack
 *   /study/learning-library        stack = [s-study, s-learning-library]
 *   /study/learning-library?flow=lightweight   same stack, learning flow on top
 *
 * Sheet ids carry an `s-` prefix in the DOM (`id="s-academy"`); the URL drops
 * it, so a path segment is the bare sheet name.
 */

import {
  KNOWN_SHEET_IDS,
  KNOWN_SHEET_ID_SET,
  SHELL_PARAM_KEYS,
  screenInstanceKey,
  shellScreenParams,
  type ShellParams,
} from './screenRegistry';

export {KNOWN_SHEET_IDS,SHELL_PARAM_KEYS,screenInstanceKey};
export type {ShellParams};

export type ShellFlow = 'lightweight';

/** `viewMode` as App has always spelled it: 'main' plus the four flows. */
export type ViewMode = 'main' | ShellFlow;

export const SHEET_ID_PREFIX = 's-';

/**
 * Every sheet the main shell can stack. Parsing filters against this list so a
 * hand-typed or stale URL cannot push a phantom entry that renders nothing but
 * still costs the learner a back press.
 */
const bare = (sheetId: string): string =>
  sheetId.startsWith(SHEET_ID_PREFIX) ? sheetId.slice(SHEET_ID_PREFIX.length) : sheetId;

/**
 * Sheet ids repeat their parent's name (`s-content` -> `s-content-library`),
 * which would spell `/content/content-library`. Dropping a prefix the previous
 * segment already carries gives `/content/library` instead.
 *
 * The rule is reversible without a lookup table: when parsing, a segment is
 * first tried joined to its parent, and only falls back to standing alone --
 * so `/content/library` resolves to `s-content-library` while
 * `/academy/real-world-listening` resolves to `s-real-world-listening`.
 */
const toSegment = (sheetId: string, parentSheetId: string | undefined): string => {
  const name = bare(sheetId);
  if (parentSheetId === undefined) return name;
  const parentName = `${bare(parentSheetId)}-`;
  return name.startsWith(parentName) ? name.slice(parentName.length) : name;
};

const toSheetId = (segment: string, parentSheetId: string | undefined): string | undefined => {
  if (parentSheetId !== undefined) {
    const nested = `${parentSheetId}-${segment}`;
    if (KNOWN_SHEET_ID_SET.has(nested)) return nested;
  }
  const standalone = segment.startsWith(SHEET_ID_PREFIX)
    ? segment
    : `${SHEET_ID_PREFIX}${segment}`;
  return KNOWN_SHEET_ID_SET.has(standalone) ? standalone : undefined;
};

const FLOWS: readonly ShellFlow[] = ['lightweight'];

const isFlow = (value: unknown): value is ShellFlow =>
  typeof value === 'string' && (FLOWS as readonly string[]).includes(value);

/**
 * Read the sheet stack out of a pathname. Empty segments are dropped so `/`,
 * `//` and `/academy/` all behave; unknown segments are dropped so a bad URL
 * degrades to the deepest stack it does describe rather than to an error.
 */
const parseMainStackResult = (pathname: string): { readonly stack: string[]; readonly known: boolean } => {
  const stack: string[] = [];
  let known = true;
  for (const segment of pathname.split('/')) {
    if (segment.length === 0) continue;
    // Retired word-book lists now resolve to the single learning-content list.
    if (segment === 'wordlist' || segment === 's-wordlist') {
      stack.splice(0, stack.length, 's-study', 's-learning-library');
      continue;
    }
    // Portable listening was removed, not renamed to real-world listening.
    if (segment === 'listening' || segment === 's-listening') {
      if (stack.length === 0) stack.push('s-academy');
      continue;
    }
    const sheetId = toSheetId(segment, stack[stack.length - 1]);
    if (sheetId === undefined || stack.includes(sheetId)) {
      known = false;
      continue;
    }
    stack.push(sheetId);
  }
  return { stack, known };
};

export const parseMainStack = (pathname: string): string[] => parseMainStackResult(pathname).stack;

/** Whether every non-empty segment describes a real or explicitly retired shell route. */
export const isKnownShellPath = (pathname: string): boolean => {
  const result = parseMainStackResult(pathname);
  return result.known && result.stack.length > 0;
};

/** A flow search param that is absent or unrecognised means the main shell. */
export const parseViewMode = (rawFlow: unknown): ViewMode => (isFlow(rawFlow) ? rawFlow : 'main');

/**
 * Each param belongs to the sheet that reads it. When that sheet leaves the
 * stack the param is dropped, so the URL stays a description of what is on
 * screen rather than accumulating every id the learner ever visited.
 */
/** Read the navigation params a search object carries, ignoring anything else. */
export const parseShellParams = (search: Record<string, unknown>): ShellParams => {
  const params: Record<string, string> = {};
  for (const key of SHELL_PARAM_KEYS) {
    const value = search[key];
    if (typeof value === 'string' && value.length > 0) params[key] = value;
  }
  return params as ShellParams;
};

/** Drop params whose owning sheet is no longer on the stack. */
export const retainParamsForStack = (
  params: ShellParams,
  stack: readonly string[],
): ShellParams => {
  const live = new Set<string>();
  for (const sheetId of stack) {
    for (const key of shellScreenParams(sheetId)) live.add(key);
  }
  const kept: Record<string, string> = {};
  for (const key of SHELL_PARAM_KEYS) {
    const value = params[key];
    if (value !== undefined && live.has(key)) kept[key] = value;
  }
  return kept as ShellParams;
};

/** Build the pathname for a sheet stack. Inverse of {@link parseMainStack}. */
export const buildPathname = (stack: readonly string[]): string => {
  if (stack.length === 0) return '/';
  const segments = stack.map((sheetId, index) => toSegment(sheetId, stack[index - 1]));
  return `/${segments.join('/')}`;
};

/** The search object for a view mode -- 'main' clears the param entirely. */
export const buildSearch = (viewMode: ViewMode): { flow?: ShellFlow } =>
  viewMode === 'main' ? {} : { flow: viewMode };

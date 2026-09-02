/**
 * The shell's navigation state, expressed as a URL.
 *
 * Two independent dimensions had been two `useState`s in App:
 *
 *   - `mainStack` -- the sheet stack of the main page shell. Sheets stay
 *     mounted and are moved off-screen by CSS transform, so the stack is a
 *     set of simultaneously-active screens, not a single current page.
 *   - `viewMode`  -- whether a full-screen learning flow covers the shell.
 *     Entering a flow must NOT discard the sheet stack: leaving it returns
 *     the learner to exactly the sheets they came from.
 *
 * Encoding one in the pathname and the other in a search param keeps both
 * dimensions independent, which a single "current route" could not express.
 *
 *   /                              main shell, empty stack
 *   /academy/wordlist              stack = [s-academy, s-wordlist]
 *   /academy/wordlist?flow=study   same stack, learning flow on top
 *
 * Sheet ids carry an `s-` prefix in the DOM (`id="s-academy"`); the URL drops
 * it, so a path segment is the bare sheet name.
 */

export type ShellFlow = 'study' | 'lightweight' | 'lightweightReview' | 'finish';

/** `viewMode` as App has always spelled it: 'main' plus the four flows. */
export type ViewMode = 'main' | ShellFlow;

export const SHEET_ID_PREFIX = 's-';

/**
 * Every sheet the main shell can stack. Parsing filters against this list so a
 * hand-typed or stale URL cannot push a phantom entry that renders nothing but
 * still costs the learner a back press.
 */
export const KNOWN_SHEET_IDS = [
  's-academy',
  's-confirmed-sense',
  's-content',
  's-content-coming',
  's-content-example',
  's-content-library',
  's-content-sense',
  's-expression-binding',
  's-learning-entry',
  's-learning-library',
  's-learning-policy',
  's-learning-target',
  's-listening',
  's-personal-meaning',
  's-profile',
  's-real-world-listening',
  's-semantic-world',
  's-stats',
  's-study',
  's-wordlist',
] as const;

const KNOWN_SHEET_ID_SET: ReadonlySet<string> = new Set(KNOWN_SHEET_IDS);

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
 * `/academy/listening` resolves to `s-listening`, no mapping to maintain.
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

const FLOWS: readonly ShellFlow[] = ['study', 'lightweight', 'lightweightReview', 'finish'];

const isFlow = (value: unknown): value is ShellFlow =>
  typeof value === 'string' && (FLOWS as readonly string[]).includes(value);

/**
 * Read the sheet stack out of a pathname. Empty segments are dropped so `/`,
 * `//` and `/academy/` all behave; unknown segments are dropped so a bad URL
 * degrades to the deepest stack it does describe rather than to an error.
 */
export const parseMainStack = (pathname: string): string[] => {
  const stack: string[] = [];
  for (const segment of pathname.split('/')) {
    if (segment.length === 0) continue;
    const sheetId = toSheetId(segment, stack[stack.length - 1]);
    if (sheetId === undefined || stack.includes(sheetId)) continue;
    stack.push(sheetId);
  }
  return stack;
};

/** A flow search param that is absent or unrecognised means the main shell. */
export const parseViewMode = (rawFlow: unknown): ViewMode => (isFlow(rawFlow) ? rawFlow : 'main');

/** Build the pathname for a sheet stack. Inverse of {@link parseMainStack}. */
export const buildPathname = (stack: readonly string[]): string => {
  if (stack.length === 0) return '/';
  const segments = stack.map((sheetId, index) => toSegment(sheetId, stack[index - 1]));
  return `/${segments.join('/')}`;
};

/** The search object for a view mode -- 'main' clears the param entirely. */
export const buildSearch = (viewMode: ViewMode): { flow?: ShellFlow } =>
  viewMode === 'main' ? {} : { flow: viewMode };

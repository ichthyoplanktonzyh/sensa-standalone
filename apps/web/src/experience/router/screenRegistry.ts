export const SHELL_PARAM_KEYS = [
  'senseId',
  'exampleId',
  'section',
  'coming',
  'meaningId',
  'alignmentId',
  'focusId',
  'targetId',
  'bookKey',
  'packageKey',
  'publicationArchiveSha256',
  'worldAction',
  'enrollmentId',
  'query',
  'route',
  'sort',
  'page',
  'pageSize',
  'view',
  'learningFilter',
  'learningQuery',
  'learningSort',
  'learningPage',
] as const;

export type ShellParamKey = (typeof SHELL_PARAM_KEYS)[number];
export type ShellParams = Readonly<Partial<Record<ShellParamKey, string>>>;

type ShellScreenDefinition = Readonly<{
  id: `s-${string}`;
  host: 'app' | 'learning' | 'practice';
  params?: readonly ShellParamKey[];
  instance?: Readonly<{
    params: readonly ShellParamKey[];
    defaults?: Readonly<Partial<Record<ShellParamKey, string>>>;
  }>;
}>;

/**
 * One declaration owns every navigable sheet's rendering host, URL params and
 * screen-memory identity. Path spelling remains derived from the id so adding
 * a screen cannot leave parser, serializer and dispatcher allowlists apart.
 */
export const SHELL_SCREEN_DEFINITIONS = [
  { id: 's-academy', host: 'practice' },
  { id: 's-catalog', host: 'learning', params: ['query','route','sort','page','pageSize','view'] },
  { id: 's-catalog-book', host: 'learning', params: ['bookKey'], instance: { params: ['bookKey'] } },
  { id: 's-confirmed-sense', host: 'learning', params: ['meaningId', 'focusId'], instance: { params: ['meaningId', 'focusId'] } },
  { id: 's-content', host: 'learning', params: ['worldAction'] },
  { id: 's-content-coming', host: 'app', params: ['coming'], instance: { params: ['coming'], defaults: { coming: 'scenes' } } },
  { id: 's-content-example', host: 'app', params: ['exampleId'], instance: { params: ['exampleId'] } },
  { id: 's-content-library', host: 'app', params: ['section'], instance: { params: ['section'], defaults: { section: 'recent' } } },
  { id: 's-content-sense', host: 'app', params: ['senseId','targetId','meaningId','alignmentId'], instance: { params: ['senseId','targetId','meaningId','alignmentId'] } },
  { id: 's-expression-binding', host: 'app', params: ['meaningId', 'focusId'], instance: { params: ['meaningId', 'focusId'] } },
  { id: 's-learning-entry', host: 'learning' },
  { id: 's-direct-learning', host: 'learning', params: ['enrollmentId'], instance: { params: ['enrollmentId'], defaults: { enrollmentId: 'search' } } },
  { id: 's-learning-library', host: 'learning',params:['learningFilter','learningQuery','learningSort','learningPage'] },
  { id: 's-learning-target', host: 'learning', params: ['targetId'], instance: { params: ['targetId'] } },
  { id: 's-library', host: 'learning' },
  { id: 's-library-package', host: 'learning', params: ['packageKey','publicationArchiveSha256'], instance: { params: ['packageKey','publicationArchiveSha256'] } },
  { id: 's-personal-meaning', host: 'learning', params: ['meaningId', 'focusId'], instance: { params: ['meaningId'], defaults: { meaningId: 'new' } } },
  { id: 's-practice-scope', host: 'practice' },
  { id: 's-profile', host: 'learning' },
  { id: 's-publisher', host: 'learning' },
  { id: 's-real-world-listening', host: 'practice' },
  { id: 's-semantic-world', host: 'learning', params: ['worldAction'] },
  { id: 's-stats', host: 'learning' },
  { id: 's-study', host: 'learning' },
] as const satisfies readonly ShellScreenDefinition[];

type RegisteredScreen = (typeof SHELL_SCREEN_DEFINITIONS)[number];
export type ShellScreenId = RegisteredScreen['id'];
export type AppShellScreenId = Extract<RegisteredScreen, { host: 'app' }>['id'];
export type LearningShellScreenId = Extract<RegisteredScreen, { host: 'learning' }>['id'];

export const KNOWN_SHEET_IDS: readonly ShellScreenId[] = SHELL_SCREEN_DEFINITIONS.map(({ id }) => id);
export const KNOWN_SHEET_ID_SET: ReadonlySet<string> = new Set(KNOWN_SHEET_IDS);

const definitionsById = new Map<string, ShellScreenDefinition>(
  SHELL_SCREEN_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export const shellScreenHost = (screenId: string): 'app' | 'learning' | 'practice' | undefined =>
  definitionsById.get(screenId)?.host;

export const shellScreenParams = (screenId: string): readonly ShellParamKey[] =>
  definitionsById.get(screenId)?.params ?? [];

/** Stable identity for scroll/UI memory without retaining a screen DOM tree. */
export const screenInstanceKey = (screenId: string, params: ShellParams): string => {
  const identity = definitionsById.get(screenId)?.instance;
  if (!identity) return screenId;
  const values = identity.params.map((key) => params[key] ?? identity.defaults?.[key] ?? 'missing');
  return `${screenId}:${values.join(':')}`;
};

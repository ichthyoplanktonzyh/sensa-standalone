/**
 * Deterministic smoke for the shell's URL encoding.
 *
 * The sheet stack round-trips through the pathname, and the encoding drops a
 * prefix the parent segment already carries (`s-content` + `s-content-library`
 * spells `/content/library`). That shortening is only safe while it stays
 * exactly reversible, so this exhaustively checks every ordered stack up to
 * three sheets deep -- if a future sheet id makes two different stacks share a
 * pathname, this fails instead of the learner silently landing on the wrong
 * screen.
 *
 * No framework, browser or network: run with `npm run smoke:router`.
 */

import {
  KNOWN_SHEET_IDS,
  buildPathname,
  buildSearch,
  parseMainStack,
  parseShellParams,
  parseViewMode,
  retainParamsForStack,
  type ShellParams,
} from './shellLocation';

const ids = [...KNOWN_SHEET_IDS];
const failures: string[] = [];
let checked = 0;

const checkStack = (stack: readonly string[]): void => {
  checked += 1;
  const pathname = buildPathname(stack);
  const parsed = parseMainStack(pathname);
  if (parsed.join('>') !== stack.join('>')) {
    failures.push(`stack ${stack.join('>')} -> ${pathname} -> ${parsed.join('>')}`);
  }
};

checkStack([]);
for (const a of ids) checkStack([a]);
for (const a of ids) {
  for (const b of ids) {
    if (a === b) continue;
    checkStack([a, b]);
    for (const c of ids) {
      if (c === a || c === b) continue;
      checkStack([a, b, c]);
    }
  }
}

/** Distinct stacks must never collide on one pathname. */
const seen = new Map<string, string>();
for (const a of ids) {
  for (const b of ids) {
    if (a === b) continue;
    const stack = [a, b];
    const pathname = buildPathname(stack);
    const previous = seen.get(pathname);
    if (previous !== undefined && previous !== stack.join('>')) {
      failures.push(`collision on ${pathname}: ${previous} vs ${stack.join('>')}`);
    }
    seen.set(pathname, stack.join('>'));
  }
}

/** Unknown or malformed segments degrade rather than throw. */
const degraded: ReadonlyArray<readonly [string, string]> = [
  ['/bogus/nonsense/academy', 's-academy'],
  ['//academy//', 's-academy'],
  ['/', ''],
  ['/academy/academy', 's-academy'],
];
for (const [pathname, expected] of degraded) {
  checked += 1;
  const parsed = parseMainStack(pathname).join('>');
  if (parsed !== expected) {
    failures.push(`degrade ${pathname} -> "${parsed}", expected "${expected}"`);
  }
}

/** The flow param round-trips, and anything unrecognised means the main shell. */
for (const [raw, expected] of [
  ['study', 'study'],
  ['lightweight', 'lightweight'],
  ['lightweightReview', 'lightweightReview'],
  ['finish', 'finish'],
  ['nonsense', 'main'],
  [undefined, 'main'],
] as ReadonlyArray<readonly [unknown, string]>) {
  checked += 1;
  const viewMode = parseViewMode(raw);
  if (viewMode !== expected) {
    failures.push(`flow ${String(raw)} -> ${viewMode}, expected ${expected}`);
    continue;
  }
  const search = buildSearch(viewMode);
  const back = parseViewMode(search.flow);
  if (back !== viewMode) failures.push(`flow round-trip ${viewMode} -> ${back}`);
}

/** Params are read only from known keys, and only as non-empty strings. */
const parsed = parseShellParams({
  senseId: 'fragile.adj.physical-easily-broken',
  exampleId: '',
  section: 'saved-senses',
  unrelated: 'ignored',
  focusId: 42,
});
checked += 1;
if (
  parsed.senseId !== 'fragile.adj.physical-easily-broken'
  || parsed.section !== 'saved-senses'
  || 'exampleId' in parsed
  || 'focusId' in parsed
  || 'unrelated' in (parsed as Record<string, unknown>)
) {
  failures.push(`parseShellParams kept the wrong keys: ${JSON.stringify(parsed)}`);
}

/**
 * A param survives exactly as long as a sheet that reads it is on the stack.
 * Without this, leaving a sheet would strand its id in the URL and the next
 * shared link would describe a screen the learner is no longer looking at.
 */
const everyParam: ShellParams = {
  senseId: 'a',
  exampleId: 'b',
  section: 'notes',
  coming: 'scenes',
  meaningId: 'm',
  focusId: 'f',
};
const retention: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [[], []],
  [['s-content'], []],
  [['s-content', 's-content-sense'], ['senseId']],
  [['s-content', 's-content-library'], ['section']],
  [['s-content', 's-content-example'], ['exampleId']],
  [['s-content', 's-content-coming'], ['coming']],
  [['s-personal-meaning'], ['meaningId', 'focusId']],
  [['s-confirmed-sense'], ['meaningId', 'focusId']],
  [['s-expression-binding'], ['meaningId', 'focusId']],
  [['s-content', 's-content-sense', 's-content-example'], ['senseId', 'exampleId']],
];
for (const [stack, expectedKeys] of retention) {
  checked += 1;
  const kept = Object.keys(retainParamsForStack(everyParam, stack)).sort();
  const expected = [...expectedKeys].sort();
  if (kept.join(',') !== expected.join(',')) {
    failures.push(
      `retain on [${stack.join(',')}] kept [${kept.join(',')}], expected [${expected.join(',')}]`,
    );
  }
}

console.log(`shell location smoke: ${checked} 项`);
if (failures.length > 0) {
  console.error(`失败 ${failures.length} 项:`);
  for (const failure of failures.slice(0, 20)) console.error('  ' + failure);
  process.exit(1);
}
console.log('全部通过');

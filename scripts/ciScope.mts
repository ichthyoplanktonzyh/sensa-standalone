/** Conservative PR optimization. Unknown input always selects the full database suite. */
import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Keep this small: no dependency graph, package-name inference or broad src allowlist.
const presentationFiles = new Set([
  'apps/web/src/experience/ui/SensaComponents.tsx',
  'apps/web/src/experience/ui/SensaPageLayouts.tsx',
  'apps/web/src/experience/ui/SensaVirtualList.tsx',
  'apps/web/src/experience/ui/primitives.ts',
  'apps/web/src/experience/ui/meaningGraph.ts',
  'apps/web/src/experience/ui/meaningGraphEmphasis.ts',
  'apps/web/src/experience/ui/meaningGraphCanvasModel.ts',
]);
export function databaseDepthForChanges(event: string, paths: readonly string[] | null) {
  if (event !== 'pull_request') return {depth: 'full' as const, reason: 'main-or-explicit-run'};
  if (!paths?.length) return {depth: 'full' as const, reason: 'change-set-unavailable'};
  const safe = paths.every(path => !path.includes('..') && !/[\r\n\\]/.test(path) && (
    path.startsWith('docs/') || ['README.md','CONTEXT.md','DESIGN.md'].includes(path)
    || /^apps\/web\/src\/.+\.css$/.test(path)
    || presentationFiles.has(path)
  ));
  return safe ? {depth: 'core' as const, reason: 'documentation-or-listed-presentation-only'}
    : {depth: 'full' as const, reason: 'data-shared-or-unclassified-change'};
}

export function readChangedPaths(base: string, head: string): readonly string[] {
  if (![base,head].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw Error('Exact comparison revisions required');
  return execFileSync('git', ['diff','--name-only','--no-renames','-z',base,head,'--'], {encoding:'utf8',maxBuffer:4*1024*1024}).split('\0').filter(Boolean);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const eventName = process.env.GITHUB_EVENT_NAME ?? 'local';
  let paths: readonly string[] | null = null;
  if (eventName === 'pull_request') {
    try {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
      paths = readChangedPaths(event.pull_request?.base?.sha, process.env.GITHUB_SHA!);
    } catch { /* An unreadable event, shallow history or Git error cannot narrow CI. */ }
  }
  const selection = databaseDepthForChanges(eventName, paths);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `database_depth=${selection.depth}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### Database CI selection\n\n- Depth: \`${selection.depth}\`\n- Reason: ${selection.reason}\n- Changed paths: ${paths?.length ?? 'unknown'}\n\nCore is partial database evidence; main always runs full.\n`);
  console.log(`Database selection: ${selection.depth} (${selection.reason}).`);
}

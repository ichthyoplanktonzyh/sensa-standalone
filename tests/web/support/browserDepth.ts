import type {WebTestCatalogEntry} from '../catalog.mts';

export const browserDepths=['quick','full'] as const;
export type BrowserDepth=typeof browserDepths[number];
export function selectBrowserDepth(entries:readonly WebTestCatalogEntry[],depth:BrowserDepth){
  if(!browserDepths.includes(depth))throw Error('Unknown browser validation depth');
  return depth==='full'?entries:entries.filter(entry=>entry.browserDepth!=='full');
}
/** A quick run is explicitly not capacity acceptance; full never excludes it. */
export function browserGrepInvert(env:NodeJS.ProcessEnv){
  const patterns:RegExp[]=[];
  if(env.SENSA_SKIP_BOOK_SCALE_BENCHMARK==='true')patterns.push(/@book-scale-performance/);
  if(env.SENSA_BROWSER_DEPTH==='quick')patterns.push(/@capacity/);
  else if(env.SENSA_BROWSER_DEPTH!==undefined&&env.SENSA_BROWSER_DEPTH!=='full')throw Error('Unknown browser validation depth');
  return patterns.length?patterns:undefined;
}

import type {WebTestCatalogEntry} from './catalog.mts';

/** The same bounded gate runs on PRs and main. Other catalog tests remain explicit specialist checks. */
export const ciWhitelist = {
 node: ['canonical-digest','stored-record-codec','library-sync-blocks','consumer-auth-proof','email-link-boundary','operation-settlement','refresh-coordinator','version-store','learning-target-view','package-cache-projection','portable-lightweight-package','learning-authority','learning-command-receipt','candidate-source','release-preflight','api-release-identity','release-archive'],
 postgres: ['library-membership-migration','account-admission','operations-access-postgres','database-budget','account-deletion','model-request-state','intake-delivery'],
 e2e: ['ci-core-e2e'],
} as const;
export const ciLanes = ['node','postgres','e2e','all'] as const;
export type CiLane = typeof ciLanes[number];
export const ciCaseCounts: Readonly<Record<CiLane,number>> = {node:85,postgres:7,e2e:4,all:96};

export function selectCiTests(catalog:readonly WebTestCatalogEntry[],lane:CiLane):readonly WebTestCatalogEntry[]{
 const ids:readonly string[]=lane==='all'?Object.values(ciWhitelist).flat():ciWhitelist[lane];
 return ids.map(id=>{
  const entry=catalog.find(entry=>entry.id===id);
  if(!entry)throw Error(`Missing fixed CI test: ${id}`);
  return entry;
 });
}

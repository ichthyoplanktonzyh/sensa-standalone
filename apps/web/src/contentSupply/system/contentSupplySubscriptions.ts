import {observeLibrary,type Table} from '../../data/library/store';
import type {ContentSupplyQuery} from './contentSupplySystem';

const queryTables = {
  direct_provisioning_task:['personalLearning','meta'],
  workspace: ['packageCache', 'packageInstallations', 'meta'],
  catalog:['meta'],
  route_counts:['packageCache'],
  runtime_packages:['packageCache'],
  provisioning_control: ['personalLearning', 'providers', 'settings'],
  provisioning_tasks: ['personalLearning'],
  provisioning_task: ['personalLearning'],
} as const satisfies Record<ContentSupplyQuery['kind'], readonly Table[]>;

export const subscribeContentSupply=(query:ContentSupplyQuery,listener:()=>void):(()=>void)=>
  observeLibrary(listener,queryTables[query.kind],
    query.kind==='workspace'||query.kind==='catalog'?{meta:['package-catalog']}:undefined);

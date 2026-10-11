import {observeLibrary,type Table} from '../../data/library/store';
import type {ContentSupplyQuery} from './contentSupplySystem';

const queryTables = {
  book_preview:[],
  direct_provisioning_task:['personalLearning','learningTargets','supplementalMembershipStates','curriculumEnrollments','meta'],
  workspace: ['packageCache', 'packageInstallations', 'meta'],
  catalog:['meta'],
  catalog_snapshot:['meta'],
  route_counts:['packageCache'],
  runtime_packages:['packageCache'],
  package_summaries:['packageCache'],
  provisioning_control: ['personalLearning', 'learningTargets','supplementalMembershipStates','curriculumEnrollments', 'providers', 'settings'],
  provisioning_tasks: ['personalLearning','learningTargets','supplementalMembershipStates','curriculumEnrollments'],
  provisioning_task: ['personalLearning','learningTargets','supplementalMembershipStates','curriculumEnrollments'],
  personal_provisioning_source:['personalLearning','semanticMeanings','semanticRegistry','media'],
} as const satisfies Record<ContentSupplyQuery['kind'], readonly Table[]>;

export const subscribeContentSupply=(query:ContentSupplyQuery,listener:()=>void):(()=>void)=>
  query.kind==='book_preview'?()=>{}:observeLibrary(listener,queryTables[query.kind],
    query.kind==='workspace'||query.kind==='catalog'||query.kind==='catalog_snapshot'?{meta:['package-catalog']}:undefined);

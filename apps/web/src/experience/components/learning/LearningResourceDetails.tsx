import {useTranslation} from 'react-i18next';
import {localFlowText} from '../../../i18n/localFlowText';
import type {LightweightInitialLearningMaterialization} from '../../../contentSupply/provisioning/lightweightInitialContent';
import {LearningResource} from './LearningResource';
import {learningSupportMeaning} from '@sensa/contracts/sensa';
export function LearningResourceDetails({material}:{material:LightweightInitialLearningMaterialization}){
 useTranslation();const meaning=learningSupportMeaning(material.content.resources);return <details className="my-4 rounded-card border border-border-subtle p-4"><summary className="cursor-pointer rounded-control border border-border-strong bg-surface-subtle px-4 py-3 font-medium">{localFlowText('viewResources')}</summary><div className="mt-4 space-y-6">{material.content.resources.map(resource=><LearningResource key={resource.resourceKey} resource={resource} meaningPresentation={meaning}/>)}</div></details>;
}

import type {LearningResourceKind} from '@sensa/contracts/sensa';
import {localFlowText} from './localFlowText';

const resourceLabelKeys={
  experience_recall_cue:'resourceExperience',
  recall_support:'resourceHint',
  target_expression:'resourceExpression',
  sense_confirmation:'resourceMeaning',
  pronunciation:'resourcePronunciation',
  language_structure:'resourceStructure',
  usage_guidance:'resourceUsage',
  scene_bridge:'resourceBridge',
  scene_realization:'resourceSceneRealization',
  boundary_contrast:'resourceBoundaryContrast',
  word_formation:'resourceWordFormation',
  mnemonic:'resourceMnemonic',
  etymology:'resourceEtymology',
} as const satisfies Record<LearningResourceKind,string>;

export const learningResourceLabel=(kind:string):string=>{
  if(!Object.hasOwn(resourceLabelKeys,kind))throw new Error(`Unsupported learning resource: ${kind}`);
  return localFlowText(resourceLabelKeys[kind as LearningResourceKind]);
};

import {z} from 'zod';
import {sensaLightweightExpressionSnapshotSchema,type LearningResourceKind} from './learningResourceDefinitions.js';

export const REVEAL_RESOURCE_CATEGORIES=['pronunciation','meaning','usage','examples','contrast','word_formation','etymology','mnemonic'] as const;
export type RevealResourceCategory=typeof REVEAL_RESOURCE_CATEGORIES[number];
const category=z.enum(REVEAL_RESOURCE_CATEGORIES);
export const revealScopeAssessmentSchema=z.object({applicable:z.boolean(),reason:z.string().min(1),source:z.string().min(1)}).strict();
export const revealScopeAssessmentsSchema=z.partialRecord(category,revealScopeAssessmentSchema);
export const REVEAL_RESOURCE_CATALOGUE={
 pronunciation:{label:{'zh-CN':'发音',en:'Pronunciation'},roles:['pronunciation']},
 meaning:{label:{'zh-CN':'释义',en:'Meaning'},roles:['sense_confirmation','scene_bridge']},
 usage:{label:{'zh-CN':'用法',en:'Usage'},roles:['language_structure']},
 examples:{label:{'zh-CN':'例句',en:'Examples'},roles:['scene_realization','usage_guidance']},
 contrast:{label:{'zh-CN':'辨析',en:'Contrast'},roles:['boundary_contrast']},
 word_formation:{label:{'zh-CN':'构词',en:'Word formation'},roles:['word_formation']},
 etymology:{label:{'zh-CN':'词源',en:'Etymology'},roles:['etymology']},
 mnemonic:{label:{'zh-CN':'助记',en:'Memory aid'},roles:['mnemonic']},
} as const satisfies Record<RevealResourceCategory,{label:{'zh-CN':string;en:string};roles:readonly LearningResourceKind[]}>;
export const REVEAL_APPLICABILITY_MATRIX={
 word:['default','default','default','default','conditional','conditional','conditional','conditional'],
 phrase:['default','default','default','default','conditional','excluded','conditional','conditional'],
 construction:['default','default','default','default','conditional','excluded','excluded','conditional'],
 utterance:['default','default','default','default','conditional','excluded','conditional','conditional'],
 sentence:['default','default','conditional','default','conditional','excluded','excluded','conditional'],
 unspecified:['default','default','conditional','default','conditional','conditional','conditional','conditional'],
} as const;
export const revealResourcePlanSchema=z.object({
 version:z.literal('reveal-resources-v1'),expression:sensaLightweightExpressionSnapshotSchema,
 assessments:revealScopeAssessmentsSchema,
 categories:z.array(z.object({category,applicability:z.enum(['applicable','not_applicable','undetermined']),reason:z.string().min(1),preparation:z.enum(['unprepared','ready','blocked','not_needed']),resourceKeys:z.array(z.string())}).strict()).length(8),
}).strict();
export type RevealResourcePlan=z.infer<typeof revealResourcePlanSchema>;
type Resource={resourceKey:string;materialRoleKey:string;contentPayload:Record<string,unknown>};
export function resolveRevealResourcePlan(expressionInput:unknown,assessmentsInput:unknown={},resources:readonly Resource[]=[],settled=false):RevealResourcePlan{
 const expression=sensaLightweightExpressionSnapshotSchema.parse(expressionInput),assessments=revealScopeAssessmentsSchema.parse(assessmentsInput);
 const rules=REVEAL_APPLICABILITY_MATRIX[expression.expressionKind];
 return {version:'reveal-resources-v1',expression,assessments,categories:REVEAL_RESOURCE_CATEGORIES.map((key,index)=>{
  const rule=rules[index],assessment=assessments[key];
  // Hard expression-type exclusions take priority over content availability.
  const applicability=rule==='excluded'?'not_applicable':rule==='default'?'applicable':assessment?(assessment.applicable?'applicable':'not_applicable'):key==='etymology'&&expression.expressionKind==='word'?'applicable':'undetermined';
  const reason=rule==='excluded'?'expression_type_excluded':rule==='default'?'expression_type_default':assessment?.reason??(applicability==='applicable'?'word_history_scope':'condition_not_established');
  const resourceKeys=resources.filter(r=>((REVEAL_RESOURCE_CATALOGUE[key].roles as readonly string[]).includes(r.materialRoleKey)||key==='contrast'&&r.materialRoleKey==='language_structure'&&!!r.contentPayload.contrastNote)).map(r=>r.resourceKey);
  return {category:key,applicability,reason,preparation:applicability!=='applicable'?'not_needed':resourceKeys.length?'ready':settled?'blocked':'unprepared',resourceKeys};
 })};
}
export function roleAllowedByResourcePlan(plan:RevealResourcePlan,role:string){
 const entry=plan.categories.find(c=>(REVEAL_RESOURCE_CATALOGUE[c.category].roles as readonly string[]).includes(role));
 return !entry||entry.applicability==='applicable';
}
/** Only pinned source facts may resolve a conditional category. Model output cannot. */
export function resourcePlanFromArtifacts(artifacts:readonly {contextKind:string;payload:Record<string,unknown>;sourceVersion?:string}[]):RevealResourcePlan{
 const expression=artifacts.find(a=>a.contextKind==='expression_snapshot')!.payload;
 const assessments:z.infer<typeof revealScopeAssessmentsSchema>={};
 for(const artifact of artifacts.filter(a=>a.contextKind==='reference_fact')){
  const fact=artifact.payload;
  if(fact.factKind==='language_structure'&&fact.contrastNote)assessments.contrast??={applicable:true,reason:'source_confirms_condition',source:artifact.sourceVersion??'pinned-reference'};
  if(fact.factKind==='resource_scope')Object.assign(assessments,revealScopeAssessmentsSchema.parse(fact.assessments));
  const kind=fact.factKind==='language_structure'?'usage':fact.factKind==='boundary_contrast'?'contrast':fact.factKind;
  if(['usage','contrast','word_formation','etymology','mnemonic'].includes(String(kind)))assessments[kind as RevealResourceCategory]??={applicable:true,reason:'source_confirms_condition',source:artifact.sourceVersion??'pinned-reference'};
 }
 return resolveRevealResourcePlan(expression,assessments);
}
export function completedRevealResourcePlan(plan:RevealResourcePlan,resources:readonly Resource[]){return resolveRevealResourcePlan(plan.expression,plan.assessments,resources,true);}

import {localFlowText} from '../../../i18n/localFlowText';
import {useTranslation} from 'react-i18next';
import {learningResourceDefinition,type SensaMaterializedResource,sensaLightweightExperienceRecallCueSchema} from '@sensa/contracts/sensa';
import {learningResourceLabel} from '../../../i18n/resourceLabel';
import {RichExperience} from './RichExperience';

/** Shared renderer for resource details and supplementary reveal material. */
export function LearningResource({resource,meaningPresentation,hideLabel=false,omitFields=[],onEscape}:{resource:SensaMaterializedResource;meaningPresentation?:string;hideLabel?:boolean;omitFields?:readonly string[];onEscape?:()=>void}) {
 useTranslation();
 const definition=learningResourceDefinition(resource.materialRoleKey);
 if(!definition)throw new Error(`Unsupported learning resource: ${resource.materialRoleKey}`);
 const savedPayload=definition.schema.parse(resource.contentPayload) as Record<string,unknown>;
 const payload=resource.materialRoleKey==='sense_confirmation'&&meaningPresentation?{...savedPayload,meaning:meaningPresentation}:savedPayload;
 const kindLabels={word:'resourceWord',phrase:'resourcePhrase',construction:'resourceConstruction',utterance:'resourceUtterance',sentence:'resourceSentence'} as const;
 const label=learningResourceLabel(resource.materialRoleKey);
 return <section aria-label={label} className="space-y-2">{!hideLabel&&<h4 className="text-sm font-medium text-fg-secondary">{label}</h4>}
  {resource.materialRoleKey==='experience_recall_cue'?<RichExperience {...sensaLightweightExperienceRecallCueSchema.parse(payload)} onEscape={onEscape}/>:null}
  {definition.fields.filter(key=>!omitFields.includes(key)&&!(resource.materialRoleKey==='experience_recall_cue'&&key==='scene')).map(key=>typeof payload[key]==='string'&&payload[key]?<p key={key} dir="auto" className="whitespace-pre-wrap leading-7">{key==='sourceUrl'?<a href={String(payload[key])} target="_blank" rel="noreferrer">{String(payload[key])}</a>:key==='expressionKind'&&String(payload[key]) in kindLabels?localFlowText(kindLabels[payload[key] as keyof typeof kindLabels]):String(payload[key])}</p>:null)}
  {Array.isArray(payload.acceptedForms)&&<p className="font-language leading-7">{payload.acceptedForms.join(' · ')}</p>}
  {Array.isArray(payload.formParts)&&<p className="font-language leading-7">{(payload.formParts as {kind:string;text:string;constraint?:string}[]).map((part,index)=><span key={index}>{part.kind==='slot'?`[${part.text}${part.constraint?`: ${part.constraint}`:''}]`:part.text}{' '}</span>)}</p>}
  {typeof payload.audioUrl==='string'&&<audio controls preload="none" src={payload.audioUrl} className="max-w-full"/>}
 </section>;
}

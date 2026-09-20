import {localFlowText} from '../../../i18n/localFlowText';
import {useTranslation} from 'react-i18next';
import {learningResourceDefinition,type SensaMaterializedResource,sensaLightweightExperienceRecallCueSchema} from '@sensa/contracts/sensa';
import {RichExperience} from './RichExperience';

/** Shared renderer for resource details and supplementary reveal material. */
export function LearningResource({resource}:{resource:SensaMaterializedResource}) {
 const {i18n}=useTranslation();
 const definition=learningResourceDefinition(resource.materialRoleKey);
 if(!definition)throw new Error(`Unsupported learning resource: ${resource.materialRoleKey}`);
 const payload=definition.schema.parse(resource.contentPayload) as Record<string,unknown>;
 const kindLabels={word:'resourceWord',phrase:'resourcePhrase',construction:'resourceConstruction',utterance:'resourceUtterance'} as const;
 const label=definition.label[i18n.resolvedLanguage?.startsWith('zh')?'zh-CN':'en'];
 return <section aria-label={label} className="space-y-2"><h4 className="text-sm font-medium text-fg-secondary">{label}</h4>
  {resource.materialRoleKey==='experience_recall_cue'?<RichExperience {...sensaLightweightExperienceRecallCueSchema.parse(payload)}/>:null}
  {definition.fields.filter(key=>!(resource.materialRoleKey==='experience_recall_cue'&&key==='scene')).map(key=>typeof payload[key]==='string'&&payload[key]?<p key={key} className="whitespace-pre-wrap leading-7">{key==='sourceUrl'?<a href={String(payload[key])} target="_blank" rel="noreferrer">{String(payload[key])}</a>:key==='expressionKind'&&String(payload[key]) in kindLabels?localFlowText(kindLabels[payload[key] as keyof typeof kindLabels]):String(payload[key])}</p>:null)}
  {Array.isArray(payload.acceptedForms)&&<p className="font-language leading-7">{payload.acceptedForms.join(' · ')}</p>}
  {Array.isArray(payload.formParts)&&<p className="font-language leading-7">{(payload.formParts as {kind:string;text:string;constraint?:string}[]).map((part,index)=><span key={index}>{part.kind==='slot'?`[${part.text}${part.constraint?`: ${part.constraint}`:''}]`:part.text}{' '}</span>)}</p>}
  {typeof payload.audioUrl==='string'&&<audio controls preload="none" src={payload.audioUrl} className="max-w-full"/>}
 </section>;
}

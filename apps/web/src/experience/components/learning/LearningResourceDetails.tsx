import {useRef,useState} from 'react';
import {useRouter} from '@tanstack/react-router';
import {BookOpen,ArrowUpRight,X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {localFlowText} from '../../../i18n/localFlowText';
import {learningResourceLabel} from '../../../i18n/resourceLabel';
import type {LightweightInitialLearningMaterialization} from '../../../contentSupply/provisioning/lightweightInitialContent';
import type {RuntimeLearningContent} from '../../../learning/content/learningCatalog';
import {learningSupportMeaning} from '@sensa/contracts/sensa';
import {SensaOverlayLayout} from '../../ui/SensaComponents';
import {useShellNavigation} from '../../router/useShellNavigation';
import {LearningResource} from './LearningResource';
import {StudyResources} from './StudyResources';

type Props={material:LightweightInitialLearningMaterialization;studyContent?:RuntimeLearningContent;active?:boolean;ownerMeaningId?:string};
const primaryRoles=['sense_confirmation','experience_recall_cue','scene_realization','pronunciation'];
function ResourceReader({material,studyContent,open,onOpen,onClose}:Props&{open:boolean;onOpen:()=>void;onClose:()=>void}){
 const {t}=useTranslation();
 const meaning=material.content.resources.some(resource=>resource.materialRoleKey==='sense_confirmation')?learningSupportMeaning(material.content.resources):undefined,expression=material.content.resources.find(resource=>resource.materialRoleKey==='target_expression')?.contentPayload;
 const primary=primaryRoles.flatMap(role=>material.content.resources.filter(resource=>resource.materialRoleKey===role));
 const secondary=material.content.resources.filter(resource=>!primaryRoles.includes(resource.materialRoleKey));
 const secondaryGroups=[...new Set(secondary.map(resource=>resource.materialRoleKey))].map(role=>({role,resources:secondary.filter(resource=>resource.materialRoleKey===role)}));
 const render=(resource:typeof material.content.resources[number],hideLabel=false)=><LearningResource resource={resource} meaningPresentation={meaning} hideLabel={hideLabel} onEscape={onClose} omitFields={resource.materialRoleKey==='experience_recall_cue'&&primary.some(item=>item.materialRoleKey==='sense_confirmation')&&resource.contentPayload.senseFocus===meaning?['senseFocus']:[]}/>;
 return <>
  <button type="button" className="sensa-resource-trigger" onClick={onOpen}><BookOpen size={18}/><span>{localFlowText('viewResources')}</span><ArrowUpRight size={16}/></button>
  {open&&<SensaOverlayLayout variant="dialog" measure="wide" className="sensa-resource-reader z-[100]" label={localFlowText('learningResources')} onDismiss={onClose} dismissOnBackdrop onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}} regions={{
   header:<div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-medium">{localFlowText('learningResources')}</h2>{typeof expression?.surface==='string'&&<p className="mt-1 font-language text-2xl"><bdi lang={String(expression.languageTag)} dir="auto">{expression.surface}</bdi></p>}</div><button type="button" className="min-h-11 min-w-11 grid place-items-center rounded-control focus-visible:outline-2 focus-visible:outline-focus" aria-label={t('learningQuestion.close')} onClick={onClose}><X size={20}/></button></div>,
   primary:<div className="sensa-resource-reading-content">
    {!material.content.resources.length&&!studyContent&&<p role="status">{localFlowText('resourcesEmpty')}</p>}
    {primary.map(resource=><div key={resource.resourceKey} className="sensa-resource-primary">{render(resource)}</div>)}
    {secondaryGroups.map(group=><details key={group.role} className="sensa-resource-secondary"><summary>{learningResourceLabel(group.role)}</summary><div className="space-y-5 pb-5">{group.resources.map(resource=><div key={resource.resourceKey}>{render(resource,true)}</div>)}</div></details>)}
    {studyContent&&<details className="sensa-resource-secondary"><summary>{localFlowText('studyResources')}</summary><StudyResources content={studyContent}/></details>}
   </div>,
  }}/>}
 </>;
}
function RoutedResourceDetails(props:Props){
 const router=useRouter(),{params,mainStack,setMainStack}=useShellNavigation(),openedHere=useRef(false);
 const id=props.material.snapshot.learningMaterializationId,top=mainStack.at(-1);
 const current=props.active!==false&&(top==='s-learning-target'&&params.targetId===props.material.snapshot.learningTargetId||!!props.ownerMeaningId&&['s-personal-meaning','s-confirmed-sense'].includes(top??'')&&params.meaningId===props.ownerMeaningId);
 const open=current&&params.resourceMaterialization===id;
 const onOpen=()=>{openedHere.current=true;setMainStack(mainStack,{resourceMaterialization:id});};
 const onClose=()=>{if(openedHere.current){openedHere.current=false;router.history.back();}else setMainStack(mainStack,{resourceMaterialization:''},true);};
 return <ResourceReader {...props} open={open} onOpen={onOpen} onClose={onClose}/>;
}
function LocalResourceDetails(props:Props){
 const [open,setOpen]=useState(false);
 return <ResourceReader {...props} open={open&&props.active!==false} onOpen={()=>setOpen(true)} onClose={()=>setOpen(false)}/>;
}
/** The production Shell owns Back through its existing router. Isolated renderer
 * fixtures retain a local disclosure without creating another history authority. */
export function LearningResourceDetails(props:Props){
 const router=useRouter({warn:false});
 return router?<RoutedResourceDetails {...props}/>:<LocalResourceDetails {...props}/>;
}

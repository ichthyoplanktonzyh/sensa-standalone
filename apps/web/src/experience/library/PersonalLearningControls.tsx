import {LearningResourceDetails} from '../components/learning/LearningResourceDetails';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useState} from 'react';
import {
 personalLearningSourceKey,
 type ContentProvisioningTask,
 type PersonalMeaningLearningSource,
} from '../../contentSupply/system';
import type {usePersonalLearning} from './usePersonalLearning';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
import {journeyGateway,type JourneyAlignmentView,type JourneyDetailView} from '../personalMeaningJourney';

type Controller=ReturnType<typeof usePersonalLearning>;

export function PersonalLearningControls({source,c,onStart}:{source:PersonalMeaningLearningSource;c:Controller;onStart:(targetId:string)=>void}){
 useTranslation();
 const task=c.tasks.find(candidate=>personalLearningSourceKey(candidate.source)===personalLearningSourceKey(source.reference)&&candidate.languageContext.languageRouteId===c.languageContext.languageRouteId);const [useContext,setUseContext]=useState(task?.useContext??false);const target=c.targets.find(candidate=>candidate.id===task?.targetId);const membership=target&&task?target.curriculumMemberships.find(candidate=>candidate.id===task.curriculumMembershipId):undefined;const stale=!!task&&(task.languageContext.languageRouteRevision!==c.languageContext.languageRouteRevision||task.languageContext.supportLanguageTag!==c.languageContext.supportLanguageTag||task.useContext!==useContext);
 useEffect(()=>{if(task)setUseContext(task.useContext);},[task?.id,task?.useContext]);
 const running=!!task&&['generating','reviewing'].includes(task.status)&&task.leaseUntil>c.clock;
 return <section className="sensa-preparation my-4 space-y-3 rounded-2xl border border-border-subtle p-5" aria-label={localFlowText('personalPreparation')}>
  <h3 className="font-medium">{source.expression.surfaceForm} · {localFlowText(task?.status==='ready'?'learningReady':task?'learningPreparation':'learningChoice')}</h3>
  <p className="text-sm text-fg-secondary">{localFlowText('fixedLightweight')}</p>
  {(!task||!!target)&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={useContext} onChange={event=>setUseContext(event.target.checked)}/>{localFlowText('sourceConsent')}</label>}
  {(c.notice||(task?.status!=='ready'&&task?.notice))&&<p role="status" className="text-sm">{localFlowNotice(c.notice||task?.notice)}</p>}
  {!task?<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.enroll(source,useContext)}>{localFlowText('enroll')}</button>:task.status==='ready'&&!stale?<button className={setupPrimary} onClick={()=>onStart(task.targetId)}>{localFlowText('startLearning')}</button>:running?<><p role="status">{task.status==='generating'?localFlowText('generating'):localFlowText('reviewing')}</p><button className={setupButton} onClick={()=>c.stop(task.id)}>{localFlowText('stopPreparation')}</button></>:<button className={setupPrimary} disabled={c.busy||!c.preparationAvailable} onClick={()=>void (stale?c.update(task.id,source,useContext):c.prepare(task.id))}>{c.busy?localFlowText('processing'):task.status==='waiting'?localFlowText('generateResources'):task.status==='rejected'?localFlowText('regenerate'):localFlowText('retryPreparation')}</button>}
  {membership&&<><LearningResourceDetails material={membership.material}/>{stale&&<p className="text-sm">{localFlowText('contextResourcesStale')}</p>}<button className={setupButton} disabled={c.busy||running||!stale} onClick={()=>void c.update(task!.id,source,useContext)}>{localFlowText('updateResources')}</button>{task?.status!=='ready'&&<button className={setupButton} onClick={()=>onStart(target!.id)}>{localFlowText('useExistingResources')}</button>}</>}
 </section>;
}

export function JourneyAlignmentLearningControls({detail,alignment,c,onStart}:{detail:JourneyDetailView;alignment:JourneyAlignmentView;c:Controller;onStart:(targetId:string)=>void}){
 const sources=journeyGateway.getLearningSources(detail.personalMeaningId,alignment.personalMeaningAlignmentId);
 if(!sources.length)return null;
 return <>{sources.map(source=><PersonalLearningControls key={personalLearningSourceKey(source.reference)} source={source} c={c} onStart={onStart}/>)}</>;
}

export const pendingPersonalTargetView=(task:ContentProvisioningTask,source:PersonalMeaningLearningSource|null)=>({targetId:task.targetId,expression:source?.expression.surfaceForm??localFlowText('expression'),targetLanguageTag:task.languageContext.targetLanguageTag,supportLanguageTag:task.languageContext.supportLanguageTag,meaning:source?.semanticSpec.coreMeaningFocus??localFlowText('semanticWorld'),example:'',partOfSpeech:'',expressionTypeLabel:localFlowText('expression'),sourceKind:'personal_semantic_world' as const,sourceLabel:localFlowText('semanticWorld'),runtimeSenseId:null,personalExperienceGrounding:null,policy:'lightweight' as const,lightweightReadiness:{status:'preparing' as const,label:localFlowText('prepareResources'),detail:localFlowNotice(source?task.notice:'localFlow.meaningChanged')}});

export function PersonalPreparationTarget({task,c,active,onBack,onHome,onStart,onSource}:{task:ContentProvisioningTask;c:Controller;active:boolean;onBack:()=>void;onHome:()=>void;onStart:(id:string)=>void;onSource:()=>void}){
 useTranslation();
 const source=c.sourceForTask(task);
 return <LearningTargetDetailScreen active={active} target={pendingPersonalTargetView(task,source)} selectedPolicy="lightweight" fixedPolicy preparation={task.status==='rejected'||task.status==='failed'||!source?'blocked':'preparing'} committedPolicy={null} initialCompletionKind={null} reviewDue={false} relearning={false} retentionRuntimeState={null} nextReviewLabel={null} declaredMastery={false} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>{}} onOpenSource={onSource} onRefreshPreparation={()=>{}} onGoHome={onHome} onStartReview={()=>{}} onContinueRetentionRuntime={()=>{}} onContinueRuntime={()=>{}} onRevokeDeclaredMastery={()=>{}} actions={source?<PersonalLearningControls source={source} c={c} onStart={onStart}/>:<p role="alert">{localFlowText('meaningChanged')}</p>}/>;
}

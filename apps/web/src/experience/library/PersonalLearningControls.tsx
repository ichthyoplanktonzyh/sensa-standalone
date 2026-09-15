import {LearningResourceDetails} from '../components/learning/LearningResourceDetails';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import {useEffect,useState} from 'react';
import type {LocalMeaning} from '../../data/library/teacher';
import type {PersonalLearning} from '../../data/library/personalLearning';
import type {usePersonalLearning} from './usePersonalLearning';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
type Controller=ReturnType<typeof usePersonalLearning>;
export function PersonalLearningControls({meaning,c,onStart}:{meaning:LocalMeaning;c:Controller;onStart:(targetId:string)=>void}){
 useTranslation();
 const task=c.tasks.find(t=>t.meaningId===meaning.id&&t.languageContext.languageRouteId===c.languageContext.languageRouteId);const [useContext,setUseContext]=useState(task?.useContext??false);const target=c.targets.find(t=>t.id===task?.targetId);const membership=target&&task?target.curriculumMemberships.find(candidate=>candidate.id===task.curriculumMembershipId):undefined;const stale=!!task&&((task.meaning.contextRevision??1)!==(meaning.contextRevision??1)||task.languageContext.languageRouteRevision!==c.languageContext.languageRouteRevision||task.languageContext.supportLanguageTag!==c.languageContext.supportLanguageTag);
 useEffect(()=>{if(task)setUseContext(task.useContext);},[task?.id,task?.useContext]);
 const running=!!task&&['generating','reviewing'].includes(task.status)&&task.leaseUntil>c.clock;
 return <section className="mx-5 my-4 space-y-3 rounded-2xl border border-border-subtle p-5" aria-label={localFlowText('personalPreparation')}>
  <h3 className="font-medium">{localFlowText(task?.status==='ready'?'learningReady':task?'learningPreparation':'learningChoice')}</h3>
  <p className="text-sm text-fg-secondary">{localFlowText('fixedLightweight')}</p>
  {(!task||!!target)&&<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={useContext} onChange={e=>setUseContext(e.target.checked)}/>{localFlowText('sourceConsent')}</label>}
  {(c.notice||(task?.status!=='ready'&&task?.notice))&&<p role="status" className="text-sm">{localFlowNotice(c.notice||task?.notice)}</p>}
  {!task?<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.enroll(meaning.id,useContext)}>{localFlowText('enroll')}</button>:task.status==='ready'&&!stale?<button className={setupPrimary} onClick={()=>onStart(task.targetId)}>{localFlowText('startLearning')}</button>:running?<><p role="status">{task.status==='generating'?localFlowText('generating'):localFlowText('reviewing')}</p><button className={setupButton} onClick={()=>c.stop(task.id)}>{localFlowText('stopPreparation')}</button></>:<button className={setupPrimary} disabled={c.busy||!c.providers} onClick={()=>void (stale?c.update(task.id,useContext):c.prepare(task.id))}>{c.busy?localFlowText('processing'):task.status==='waiting'?localFlowText('generateResources'):task.status==='rejected'?localFlowText('regenerate'):localFlowText('retryPreparation')}</button>}
  {membership&&<><LearningResourceDetails material={membership.material}/>{stale&&<p className="text-sm">{localFlowText('contextResourcesStale')}</p>}<button className={setupButton} disabled={c.busy||running||!stale} onClick={()=>void c.update(task!.id,useContext)}>{localFlowText('updateResources')}</button>{task?.status!=='ready'&&<button className={setupButton} onClick={()=>onStart(target!.id)}>{localFlowText('useExistingResources')}</button>}</>}
 </section>;
}
export const pendingPersonalTargetView=(t:PersonalLearning)=>({targetId:t.targetId,expression:t.meaning.proposal.expression.surface,targetLanguageTag:t.languageContext.targetLanguageTag,supportLanguageTag:t.languageContext.supportLanguageTag,meaning:t.meaning.proposal.semanticSpec.coreMeaningFocus,example:'',partOfSpeech:'',expressionTypeLabel:localFlowText('expression'),sourceKind:'personal_semantic_world' as const,sourceLabel:localFlowText('semanticWorld'),runtimeSenseId:null,personalExperienceGrounding:null,policy:'lightweight' as const,lightweightReadiness:{status:'preparing' as const,label:localFlowText('prepareResources'),detail:localFlowNotice(t.notice)}});
export function PersonalPreparationTarget({task,c,active,onBack,onHome,onStart,onSource}:{task:PersonalLearning;c:Controller;active:boolean;onBack:()=>void;onHome:()=>void;onStart:(id:string)=>void;onSource:()=>void}){
 useTranslation();
 return <LearningTargetDetailScreen active={active} target={pendingPersonalTargetView(task)} selectedPolicy="lightweight" fixedPolicy preparation={task.status==='rejected'||task.status==='failed'?'blocked':'preparing'} committedPolicy={null} initialCompletionKind={null} reviewDue={false} relearning={false} retentionRuntimeState={null} nextReviewLabel={null} declaredMastery={false} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>{}} onOpenSource={onSource} onRefreshPreparation={()=>{}} onGoHome={onHome} onStartReview={()=>{}} onContinueRetentionRuntime={()=>{}} onContinueRuntime={()=>{}} onRevokeDeclaredMastery={()=>{}} actions={<PersonalLearningControls meaning={task.meaning} c={c} onStart={onStart}/>}/>;
}

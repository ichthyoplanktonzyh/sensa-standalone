import {LearningPreferencesPanel} from '../components/learning/LearningPreferencesPanel';
import {cardText} from '../../i18n/originalCards';
import {StudyResources} from '../components/learning/StudyResources';
import {LearningResourceDetails} from '../components/learning/LearningResourceDetails';
import {useTranslation} from 'react-i18next';
import {localFlowText,localFlowNotice} from '../../i18n/localFlowText';
import i18n from '../../i18n/index';
import {useState} from 'react';
import {Download} from 'lucide-react';
import {LearningTargetDetailScreen} from '../components/learning/LearningTargetDetailScreen';
import type {LearningTargetProjection} from '../../learning/system';
import type {usePackageLearning} from './usePackageLearning';
import {setupButton,setupPrimary} from '../components/learning/LearningSetupFrame';
import type {PortablePackageExport} from '../../contentSupply/system';
import {downloadPortablePackage} from './portableDownload';
type Controller=ReturnType<typeof usePackageLearning>;
export function PackageTarget({active,target,c,onBack,onHome,onStart,onManage,onSource,onExport,exportBusy=false,exportNotice}:{active:boolean;target:LearningTargetProjection;c:Controller;onBack:()=>void;onHome:()=>void;onStart:()=>void;onManage?:()=>void;onSource?:()=>void;onExport?:()=>Promise<PortablePackageExport|null>;exportBusy?:boolean;exportNotice?:string}){
 useTranslation();
 const [editingPolicy,setEditingPolicy]=useState(false);
 const canSelectPolicy=target.allowedPolicies.length>1&&!target.started;
 const inActiveRun=c.activeRunTargetIds.includes(target.targetId);
 const canStart=target.planningActive!==false||inActiveRun;
 const planAction=!canStart?<button className={setupButton} onClick={onManage??onBack}>{i18n.t('study.title')}</button>:null;
 const notice=exportNotice||c.notice;
 const planningNotice=!canStart?localFlowText('outsideLearningPlan'):'';
 return <><LearningTargetDetailScreen active={active} target={target.presentation} selectedPolicy={target.policy} fixedPolicy={!canSelectPolicy} preparation={target.preparation} committedPolicy={target.committedPolicy} initialCompletionKind={target.completed?'study_completion':null} reviewDue={target.reviewDue} relearning={target.relearning} retentionRuntimeState={null} nextReviewLabel={target.nextReviewAt?new Date(target.nextReviewAt).toLocaleString(i18n.language):null} declaredMastery={target.declaredMastery} isAdded onBack={onBack} onAdd={()=>{}} onOpenPolicy={()=>setEditingPolicy(true)} onOpenSource={onSource??onBack} onRefreshPreparation={()=>void c.refresh()} onGoHome={onHome} onStartReview={onStart} onContinueRetentionRuntime={onStart} onContinueRuntime={onStart} onRevokeDeclaredMastery={()=>void c.declareKnown(target.targetId,false)} notice={<>{planningNotice&&<p role="status">{planningNotice}</p>}{notice&&<p role="status">{localFlowNotice(notice)}</p>}</>} actions={<>{onExport&&target.preparation==='ready'&&<button className={setupButton} disabled={c.busy||exportBusy} onClick={()=>void onExport().then(result=>{if(result)downloadPortablePackage(result);})}><Download size={18}/>{localFlowText(exportBusy?'processing':'exportPortablePackage')}</button>}<LearningResourceDetails material={target.material}/>{target.studyContent&&<StudyResources content={target.studyContent}/>}{target.declaredMastery?<button className={setupPrimary} disabled={c.busy} onClick={()=>void c.declareKnown(target.targetId,false)}>{cardText('revokeKnown')}</button>:<button className={setupPrimary} disabled={c.busy||!canStart||target.preparation!=='ready'||target.completed&&!target.reviewDue&&!inActiveRun} onClick={onStart}>{target.completed?localFlowText('startReview'):localFlowText('startLearning')}</button>}{planAction}</>}/>{editingPolicy&&canSelectPolicy&&<LearningPreferencesPanel policyOptions={c.policyOptions} closeLabel={i18n.t('learningPreferences.finishSelection')} allowedPolicies={target.allowedPolicies} showDailyQuantity={false} defaultPolicy={target.policy} dailyNewCount={c.dailyLimit??20} onDailyNewCountChange={()=>{}} onPolicyChange={value=>{void c.selectPolicy(target.targetId,value);}} busy={c.busy} status={c.notice&&<p role="status">{c.notice}</p>} onClose={()=>setEditingPolicy(false)}/>}</>;
}

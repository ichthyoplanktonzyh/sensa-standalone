import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, LockKeyhole, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PrototypeLearningPolicy, PrototypeLearningReadiness, PrototypeLearningTargetView } from '../../learningJourney/prototypeLearning';
import type { RetentionRuntimeTargetStatus } from '../../engine/ReviewQueue';
import type { InitialLearningCompletionKind } from '../../learningRuntime/orchestrations';
import { LearningSetupFrame, setupButton, setupPrimary } from './LearningSetupFrame';

interface LearningTargetDetailScreenProps {
  active: boolean;
  screenId?: string;
  target: Omit<PrototypeLearningTargetView, 'targetId'> & {targetId: string};
  actions?: import('react').ReactNode;
  notice?: import('react').ReactNode;
  fixedPolicy?: boolean;
  selectedPolicy: PrototypeLearningPolicy;
  preparation: PrototypeLearningReadiness;
  committedPolicy: PrototypeLearningPolicy | null;
  initialCompletionKind: InitialLearningCompletionKind | null;
  reviewDue: boolean;
  relearning: boolean;
  retentionRuntimeState: RetentionRuntimeTargetStatus | null;
  nextReviewLabel: string | null;
  declaredMastery: boolean;
  isAdded: boolean;
  onBack: () => void;
  onAdd: () => void;
  onOpenPolicy: () => void;
  onOpenSource: () => void;
  onRefreshPreparation: () => void;
  onGoHome: () => void;
  onStartReview: () => void;
  onContinueRetentionRuntime: () => void;
  onContinueRuntime: () => void;
  onRevokeDeclaredMastery: () => void;
}


export const LearningTargetDetailScreen=(props:LearningTargetDetailScreenProps)=>{
  const {t}=useTranslation();
  const [error,setError]=useState(false);
  useEffect(()=>{setError(false);},[props.active,props.target.targetId]);
  const {target,preparation,committedPolicy,initialCompletionKind,retentionRuntimeState}=props;
  const committed=committedPolicy!==null;
  const completed=initialCompletionKind!==null;
  const retaining=retentionRuntimeState==='reviewing'||retentionRuntimeState==='relearning_repair'||retentionRuntimeState==='relearning_retest';
  const status=props.declaredMastery?'declared'
    : retaining?retentionRuntimeState==='reviewing'?'reviewing':retentionRuntimeState==='relearning_repair'?'repair':'retest'
    : completed?props.relearning?'repair':props.reviewDue?'review':'maintaining'
    : committed?'committed':preparation;
  const hint=props.declaredMastery?'declaredHint'
    : retaining?retentionRuntimeState==='reviewing'?'reviewingHint':retentionRuntimeState==='relearning_repair'?'repairHint':'retestHint'
    : completed?props.relearning?'repairHint':'completedHint'
    : committed?'lockedHint':preparation+'Hint';
  // Curriculum membership, content readiness, active work and self-declarations
  // remain distinct. A preparing target can be added, but cannot start a run.
  const action: {label:string;run:()=>void}=!props.isAdded?{label:'add',run:props.onAdd}
    : props.declaredMastery?{label:'restore',run:props.onRevokeDeclaredMastery}
    : retaining?{label:retentionRuntimeState==='reviewing'?'continueReview':'continueRepair',run:props.onContinueRetentionRuntime}
    : completed?props.reviewDue?{label:props.relearning?'continueRepair':'startReview',run:props.onStartReview}:{label:'home',run:props.onGoHome}
    : committed?{label:'continue',run:props.onContinueRuntime}
    : preparation==='ready'?{label:'home',run:props.onGoHome}
    : preparation==='preparing'?{label:'check',run:props.onRefreshPreparation}
    : {label:'change',run:props.onOpenPolicy};
  const invoke=(callback:()=>void)=>{
    try {callback();setError(false);} catch {setError(true);}
  };
  const MethodIcon=committed?LockKeyhole:ArrowRight;
  const StatusIcon=preparation==='blocked'&&!committed&&!completed?AlertCircle
    : preparation==='preparing'&&!committed&&!completed?Clock3:CheckCircle2;
  return <LearningSetupFrame id={props.screenId??"s-learning-target"} active={props.active} onBack={props.onBack} title={t('learningSetup.target')}>
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0">
        <span className="inline-flex rounded-full bg-[#edf0f7] px-3 py-1.5 text-xs font-medium text-[#5268a9]">{t('learningSetup.'+(props.isAdded?'added':'beforeAdd'))}</span>
        <div className="mt-6 flex flex-wrap items-baseline gap-4"><h2 className="break-words text-4xl font-medium tracking-tight sm:text-5xl">{target.expression}</h2><span className="text-sm text-[#788398]">{target.partOfSpeech}</span></div>
        <p className="mt-5 text-lg leading-8 text-[#546078]">{target.meaning}</p>
        {target.example && <div className="mt-8 rounded-2xl bg-[#f0f2f6] p-6"><h3 className="text-xs text-[#788398]">{t('learningSetup.example')}</h3><blockquote className="mt-3 text-lg leading-8">{target.example}</blockquote></div>}
        <div className="mt-8 divide-y divide-[#e0e5ee] border-y border-[#e0e5ee]">
          <button type="button" onClick={props.onOpenSource} className="flex min-h-24 w-full items-center gap-4 px-1 py-5 text-left focus-visible:outline-2 focus-visible:outline-[#5268a9]">
            <span className="min-w-0 flex-1"><span className="block text-xs text-[#788398]">{t('learningSetup.source')}</span><span className="mt-2 block text-sm">{target.sourceLabel}</span></span><ArrowRight size={18} className="shrink-0 text-[#788398]"/>
          </button>
          <div className="flex min-h-24 items-center gap-3 px-1 py-5">
            <div className="min-w-0 flex-1"><h3 className="text-xs text-[#788398]">{t('learningSetup.method')}</h3><p className="mt-2 text-sm font-medium">{t('learningPreferences.policies.'+(committedPolicy??props.selectedPolicy))}</p>{committed&&<p className="mt-2 text-xs text-[#788398]">{t('learningSetup.locked')}</p>}</div>
            {committed||props.fixedPolicy?<MethodIcon size={18} className="text-[#788398]" aria-hidden="true"/>:<button type="button" onClick={props.onOpenPolicy} className={setupButton+' text-[#5268a9] hover:bg-[#edf0f7]'}>{t('learningSetup.change')}<ArrowRight size={16}/></button>}
          </div>
        </div>
      </section>
      <aside className="rounded-3xl border border-[#e0e5ee] bg-white p-6 sm:p-7">
        <StatusIcon size={25} className={preparation==='blocked'&&!committed?'text-[#986c46]':'text-[#5268a9]'} aria-hidden="true"/>
        <h3 className="mt-5 text-xl font-medium">{t('learningSetup.'+status)}</h3>
        <p className="mt-3 text-sm leading-7 text-[#68748d]">{t('learningSetup.'+hint)}</p>
        {completed&&!props.declaredMastery&&<div className="mt-5 border-t border-[#e0e5ee] pt-5"><p className="text-xs text-[#788398]">{t('learningSetup.'+(initialCompletionKind==='acquisition_graduation'?'graduated':'completed'))}</p>{!props.reviewDue&&!retaining&&<p className="mt-3 text-sm">{t('learningSetup.next')} · {props.nextReviewLabel??t('learningSetup.unscheduled')}</p>}</div>}
        {props.notice}
        {error&&<p role="alert" className="mt-5 text-sm text-red-700">{t('learningSetup.saveError')}</p>}
        {props.actions ?? <button type="button" className={setupPrimary+' mt-7 w-full'} onClick={()=>invoke(action.run)}>{t('learningSetup.'+action.label)}</button>}
        {!props.isAdded&&<p className="mt-4 text-xs leading-6 text-[#788398]">{t('learningSetup.addHint')}</p>}
      </aside>
    </div>
  </LearningSetupFrame>;
};

import { resolveReviewMemoryOutcome } from '../review/types';
import { StepRendererRegistry } from './stepRenderers';
import type { StepRendererHost } from './stepRenderers';
import type { PrototypeIntroductionPackage } from '../content/learningCatalog';
import type { AssessmentResource } from '../content/assessmentResources';
import type { QuickDictEntry } from '../types';
import type { CardExecution } from '../components/cards/CardExecution';
import { IntroductionCard } from '../components/cards/IntroductionCard';
import { RecognitionCard } from '../components/cards/RecognitionCard';
import { RecallCard } from '../components/cards/RecallCard';
import { NovelTransferCard } from '../components/cards/NovelTransferCard';
import { SensaReviewAssessmentCard } from '../components/cards/review/SensaReviewAssessmentCard';
import { SensaReviewFeedbackCard } from '../components/cards/review/SensaReviewFeedbackCard';
import { toReviewSpec } from '../content/prototypeReviewCards';
export interface OriginalStepProps {
  content: PrototypeIntroductionPackage;
  resource: AssessmentResource | null;
  execution: CardExecution;
  purpose: 'acquisition' | 'retention';
  phase: 'experience' | 'reveal';
  onPhaseChange: (phase: 'experience' | 'reveal') => void;
  supports: {
    onOpenDictionary: (word: string | QuickDictEntry) => void;
    onOpenNote: () => void;
    onOpenScene: (anchorId?: string) => void;
    onOpenExample: (index?: number) => void;
    lookupDictionary: StepRendererHost['lookupDictionary'];
    onViewChange: () => void;
    toast: StepRendererHost['toast'];
  };
}
const introduction = (p: OriginalStepProps, repair = false) => <IntroductionCard content={p.content} phase={p.phase} mode={repair ? 'repair_replay' : 'introduction'} repairPurpose={p.purpose} onPhaseChange={p.onPhaseChange} onComplete={p.execution.continue} {...p.supports} onOpenDictionary={word => p.supports.onOpenDictionary(word ?? p.content.lemma)} />;
const resourceOf = <K extends AssessmentResource['kind'],>(p: OriginalStepProps, kind: K): Extract<AssessmentResource, {
  kind: K;
}> => {
  if (p.resource?.kind !== kind) throw Error('Card resource does not match the configured step');
  return p.resource as Extract<AssessmentResource, {
    kind: K;
  }>;
};
/** Presentation composition uses the same registry contract as the existing runtime.
 * The orchestrator stamps stepKind; this table owns card wiring, never learning outcomes. */
export const originalStepRendererRegistry = new StepRendererRegistry([{
  stepKind: 'introduction',
  render: (p: OriginalStepProps) => introduction(p)
}, {
  stepKind: 'review_repair',
  render: (p: OriginalStepProps) => introduction(p, true)
}, {
  stepKind: 'recognition',
  render: (p: OriginalStepProps) => <RecognitionCard content={p.content} assessment={resourceOf(p, 'context_recognition')} execution={p.execution} purpose={p.purpose} onComplete={p.execution.continue} {...p.supports} />
}, {
  stepKind: 'recall',
  render: (p: OriginalStepProps) => <RecallCard content={p.content} assessment={resourceOf(p, 'meaning_to_form_recall')} execution={p.execution} purpose={p.purpose} onComplete={p.execution.continue} {...p.supports} />
}, {
  stepKind: 'transfer',
  render: (p: OriginalStepProps) => <NovelTransferCard content={p.content} assessment={resourceOf(p, 'novel_context_transfer')} execution={p.execution} purpose={p.purpose} onComplete={p.execution.continue} {...p.supports} />
}, {
  stepKind: 'review_assessment',
  render: (p: OriginalStepProps) => {
    if (!p.resource) throw Error('Missing assessment');
    return <SensaReviewAssessmentCard content={p.content} spec={toReviewSpec(p.resource, p.content)} assessmentResource={p.resource} purpose={p.purpose} onSubmit={r => p.execution.submit(r.responseId)} {...p.supports} />;
  }
}, {
  stepKind: 'review_feedback',
  render: (p: OriginalStepProps) => {
    if (!p.resource || !p.execution.feedback) throw Error('Missing assessment feedback');
    const spec = toReviewSpec(p.resource, p.content),
      feedback = p.execution.feedback;
    return <SensaReviewFeedbackCard purpose={p.purpose} content={p.content} spec={spec} assessmentResource={p.resource} result={{
      assessmentId: spec.id,
      kind: spec.kind,
      focusDimension: spec.focusDimension,
      correct: feedback.correct,
      responseId: feedback.answer || null,
      memoryOutcome: p.purpose === 'retention' ? resolveReviewMemoryOutcome(spec.kind, feedback.correct) : null,
      evidenceEligible: p.purpose === 'retention' && spec.evidenceEligible
    }} onContinue={p.execution.continue} {...p.supports} />;
  }
}]);

import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import {
  contentNavigationBackClass,
  contentNavigationClass,
  iconClass,
  slideScreenClass,
} from '../ui/primitives';
/**
 * Independent Sense → target-expression binding journey.
 *
 * A confirmed Sense is the entry condition. This screen records only the
 * learner's binding intent and returns to the read-only Confirmed Sense
 * detail; it deliberately stops before content preparation, curriculum or
 * any learning runtime state.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  useJourneyDetail,
  useJourneyGateway,
  type JourneyExpressionCandidateView,
} from '../personalMeaningJourney';
import type {
  SensaExpressionBindingRelation,
  SensaExpressionType,
  SensaSemanticCoverage,
} from '@sensa/contracts/sensa';
import { newUuid } from '../personalMeaningJourney/ids';

export interface ExpressionBindingScreenProps {
  active: boolean;
  personalMeaningId: string | null;
  meaningFocusId: string | null;
  onBack: () => void;
  toast: (message: string) => void;
}

const opId = newUuid;
type BindingStep = 'candidate' | 'form' | 'relation';

const expressionTypeLabels: Record<SensaExpressionType, string> = {
  get word() { return uiText('word'); },
  get phrase() { return uiText('phrase'); },
  get construction() { return uiText('construction'); },
  get sentence() { return uiText('sentence'); },
  get utterance_strategy() { return uiText('expressionStrategy'); },
};

const relationLabels: Record<SensaExpressionBindingRelation, string> = {
  get realizes() { return uiText('naturalExpression'); },
  get approximates() { return uiText('approximateExpression'); },
  get evokes() { return uiText('evokesAnAssociation'); },
};

const relationDescriptions: Record<SensaExpressionBindingRelation, string> = {
  get realizes() { return uiText('aNaturalEnglishExpressionForThisMeaning'); },
  get approximates() { return uiText('similarMeaningWithADifferentEmphasisOr'); },
  get evokes() { return uiText('evokesThisMeaningButHasABroader'); },
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  get exact() { return uiText('exactCoverage'); },
  get broader() { return uiText('broaderScope'); },
  get narrower() { return uiText('narrowerScope'); },
  get overlapping() { return uiText('partialOverlap'); },
};

const coverageDescriptions: Record<SensaSemanticCoverage, string> = {
  get exact() { return uiText('theExpressionMatchesTheMeaningSScope'); },
  get broader() { return uiText('includesThisMeaningAndAppliesToMore'); },
  get narrower() { return uiText('coversOnlyPartOfThisMeaning'); },
  get overlapping() { return uiText('overlapsButIsNotInterchangeableInEvery'); },
};

const unavailable = (title: string, reason: string) => (
  <div className="rounded-card border border-dashed border-border-strong bg-surface-panel p-8 text-center" role="alert">
    <span className="mx-auto grid size-9 place-items-center rounded-full bg-accent-soft font-bold text-feedback-warning" aria-hidden="true">!</span>
    <h2 className="mt-4 text-section-title font-semibold">{title}</h2>
    <p className="mt-2 text-body-support leading-6 text-fg-secondary">{reason}</p>
  </div>
);

const CandidateRow = ({
  candidate,
  selected,
  onSelect,
}: {
  candidate: JourneyExpressionCandidateView;
  selected: boolean;
  onSelect: () => void;
}) => (
  <li className={`overflow-hidden rounded-card border ${selected ? 'border-border-strong bg-surface-selected' : 'border-border-subtle bg-surface-panel'}`}>
    <button className="grid min-h-16 w-full grid-cols-[1rem_1fr_auto] items-start gap-3 border-0 bg-transparent p-4 text-left focus-visible:outline-2 focus-visible:outline-focus" type="button" aria-pressed={selected} onClick={onSelect}>
      <span className={`mt-1 size-3 rounded-full border ${selected ? 'border-action-primary bg-action-primary' : 'border-border-strong'}`} aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-1">
        <strong className="font-language text-lg">{candidate.surfaceForm}</strong>
        <small className="text-metadata text-fg-tertiary">{expressionTypeLabels[candidate.expressionType]} · {candidate.languageTag}</small>
        <em className="text-body-support leading-6 text-fg-secondary not-italic">{candidate.rationale}</em>
      </span>
      {candidate.bindingStatus === 'confirmed' && <span className="rounded-pill bg-accent-soft px-2 py-1 text-metadata text-feedback-success">{uiText('connectionConfirmed')}</span>}
      {candidate.bindingStatus === 'used' && <span className="rounded-pill bg-surface-subtle px-2 py-1 text-metadata text-fg-secondary">{uiText('alreadyConnected')}</span>}
    </button>
  </li>
);

export const ExpressionBindingScreen = ({
  active,
  personalMeaningId,
  meaningFocusId,
  onBack,
  toast,
}: ExpressionBindingScreenProps) => {
  useTranslation();
  const screenRef = useRef<HTMLElement>(null);
  const gateway = useJourneyGateway();
  const { detail, status } = useJourneyDetail(personalMeaningId);
  const focus = detail?.focuses.find((item) => item.meaningFocusId === meaningFocusId) ?? null;
  const alignment = focus?.alignment ?? null;
  const candidates = alignment?.expressionCandidates ?? [];
  const candidateKey = useMemo(
    () => candidates.map((candidate) => `${candidate.candidateId}:${candidate.surfaceForm}:${candidate.expressionType}`).join('|'),
    [candidates],
  );

  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [surfaceForm, setSurfaceForm] = useState('');
  const [expressionType, setExpressionType] = useState<SensaExpressionType>('word');
  const [relation, setRelation] = useState<SensaExpressionBindingRelation | null>(null);
  const [semanticCoverage, setSemanticCoverage] = useState<SensaSemanticCoverage | null>(null);
  const [bindingStep, setBindingStep] = useState<BindingStep>('candidate');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    screenRef.current?.scrollTo({ top: 0 });
  }, [active, personalMeaningId, meaningFocusId]);

  useEffect(() => {
    setRelation(null);
    setSemanticCoverage(null);
    setBindingStep('candidate');
    setFormError(null);
  }, [active, personalMeaningId, meaningFocusId, candidateKey]);

  useEffect(() => {
    if (candidates.length === 0) {
      setSelectedCandidateId(null);
      setSurfaceForm('');
      return;
    }
    const current = candidates.find((candidate) => candidate.candidateId === selectedCandidateId);
    const next = current ?? candidates.find((candidate) => !candidate.confirmed) ?? candidates[0];
    setSelectedCandidateId(next.candidateId);
    setSurfaceForm(next.surfaceForm);
    setExpressionType(next.expressionType);
  }, [candidateKey]); // candidateKey changes only when the authoritative proposal candidate set changes.

  const selectedCandidate = candidates.find((candidate) => candidate.candidateId === selectedCandidateId) ?? null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !selectedCandidate
      || !alignment
      || !personalMeaningId
      || !meaningFocusId
      || !surfaceForm.trim()
      || !relation
      || !semanticCoverage
    ) return;
    setFormError(null);
    setBusy(true);
    try {
      await gateway.confirmExpressionBinding({
        operationId: opId(),
        personalMeaningId,
        meaningFocusId,
        senseVersionId: alignment.senseVersionId,
        candidateId: selectedCandidate.candidateId,
        languageTag: selectedCandidate.languageTag,
        surfaceForm: surfaceForm.trim(),
        expressionType,
        relation,
        semanticCoverage,
      });
      toast(uiText('targetExpressionConfirmed2'));
      onBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : uiText('unableToConfirmThisConnection');
      setFormError(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  };

  const body = !status.ok
    ? (
      <div className="rounded-card border border-feedback-danger bg-surface-panel p-6 text-center" role="alert">
        <b className="text-feedback-danger">{uiText('unableToLoadYourMeanings')}</b>
        <p className="mt-2 text-body-support text-fg-secondary">{status.error ?? uiText('localMeaningDataIsUnavailable')}</p>
        <button className="mt-4 min-h-11 rounded-control border border-border-strong bg-surface-panel px-4 text-control-label font-semibold" type="button" onClick={onBack}>{uiText('back')}</button>
      </div>
    )
    : !personalMeaningId || !meaningFocusId
      ? unavailable(uiText('unableToConnectAnExpression'), uiText('theContextAndConfirmedMeaningWereNot'))
      : !detail || !focus || !alignment
        ? unavailable(uiText('unableToConnectAnExpression'), uiText('confirmTheMeaningBeforeConnectingAnExpression'))
        : candidates.length === 0
          ? unavailable(uiText('noExpressionToConfirmYet'), uiText('thisMeaningHasNoCandidateExpressionsYet'))
          : (
              <>
                <section className="border-b border-border-subtle pb-7 pt-3">
                  <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{uiText('howWouldYouExpressIt')}</span>
                  <h2 className="mt-3 text-page-title font-semibold">{alignment.semanticSpec?.coreMeaningFocus ?? focus.statement}</h2>
                </section>

                <ol className="my-6 grid grid-cols-3 gap-2" aria-label={uiText('expressionConnectionSteps')}>
                  {(['candidate', 'form', 'relation'] as const).map((step, index) => (
                    <li key={step} className={`flex flex-col items-center gap-2 rounded-control p-3 text-center ${bindingStep === step ? 'bg-accent-soft text-action-primary' : 'bg-surface-subtle text-fg-secondary'}`}>
                      <span className="grid size-7 place-items-center rounded-full border border-current text-metadata font-bold">{index + 1}</span>
                      <small className="text-metadata font-semibold">{index === 0 ? uiText('chooseExpression') : index === 1 ? uiText('confirmForm') : uiText('confirmRelation')}</small>
                    </li>
                  ))}
                </ol>

                {bindingStep === 'candidate' && (
                  <section className="rounded-card border border-border-subtle bg-surface-panel p-5" aria-labelledby="ebs-candidate-heading">
                    <header className="flex items-center justify-between gap-4">
                      <div><h2 className="text-section-title font-semibold" id="ebs-candidate-heading">{uiText('chooseAnExpression')}</h2></div>
                      <span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata text-fg-secondary">{candidates.length} {uiText('items')}</span>
                    </header>
                    <ul className="mt-4 grid gap-3">
                      {candidates.map((candidate) => (
                        <CandidateRow
                          key={candidate.candidateId}
                          candidate={candidate}
                          selected={candidate.candidateId === selectedCandidateId}
                          onSelect={() => {
                            setSelectedCandidateId(candidate.candidateId);
                            setSurfaceForm(candidate.surfaceForm);
                            setExpressionType(candidate.expressionType);
                            setRelation(null);
                            setSemanticCoverage(null);
                            setFormError(null);
                          }}
                        />
                      ))}
                    </ul>
                    <div className="mt-5">
                      <button type="button" className="min-h-12 w-full rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45" disabled={!selectedCandidate} onClick={() => setBindingStep('form')}>
                        {uiText('continue')}<span aria-hidden="true">→</span>
                      </button>
                    </div>
                  </section>
                )}

                <form onSubmit={submit}>
                  {bindingStep === 'form' && <section className="rounded-card border border-border-subtle bg-surface-panel p-5" aria-labelledby="ebs-form-heading">
                    <header>
                      <div><h2 className="text-section-title font-semibold" id="ebs-form-heading">{uiText('confirmSpellingAndType')}</h2></div>
                    </header>
                    <label className="mt-5 grid gap-2">
                      <span className="text-control-label font-semibold">{uiText('expressionForm')}</span>
                      <input
                        className="min-h-12 rounded-control border border-border-strong bg-surface-panel px-3 text-body text-fg-primary focus-visible:outline-2 focus-visible:outline-focus"
                        required
                        value={surfaceForm}
                        onChange={(event) => setSurfaceForm(event.target.value)}
                        placeholder={uiText('enterTheEnglishExpressionToConfirm')}
                      />
                    </label>
                    <label className="mt-5 grid gap-2">
                      <span className="text-control-label font-semibold">{uiText('expressionType')}</span>
                      <select className="min-h-12 rounded-control border border-border-strong bg-surface-panel px-3 text-body text-fg-primary focus-visible:outline-2 focus-visible:outline-focus" value={expressionType} onChange={(event) => setExpressionType(event.target.value as SensaExpressionType)}>
                        {(Object.keys(expressionTypeLabels) as SensaExpressionType[]).map((type) => (
                          <option key={type} value={type}>{expressionTypeLabels[type]}</option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-5 grid gap-3">
                      <button type="button" className="min-h-12 rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45" disabled={!surfaceForm.trim()} onClick={() => setBindingStep('relation')}>
                        {uiText('continue')}<span aria-hidden="true">→</span>
                      </button>
                      <button className="min-h-11 rounded-control border-0 bg-transparent px-4 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle" type="button" onClick={() => setBindingStep('candidate')}>{uiText('backToExpressions')}</button>
                    </div>
                  </section>}

                  {formError && <p className="mt-4 rounded-control border border-feedback-danger bg-surface-panel p-3 text-body-support text-feedback-danger" role="alert">{formError}</p>}

                  {bindingStep === 'relation' && <section className="rounded-card border border-border-subtle bg-surface-panel p-5" aria-labelledby="ebs-relation-heading">
                    <header>
                      <div><h2 className="text-section-title font-semibold" id="ebs-relation-heading">{uiText('howDoesItExpressThisMeaning')}</h2></div>
                    </header>
                    <fieldset className="mt-5 grid gap-2 border-0 p-0">
                      <legend className="mb-2 text-control-label font-semibold">{uiText('relation')}</legend>
                      {(Object.keys(relationLabels) as SensaExpressionBindingRelation[]).map((value) => (
                        <label key={value} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-control border p-3 ${relation === value ? 'border-border-strong bg-surface-selected' : 'border-border-subtle bg-surface-panel'}`}>
                          <input
                            type="radio"
                            name="binding-relation"
                            value={value}
                            checked={relation === value}
                            onChange={() => setRelation(value)}
                          />
                          <span className="flex flex-col gap-1"><b className="text-body-support">{relationLabels[value]}</b><small className="text-metadata leading-5 text-fg-secondary">{relationDescriptions[value]}</small></span>
                        </label>
                      ))}
                    </fieldset>
                    <fieldset className="mt-5 grid gap-2 border-0 p-0">
                      <legend className="mb-2 text-control-label font-semibold">{uiText('semanticCoverage')}</legend>
                      {(Object.keys(coverageLabels) as SensaSemanticCoverage[]).map((value) => (
                        <label key={value} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-control border p-3 ${semanticCoverage === value ? 'border-border-strong bg-surface-selected' : 'border-border-subtle bg-surface-panel'}`}>
                          <input
                            type="radio"
                            name="semantic-coverage"
                            value={value}
                            checked={semanticCoverage === value}
                            onChange={() => setSemanticCoverage(value)}
                          />
                          <span className="flex flex-col gap-1"><b className="text-body-support">{coverageLabels[value]}</b><small className="text-metadata leading-5 text-fg-secondary">{coverageDescriptions[value]}</small></span>
                        </label>
                      ))}
                    </fieldset>
                    {(!relation || !semanticCoverage) && (
                      <p className="mt-4 text-metadata text-fg-tertiary">{uiText('selectBothARelationAndACoverage')}</p>
                    )}
                    <div className="mt-5 grid gap-3">
                      <button
                        type="submit"
                        className="min-h-12 rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-45"
                        disabled={busy || !selectedCandidate || !surfaceForm.trim() || !relation || !semanticCoverage}
                      >
                        {busy ? uiText('confirming') : uiText('confirmThisExpression')} <span aria-hidden="true">→</span>
                      </button>
                      <button className="min-h-11 rounded-control border-0 bg-transparent px-4 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle" type="button" disabled={busy} onClick={() => setBindingStep('form')}>{uiText('backToForm')}</button>
                    </div>
                  </section>}
                </form>
              </>
            );

  return (
    <section
      ref={screenRef}
      className={slideScreenClass(active)}
      id="s-expression-binding"
      data-anim="slide"
      aria-hidden={!active}
    >
      <header className={contentNavigationClass}>
        <button type="button" className={contentNavigationBackClass} onClick={onBack} aria-label={uiText('backToConfirmedMeaning')}>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{uiText('connectAnExpression')}</h1>
        <span />
      </header>
      <div className="mx-auto w-full max-w-4xl px-6 py-8 pb-12 sm:px-10">{body}</div>
    </section>
  );
};

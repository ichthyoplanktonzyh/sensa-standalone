import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { uiClass } from '../ui/classes';
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
  <div className={uiClass("ebs-unavailable")} role="alert">
    <span aria-hidden="true">!</span>
    <h2>{title}</h2>
    <p>{reason}</p>
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
  <li className={uiClass([
    'ebs-candidate',
    selected ? 'is-selected' : '',
    candidate.bindingStatus ? `is-${candidate.bindingStatus}` : '',
  ].filter(Boolean).join(' '))}>
    <button type="button" aria-pressed={selected} onClick={onSelect}>
      <span className={uiClass("ebs-candidate-radio")} aria-hidden="true" />
      <span className={uiClass("ebs-candidate-copy")}>
        <strong>{candidate.surfaceForm}</strong>
        <small>{expressionTypeLabels[candidate.expressionType]} · {candidate.languageTag}</small>
        <em>{candidate.rationale}</em>
      </span>
      {candidate.bindingStatus === 'confirmed' && <span className={uiClass("ebs-candidate-state")}>{uiText('connectionConfirmed')}</span>}
      {candidate.bindingStatus === 'used' && <span className={uiClass("ebs-candidate-state")}>{uiText('alreadyConnected')}</span>}
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
      <div className={uiClass("ebs-error")} role="alert">
        <b>{uiText('unableToLoadYourMeanings')}</b>
        <p>{status.error ?? uiText('localMeaningDataIsUnavailable')}</p>
        <button type="button" onClick={onBack}>{uiText('back')}</button>
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
                <section className={uiClass("ebs-hero")}>
                  <span className={uiClass("ebs-hero-mark")} aria-hidden="true">↗</span>
                  <h2>{uiText('howWouldYouExpressIt')}</h2>
                  <p>{alignment.semanticSpec?.coreMeaningFocus ?? focus.statement}</p>
                </section>

                <ol className={uiClass("ebs-stepper")} aria-label={uiText('expressionConnectionSteps')}>
                  {(['candidate', 'form', 'relation'] as const).map((step, index) => (
                    <li key={step} className={uiClass(bindingStep === step ? 'is-current' : '')}>
                      <span>{index + 1}</span>
                      <small>{index === 0 ? uiText('chooseExpression') : index === 1 ? uiText('confirmForm') : uiText('confirmRelation')}</small>
                    </li>
                  ))}
                </ol>

                {bindingStep === 'candidate' && (
                  <section className={uiClass("ebs-section")} aria-labelledby="ebs-candidate-heading">
                    <header className={uiClass("ebs-section-head")}>
                      <div><h2 id="ebs-candidate-heading">{uiText('chooseAnExpression')}</h2></div>
                      <span>{candidates.length} {uiText('items')}</span>
                    </header>
                    <ul className={uiClass("ebs-candidates")}>
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
                    <div className={uiClass("ebs-actions")}>
                      <button type="button" className={uiClass("ebs-primary")} disabled={!selectedCandidate} onClick={() => setBindingStep('form')}>
                        {uiText('continue')}<span aria-hidden="true">→</span>
                      </button>
                    </div>
                  </section>
                )}

                <form className={uiClass("ebs-form")} onSubmit={submit}>
                  {bindingStep === 'form' && <section className={uiClass("ebs-section")} aria-labelledby="ebs-form-heading">
                    <header className={uiClass("ebs-section-head")}>
                      <div><h2 id="ebs-form-heading">{uiText('confirmSpellingAndType')}</h2></div>
                    </header>
                    <label className={uiClass("ebs-field")}>
                      <span>{uiText('expressionForm')}</span>
                      <input
                        required
                        value={surfaceForm}
                        onChange={(event) => setSurfaceForm(event.target.value)}
                        placeholder={uiText('enterTheEnglishExpressionToConfirm')}
                      />
                    </label>
                    <label className={uiClass("ebs-field")}>
                      <span>{uiText('expressionType')}</span>
                      <select value={expressionType} onChange={(event) => setExpressionType(event.target.value as SensaExpressionType)}>
                        {(Object.keys(expressionTypeLabels) as SensaExpressionType[]).map((type) => (
                          <option key={type} value={type}>{expressionTypeLabels[type]}</option>
                        ))}
                      </select>
                    </label>
                    <div className={uiClass("ebs-actions")}>
                      <button type="button" className={uiClass("ebs-primary")} disabled={!surfaceForm.trim()} onClick={() => setBindingStep('relation')}>
                        {uiText('continue')}<span aria-hidden="true">→</span>
                      </button>
                      <button type="button" onClick={() => setBindingStep('candidate')}>{uiText('backToExpressions')}</button>
                    </div>
                  </section>}

                  {formError && <p className={uiClass("ebs-form-error")} role="alert">{formError}</p>}

                  {bindingStep === 'relation' && <section className={uiClass("ebs-section")} aria-labelledby="ebs-relation-heading">
                    <header className={uiClass("ebs-section-head")}>
                      <div><h2 id="ebs-relation-heading">{uiText('howDoesItExpressThisMeaning')}</h2></div>
                    </header>
                    <fieldset className={uiClass("ebs-choice-set")}>
                      <legend>{uiText('relation')}</legend>
                      {(Object.keys(relationLabels) as SensaExpressionBindingRelation[]).map((value) => (
                        <label key={value} className={uiClass(relation === value ? 'is-selected' : '')}>
                          <input
                            type="radio"
                            name="binding-relation"
                            value={value}
                            checked={relation === value}
                            onChange={() => setRelation(value)}
                          />
                          <span><b>{relationLabels[value]}</b><small>{relationDescriptions[value]}</small></span>
                        </label>
                      ))}
                    </fieldset>
                    <fieldset className={uiClass("ebs-choice-set")}>
                      <legend>{uiText('semanticCoverage')}</legend>
                      {(Object.keys(coverageLabels) as SensaSemanticCoverage[]).map((value) => (
                        <label key={value} className={uiClass(semanticCoverage === value ? 'is-selected' : '')}>
                          <input
                            type="radio"
                            name="semantic-coverage"
                            value={value}
                            checked={semanticCoverage === value}
                            onChange={() => setSemanticCoverage(value)}
                          />
                          <span><b>{coverageLabels[value]}</b><small>{coverageDescriptions[value]}</small></span>
                        </label>
                      ))}
                    </fieldset>
                    {(!relation || !semanticCoverage) && (
                      <p className={uiClass("ebs-selection-hint")}>{uiText('selectBothARelationAndACoverage')}</p>
                    )}
                    <div className={uiClass("ebs-actions")}>
                      <button
                        type="submit"
                        className={uiClass("ebs-primary")}
                        disabled={busy || !selectedCandidate || !surfaceForm.trim() || !relation || !semanticCoverage}
                      >
                        {busy ? uiText('confirming') : uiText('confirmThisExpression')} <span aria-hidden="true">→</span>
                      </button>
                      <button type="button" disabled={busy} onClick={() => setBindingStep('form')}>{uiText('backToForm')}</button>
                    </div>
                  </section>}
                </form>
              </>
            );

  return (
    <section
      ref={screenRef}
      className={uiClass(`screen expression-binding-screen${active ? ' active' : ''}`, "#s-expression-binding")}
      id="s-expression-binding"
      data-anim="slide"
    >
      <header className={uiClass("content-nav ebs-nav")}>
        <button type="button" className={uiClass("content-nav-back")} onClick={onBack} aria-label={uiText('backToConfirmedMeaning')}>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{uiText('connectAnExpression')}</h1>
        <span />
      </header>
      <div className={uiClass("content-page-body ebs-body")}>{body}</div>
    </section>
  );
};

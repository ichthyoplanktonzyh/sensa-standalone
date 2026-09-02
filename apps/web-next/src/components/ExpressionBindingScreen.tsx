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
  word: '单词',
  phrase: '短语',
  construction: '构式',
  sentence: '完整句子',
  utterance_strategy: '表达方式',
};

const relationLabels: Record<SensaExpressionBindingRelation, string> = {
  realizes: '自然实现',
  approximates: '相近表达',
  evokes: '唤起联想',
};

const relationDescriptions: Record<SensaExpressionBindingRelation, string> = {
  realizes: '自然对应的英语说法',
  approximates: '意思相近，但侧重或语境略有差异',
  evokes: '能让人联想到该意思，但含义更宽泛',
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  exact: '完全覆盖',
  broader: '范围更宽',
  narrower: '范围更窄',
  overlapping: '部分重叠',
};

const coverageDescriptions: Record<SensaSemanticCoverage, string> = {
  exact: '表达与当前意思范围完全一致',
  broader: '包含当前意思，也适用于更多场景',
  narrower: '只覆盖当前意思的一部分范围',
  overlapping: '有共同点，但在部分场景下不能互换',
};

const unavailable = (title: string, reason: string) => (
  <div className="ebs-unavailable" role="alert">
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
  <li className={[
    'ebs-candidate',
    selected ? 'is-selected' : '',
    candidate.bindingStatus ? `is-${candidate.bindingStatus}` : '',
  ].filter(Boolean).join(' ')}>
    <button type="button" aria-pressed={selected} onClick={onSelect}>
      <span className="ebs-candidate-radio" aria-hidden="true" />
      <span className="ebs-candidate-copy">
        <strong>{candidate.surfaceForm}</strong>
        <small>{expressionTypeLabels[candidate.expressionType]} · {candidate.languageTag}</small>
        <em>{candidate.rationale}</em>
      </span>
      {candidate.bindingStatus === 'confirmed' && <span className="ebs-candidate-state">已确认绑定</span>}
      {candidate.bindingStatus === 'used' && <span className="ebs-candidate-state">已用于绑定</span>}
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
      toast('已确认这个目标表达');
      onBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法确认表达连接';
      setFormError(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  };

  const body = !status.ok
    ? (
      <div className="ebs-error" role="alert">
        <b>个人意义数据无法读取</b>
        <p>{status.error ?? '本机个人意义数据不可用。'}</p>
        <button type="button" onClick={onBack}>返回</button>
      </div>
    )
    : !personalMeaningId || !meaningFocusId
      ? unavailable('无法进入表达绑定', '没有找到对应的经验与已确认意思。')
      : !detail || !focus || !alignment
        ? unavailable('无法进入表达绑定', '需要先确认意思，才能绑定表达。')
        : candidates.length === 0
          ? unavailable('暂时没有可确认的表达', '当前意思暂无候选表达。')
          : (
              <>
                <section className="ebs-hero">
                  <span className="ebs-hero-mark" aria-hidden="true">↗</span>
                  <h2>你想用什么表达它？</h2>
                  <p>{alignment.semanticSpec?.coreMeaningFocus ?? focus.statement}</p>
                </section>

                <ol className="ebs-stepper" aria-label="绑定表达进度">
                  {(['candidate', 'form', 'relation'] as const).map((step, index) => (
                    <li key={step} className={bindingStep === step ? 'is-current' : ''}>
                      <span>{index + 1}</span>
                      <small>{index === 0 ? '选择表达' : index === 1 ? '确认形式' : '确认关系'}</small>
                    </li>
                  ))}
                </ol>

                {bindingStep === 'candidate' && (
                  <section className="ebs-section" aria-labelledby="ebs-candidate-heading">
                    <header className="ebs-section-head">
                      <div><h2 id="ebs-candidate-heading">选择一个表达</h2></div>
                      <span>{candidates.length} 个</span>
                    </header>
                    <ul className="ebs-candidates">
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
                    <div className="ebs-actions">
                      <button type="button" className="ebs-primary" disabled={!selectedCandidate} onClick={() => setBindingStep('form')}>
                        继续 <span aria-hidden="true">→</span>
                      </button>
                    </div>
                  </section>
                )}

                <form className="ebs-form" onSubmit={submit}>
                  {bindingStep === 'form' && <section className="ebs-section" aria-labelledby="ebs-form-heading">
                    <header className="ebs-section-head">
                      <div><h2 id="ebs-form-heading">确认写法与类型</h2></div>
                    </header>
                    <label className="ebs-field">
                      <span>表达形式</span>
                      <input
                        required
                        value={surfaceForm}
                        onChange={(event) => setSurfaceForm(event.target.value)}
                        placeholder="输入你要确认的英语表达"
                      />
                    </label>
                    <label className="ebs-field">
                      <span>表达类型</span>
                      <select value={expressionType} onChange={(event) => setExpressionType(event.target.value as SensaExpressionType)}>
                        {(Object.keys(expressionTypeLabels) as SensaExpressionType[]).map((type) => (
                          <option key={type} value={type}>{expressionTypeLabels[type]}</option>
                        ))}
                      </select>
                    </label>
                    <div className="ebs-actions">
                      <button type="button" className="ebs-primary" disabled={!surfaceForm.trim()} onClick={() => setBindingStep('relation')}>
                        继续 <span aria-hidden="true">→</span>
                      </button>
                      <button type="button" onClick={() => setBindingStep('candidate')}>返回选择表达</button>
                    </div>
                  </section>}

                  {formError && <p className="ebs-form-error" role="alert">{formError}</p>}

                  {bindingStep === 'relation' && <section className="ebs-section" aria-labelledby="ebs-relation-heading">
                    <header className="ebs-section-head">
                      <div><h2 id="ebs-relation-heading">它怎样表达这个意思？</h2></div>
                    </header>
                    <fieldset className="ebs-choice-set">
                      <legend>关系</legend>
                      {(Object.keys(relationLabels) as SensaExpressionBindingRelation[]).map((value) => (
                        <label key={value} className={relation === value ? 'is-selected' : ''}>
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
                    <fieldset className="ebs-choice-set">
                      <legend>语义覆盖</legend>
                      {(Object.keys(coverageLabels) as SensaSemanticCoverage[]).map((value) => (
                        <label key={value} className={semanticCoverage === value ? 'is-selected' : ''}>
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
                      <p className="ebs-selection-hint">请分别选择关系和语义覆盖范围后再确认。</p>
                    )}
                    <div className="ebs-actions">
                      <button
                        type="submit"
                        className="ebs-primary"
                        disabled={busy || !selectedCandidate || !surfaceForm.trim() || !relation || !semanticCoverage}
                      >
                        {busy ? '正在确认…' : '确认这个表达'} <span aria-hidden="true">→</span>
                      </button>
                      <button type="button" disabled={busy} onClick={() => setBindingStep('form')}>返回确认形式</button>
                    </div>
                  </section>}
                </form>
              </>
            );

  return (
    <section
      ref={screenRef}
      className={`screen expression-binding-screen${active ? ' active' : ''}`}
      id="s-expression-binding"
      data-anim="slide"
    >
      <header className="content-nav ebs-nav">
        <button type="button" className="content-nav-back" onClick={onBack} aria-label="返回已确认 Sense">
          <svg className="icon" aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>绑定目标表达</h1>
        <span />
      </header>
      <div className="content-page-body ebs-body">{body}</div>
    </section>
  );
};

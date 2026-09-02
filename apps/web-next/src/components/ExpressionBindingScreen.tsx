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

const expressionTypeLabels: Record<SensaExpressionType, string> = {
  word: '单词',
  phrase: '短语',
  construction: '构式',
  sentence: '完整句子',
  utterance_strategy: '表达方式',
};

const relationLabels: Record<SensaExpressionBindingRelation, string> = {
  realizes: '实现这个 Sense',
  approximates: '接近这个 Sense',
  evokes: '唤起这个 Sense',
};

const relationDescriptions: Record<SensaExpressionBindingRelation, string> = {
  realizes: '这个表达是该意义在英语中的自然实现。',
  approximates: '这个表达覆盖相近范围，但边界并不完全相同。',
  evokes: '这个表达会唤起该意义，但不直接承担完整边界。',
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  exact: '完全覆盖',
  broader: '范围更宽',
  narrower: '范围更窄',
  overlapping: '部分重叠',
};

const coverageDescriptions: Record<SensaSemanticCoverage, string> = {
  exact: '表达与当前 Sense 的语义边界相符。',
  broader: '表达可以覆盖当前 Sense，也包含更宽的范围。',
  narrower: '表达只覆盖当前 Sense 的一部分范围。',
  overlapping: '表达与当前 Sense 有重叠，但不能互相替代。',
};

const shortId = (id: string): string => id.split('-')[0].toUpperCase();

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
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    screenRef.current?.scrollTo({ top: 0 });
  }, [active, personalMeaningId, meaningFocusId]);

  useEffect(() => {
    setRelation(null);
    setSemanticCoverage(null);
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
      toast('已确认这条 Expression Binding');
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
      ? unavailable('无法进入表达绑定', '进入此页面需要精确的 Personal Meaning 与 Meaning Focus。')
      : !detail || !focus || !alignment
        ? unavailable('无法进入表达绑定', '只有已经确认 Sense 的 Focus 才能确认表达。')
        : candidates.length === 0
          ? unavailable('暂时没有可确认的表达', '当前 Sense 没有可供确认的目标语言表达候选；不会为你生成一个无来源的表达。')
          : (
              <>
                <section className="ebs-hero">
                  <span className="ebs-hero-mark" aria-hidden="true">↗</span>
                  <small>EXPRESSION BINDING</small>
                  <h2>为这个 Sense 找到表达</h2>
                  <p>这是独立的确认动作。表达可以实现、接近或唤起一个 Sense，不是中文与英文之间的翻译等号。</p>
                  <div className="ebs-context-line">
                    <span>Sense {shortId(alignment.senseId)}</span>
                    <span>Version v{alignment.senseVersionNumber ?? '—'}</span>
                    <span>{alignment.confirmedBindings.length} 条已确认表达</span>
                  </div>
                </section>

                <section className="ebs-section" aria-labelledby="ebs-candidate-heading">
                  <header className="ebs-section-head">
                    <div>
                      <small>STEP 1 · PROPOSAL CANDIDATES</small>
                      <h2 id="ebs-candidate-heading">选择一个表达候选</h2>
                    </div>
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
                </section>

                <form className="ebs-form" onSubmit={submit}>
                  <section className="ebs-section" aria-labelledby="ebs-form-heading">
                    <header className="ebs-section-head">
                      <div>
                        <small>STEP 2 · LEARNER CONFIRMATION</small>
                        <h2 id="ebs-form-heading">确认表达的具体形式</h2>
                      </div>
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
                  </section>

                  {formError && <p className="ebs-form-error" role="alert">{formError}</p>}

                  <section className="ebs-section" aria-labelledby="ebs-relation-heading">
                    <header className="ebs-section-head">
                      <div>
                        <small>STEP 3 · SEMANTIC RELATION</small>
                        <h2 id="ebs-relation-heading">它如何连接这个 Sense？</h2>
                      </div>
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
                  </section>

                  <section className="ebs-boundary-note">
                    <span aria-hidden="true">○</span>
                    <p>确认表达只会建立 Expression Binding。不会加入学习、创建学习目标、记录学习证据或改变任何复习状态。</p>
                  </section>

                  <div className="ebs-actions">
                    <button
                      type="submit"
                      className="ebs-primary"
                      disabled={busy || !selectedCandidate || !surfaceForm.trim() || !relation || !semanticCoverage}
                    >
                      {busy ? '正在确认…' : '确认这条表达连接'} <span aria-hidden="true">→</span>
                    </button>
                    <button type="button" disabled={busy} onClick={onBack}>暂不绑定，返回 Sense</button>
                  </div>
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
        <h1>表达绑定</h1>
        <span className="ebs-nav-status">独立确认</span>
      </header>
      <div className="content-page-body ebs-body">{body}</div>
    </section>
  );
};

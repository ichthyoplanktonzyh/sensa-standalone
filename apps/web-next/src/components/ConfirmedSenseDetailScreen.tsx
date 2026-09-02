/**
 * Read-only endpoint for Meaning Formation.
 *
 * This is intentionally separate from the content Sense detail. It reads the
 * exact Personal Meaning → Focus → Alignment projection and is the only place
 * from which the independent Expression Binding journey begins. It never
 * creates a Learning Target or enters the learning runtime.
 */

import { useEffect, useRef } from 'react';
import {
  useJourneyDetail,
  type JourneyFocusView,
  type JourneyExpressionCandidateView,
  type JourneySemanticSpecView,
} from '../personalMeaningJourney';
import type {
  SensaExpressionBindingRelation,
  SensaSemanticCoverage,
} from '@sensa/contracts/sensa';

export interface ConfirmedSenseDetailScreenProps {
  active: boolean;
  personalMeaningId: string | null;
  meaningFocusId: string | null;
  onBack: () => void;
  onOpenBinding: () => void;
}

const relationLabels: Record<SensaExpressionBindingRelation, string> = {
  realizes: '实现这个 Sense',
  approximates: '接近这个 Sense',
  evokes: '唤起这个 Sense',
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  exact: '覆盖范围相符',
  broader: '表达范围更宽',
  narrower: '表达范围更窄',
  overlapping: '表达范围部分重叠',
};

const expressionTypeLabels = {
  word: '单词',
  phrase: '短语',
  construction: '构式',
  sentence: '完整句子',
  utterance_strategy: '表达方式',
} as const;

const languageLabel = (languageTag: string): string =>
  languageTag === 'en' ? '英语' : languageTag;

const shortId = (id: string): string => id.split('-')[0].toUpperCase();

const unavailableCopy = (reason: string) => (
  <div className="csd-unavailable" role="alert">
    <span className="csd-unavailable-mark" aria-hidden="true">!</span>
    <h2>暂时无法打开已确认 Sense</h2>
    <p>{reason}</p>
  </div>
);

const SpecList = ({
  title,
  items,
  tone = 'neutral',
}: {
  title: string;
  items: readonly string[];
  tone?: 'neutral' | 'include' | 'exclude';
}) => {
  if (items.length === 0) return null;
  return (
    <section className={`csd-spec-list is-${tone}`}>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
};

const SenseSpec = ({
  spec,
  version,
  unresolvedQuestions,
}: {
  spec: JourneySemanticSpecView;
  version: number | null;
  unresolvedQuestions: readonly string[];
}) => (
  <section className="csd-section csd-semantic-spec" aria-labelledby="csd-spec-heading">
    <header className="csd-section-head">
      <div>
        <small>SEMANTIC SPECIFICATION · SENSE VERSION v{version ?? '—'}</small>
        <h2 id="csd-spec-heading">这个 Sense 的边界</h2>
      </div>
      <span className="csd-fact-pill">已确认</span>
    </header>

    <p className="csd-core-meaning">{spec.coreMeaningFocus}</p>

    {spec.prototypeScenes.map((scene, index) => (
      <article className="csd-prototype-scene" key={`${scene.summary}-${index}`}>
        <small>原型场景{spec.prototypeScenes.length > 1 ? ` ${index + 1}` : ''}</small>
        <h3>{scene.summary}</h3>
        <dl>
          {scene.participantRoles.length > 0 && (
            <div><dt>参与角色</dt><dd>{scene.participantRoles.join(' / ')}</dd></div>
          )}
          {scene.states.length > 0 && (
            <div><dt>状态</dt><dd>{scene.states.join('；')}</dd></div>
          )}
          {scene.directionOrCausality && (
            <div><dt>方向 / 因果</dt><dd>{scene.directionOrCausality}</dd></div>
          )}
        </dl>
      </article>
    ))}

    <div className="csd-spec-columns">
      <SpecList title="包含" items={spec.includedCases} tone="include" />
      <SpecList title="排除" items={spec.excludedCases} tone="exclude" />
    </div>

    {spec.neighborContrasts.length > 0 && (
      <section className="csd-neighbors">
        <h3>与相邻意义的区别</h3>
        <ul>
          {spec.neighborContrasts.map((contrast) => (
            <li key={contrast.label}>
              <b>{contrast.label}</b>
              <span>{contrast.distinction}</span>
            </li>
          ))}
        </ul>
      </section>
    )}

    {spec.openQuestions.length > 0 || unresolvedQuestions.length > 0 ? (
      <section className="csd-open-questions">
        <h3>确认时仍保留的问题</h3>
        <ul>
          {[...spec.openQuestions, ...unresolvedQuestions].map((question, index) => (
            <li key={`${question}-${index}`}>{question}</li>
          ))}
        </ul>
      </section>
    ) : null}
  </section>
);

const CandidateList = ({ candidates }: { candidates: readonly JourneyExpressionCandidateView[] }) => (
  <section className="csd-section csd-candidates" aria-labelledby="csd-candidates-heading">
    <header className="csd-section-head">
      <div>
        <small>EXPRESSION CANDIDATES · SUGGESTION ONLY</small>
        <h2 id="csd-candidates-heading">可能的目标语言表达</h2>
      </div>
    </header>
    <p className="csd-section-note">这些候选来自确认 Sense 时的提议，不是翻译等号；确认后的来源状态会单独标注。</p>
    {candidates.length > 0 ? (
      <ul>
        {candidates.map((candidate) => (
          <li
            key={candidate.candidateId}
            className={candidate.bindingStatus ? `is-${candidate.bindingStatus}` : ''}
          >
            <div>
              <strong>{candidate.surfaceForm}</strong>
              <span>{expressionTypeLabels[candidate.expressionType]} · {languageLabel(candidate.languageTag)}</span>
              <p>{candidate.rationale}</p>
            </div>
            {candidate.bindingStatus === 'confirmed' && <em>已确认绑定</em>}
            {candidate.bindingStatus === 'used' && <em>已用于绑定（表达形式已调整）</em>}
          </li>
        ))}
      </ul>
    ) : (
      <div className="csd-candidates-empty">
        <b>当前没有可确认的目标语言表达</b>
        <p>Sense 与 Alignment 仍然有效；之后出现合适表达时，可以再从这里进入 Binding。</p>
      </div>
    )}
  </section>
);

const BindingSummary = ({ focus }: { focus: JourneyFocusView }) => {
  const alignment = focus.alignment!;
  const hasBindings = alignment.confirmedBindings.length > 0;
  return (
    <section className={`csd-section csd-binding-summary${hasBindings ? ' is-bound' : ''}`} aria-labelledby="csd-binding-heading">
      <header className="csd-section-head">
        <div>
          <small>EXPRESSION BINDING · INDEPENDENT FACT</small>
          <h2 id="csd-binding-heading">表达连接</h2>
        </div>
        <span className="csd-fact-pill">{hasBindings ? '已绑定' : '待绑定'}</span>
      </header>
      {hasBindings ? (
        <ul className="csd-binding-list">
          {alignment.confirmedBindings.map((binding) => (
            <li key={binding.bindingVersionId}>
              <div>
                <strong>{binding.surfaceForm}</strong>
                <span>{expressionTypeLabels[binding.expressionType]} · {languageLabel(binding.languageTag)}</span>
              </div>
              <small>{relationLabels[binding.relation]} · {coverageLabels[binding.semanticCoverage]}</small>
            </li>
          ))}
        </ul>
      ) : (
        <div className="csd-binding-empty">
          <b>这个 Sense 还没有确认的目标语言表达</b>
          <p>可以在下一步选择候选、修改表达形式，并明确它与 Sense 的关系和覆盖范围。</p>
        </div>
      )}
    </section>
  );
};

export const ConfirmedSenseDetailScreen = ({
  active,
  personalMeaningId,
  meaningFocusId,
  onBack,
  onOpenBinding,
}: ConfirmedSenseDetailScreenProps) => {
  const screenRef = useRef<HTMLElement>(null);
  const { detail, status } = useJourneyDetail(personalMeaningId);
  const focus = detail?.focuses.find((item) => item.meaningFocusId === meaningFocusId) ?? null;
  const alignment = focus?.alignment ?? null;

  useEffect(() => {
    if (active) screenRef.current?.scrollTo({ top: 0 });
  }, [active, personalMeaningId, meaningFocusId]);

  const body = !status.ok
    ? (
      <div className="csd-error" role="alert">
        <b>个人意义数据无法读取</b>
        <p>{status.error ?? '本机个人意义数据不可用。'}</p>
        <button type="button" onClick={onBack}>返回</button>
      </div>
    )
    : !personalMeaningId || !meaningFocusId
      ? unavailableCopy('进入此页面需要精确的 Personal Meaning 与 Meaning Focus。')
      : !detail || !focus || !alignment
        ? unavailableCopy('只有已经确认 Sense 的 Focus 才能打开这个详情。')
        : !alignment.semanticSpec
          ? unavailableCopy('这个 Focus 缺少已确认的 Sense 语义规格，暂时不能安全展示。')
          : (
            <>
              <section className="csd-hero">
                <span className="csd-confirm-mark" aria-hidden="true">✓</span>
                <small>MEANING FORMATION COMPLETE</small>
                <h2>Sense 已确认</h2>
                <p>你已经把这个 Meaning Focus 连接到一个稳定、可复现的 Sense。Personal Meaning 与原始锚点仍然属于你。</p>
                <div className="csd-id-row">
                  <span>Sense {shortId(alignment.senseId)}</span>
                  <span>Sense Version v{alignment.senseVersionNumber ?? '—'}</span>
                  <span>Alignment {shortId(alignment.personalMeaningAlignmentId)}</span>
                </div>
              </section>

              <section className="csd-context-card" aria-label="Personal Meaning 与 Meaning Focus">
                <small>来自 Personal Meaning · {detail.shortId}</small>
                <h2>{detail.displayLabel ?? '我的个人意义'}</h2>
                <p><b>我真正在意的是</b>{focus.statement}</p>
                {focus.distinguishingNotes.length > 0 && (
                  <ul>{focus.distinguishingNotes.map((note) => <li key={note}>{note}</li>)}</ul>
                )}
              </section>

              <SenseSpec
                spec={alignment.semanticSpec}
                version={alignment.semanticSpecVersion}
                unresolvedQuestions={alignment.unresolvedQuestions}
              />
              <p className="csd-spec-provenance">
                Sense Version provenance：{alignment.origin} · review：{alignment.reviewStatus}
                {alignment.semanticPolicyVersion ? ` · semantic policy ${alignment.semanticPolicyVersion}` : ''}
                {alignment.generator ? ` · generator ${alignment.generator.provider} / ${alignment.generator.model}` : ''}
              </p>
              <CandidateList candidates={alignment.expressionCandidates} />
              <BindingSummary focus={focus} />

              <section className="csd-next-step">
                <small>下一条独立旅程</small>
                <h2>
                  {alignment.expressionCandidates.length === 0
                    ? '这个 Sense 暂无合适表达'
                    : alignment.confirmedBindings.length > 0
                      ? '继续确认其他表达'
                      : '为这个 Sense 确认表达'}
                </h2>
                <p>
                  {alignment.expressionCandidates.length === 0
                    ? 'Sense 与 Alignment 仍然有效；当前没有带来源的候选可以进入表达绑定。'
                    : 'Expression Binding 只记录表达如何实现、接近或唤起这个 Sense。确认它不会加入学习，也不会表示已经掌握。'}
                </p>
                <div className="csd-actions">
                  {alignment.expressionCandidates.length > 0 && (
                    <button type="button" className="csd-primary" onClick={onOpenBinding}>
                      {alignment.confirmedBindings.length > 0 ? '打开表达连接' : '进入表达绑定'} <span aria-hidden="true">→</span>
                    </button>
                  )}
                  <button type="button" onClick={onBack}>返回上一页</button>
                </div>
              </section>

              <p className="csd-learning-boundary">
                状态：Sense 已确认 · {alignment.expressionCandidates.length === 0
                  ? '暂无合适表达'
                  : alignment.confirmedBindings.length > 0 ? '表达已绑定' : '表达待绑定'} · 尚未加入学习
              </p>
            </>
          );

  return (
    <section
      ref={screenRef}
      className={`screen confirmed-sense-detail-screen${active ? ' active' : ''}`}
      id="s-confirmed-sense"
      data-anim="slide"
    >
      <header className="content-nav csd-nav">
        <button type="button" className="content-nav-back" onClick={onBack} aria-label="返回上一页">
          <svg className="icon" aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>已确认 Sense</h1>
        <span className="csd-nav-status">已确认</span>
      </header>
      <div className="content-page-body csd-body">{body}</div>
    </section>
  );
};

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
  <details className="csd-section csd-spec-details is-standalone">
      <summary>查看场景与语义边界 <span>Sense Version v{version ?? '—'}</span></summary>
      <div className="csd-spec-details-body">
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
      </div>
  </details>
);

const BindingSummary = ({ focus }: { focus: JourneyFocusView }) => {
  const alignment = focus.alignment!;
  const hasBindings = alignment.confirmedBindings.length > 0;
  return (
    <section className={`csd-section csd-binding-summary${hasBindings ? ' is-bound' : ''}`} aria-labelledby="csd-binding-heading">
      <header className="csd-section-head">
        <div>
          <small>目标表达</small>
          <h2 id="csd-binding-heading">已经绑定的表达</h2>
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
          <b>还没有确认目标表达</b>
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
      ? unavailableCopy('没有找到对应的经验与已确认意思。')
      : !detail || !focus || !alignment
        ? unavailableCopy('只有已经确认 Sense 的 Focus 才能打开这个详情。')
        : !alignment.semanticSpec
          ? unavailableCopy('这个 Focus 缺少已确认的 Sense 语义规格，暂时不能安全展示。')
          : (
            <>
              <section className="csd-hero">
                <span className="csd-confirm-mark" aria-hidden="true">✓</span>
                <small>{alignment.confirmedBindings.length > 0 ? '三个事实已确认' : '已确认 2 / 3'}</small>
                <h2>{alignment.semanticSpec.coreMeaningFocus}</h2>
                <p>来自你选择的侧面：{focus.statement}</p>
              </section>

              <section className="csd-stable-facts" aria-label="语义事实">
                <article className="is-confirmed">
                  <small>表达侧面</small><span>已确认</span><p>{focus.statement}</p>
                </article>
                <article className="is-confirmed">
                  <small>稳定意思</small><span>已确认</span><p>{alignment.semanticSpec.coreMeaningFocus}</p>
                </article>
                <article className={alignment.confirmedBindings.length > 0 ? 'is-confirmed' : 'is-pending'}>
                  <small>目标表达</small>
                  <span>{alignment.confirmedBindings.length > 0 ? '已确认' : '待确认'}</span>
                  <p>{alignment.confirmedBindings.map((binding) => binding.surfaceForm).join(' / ') || '从 AI 候选中选择并确认'}</p>
                </article>
              </section>

              <section className="csd-next-step">
                <small>下一步</small>
                <h2>
                  {alignment.expressionCandidates.length === 0
                    ? '模型暂时没有找到合适表达'
                    : alignment.confirmedBindings.length > 0
                      ? '稳定语义结果已形成'
                      : '还需确认最后一个事实'}
                </h2>
                <div className="csd-actions">
                  {alignment.expressionCandidates.length > 0 && (
                    <button type="button" className="csd-primary" onClick={onOpenBinding}>
                      {alignment.confirmedBindings.length > 0 ? '打开目标表达' : '绑定目标表达'} <span aria-hidden="true">→</span>
                    </button>
                  )}
                  <button type="button" onClick={onBack}>返回我的词义世界</button>
                </div>
              </section>

              <SenseSpec
                spec={alignment.semanticSpec}
                version={alignment.semanticSpecVersion}
                unresolvedQuestions={alignment.unresolvedQuestions}
              />
              <details className="csd-identity-details">
                <summary>身份与来源信息</summary>
                <p>
                  Sense {shortId(alignment.senseId)} · Sense Version v{alignment.senseVersionNumber ?? '—'} · Alignment {shortId(alignment.personalMeaningAlignmentId)}
                </p>
                <p>
                  provenance：{alignment.origin} · review：{alignment.reviewStatus}
                  {alignment.semanticPolicyVersion ? ` · semantic policy ${alignment.semanticPolicyVersion}` : ''}
                  {alignment.generator ? ` · generator ${alignment.generator.provider} / ${alignment.generator.model}` : ''}
                </p>
              </details>
              {alignment.confirmedBindings.length > 0 && <BindingSummary focus={focus} />}
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
        <h1>确认的意思</h1>
        <span />
      </header>
      <div className="content-page-body csd-body">{body}</div>
    </section>
  );
};

import { uiClass } from '../ui/classes';
/**
 * Read-only endpoint for Meaning Formation.
 *
 * This is intentionally separate from the content Sense detail. It reads the
 * exact Personal Meaning → optional Focus → Alignment projection and is the only place
 * from which the independent Expression Binding journey begins. It never
 * creates a Learning Target or enters the learning runtime.
 */

import { useEffect, useRef } from 'react';
import {
  useJourneyDetail,
  type JourneyAlignmentView,
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
  realizes: '实现这个意思',
  approximates: '接近这个意思',
  evokes: '唤起这个意思',
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  exact: '完全覆盖',
  broader: '范围更宽',
  narrower: '范围更窄',
  overlapping: '部分重叠',
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
  <div className={uiClass("csd-unavailable")} role="alert">
    <span className={uiClass("csd-unavailable-mark")} aria-hidden="true">!</span>
    <h2>暂时无法打开</h2>
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
    <section className={uiClass(`csd-spec-list is-${tone}`)}>
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
  <details className={uiClass("csd-section csd-spec-details is-standalone")}>
      <summary>场景与边界 <span>v{version ?? '1'}</span></summary>
      <div className={uiClass("csd-spec-details-body")}>
        {spec.prototypeScenes.map((scene, index) => (
          <article className={uiClass("csd-prototype-scene")} key={`${scene.summary}-${index}`}>
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

        <div className={uiClass("csd-spec-columns")}>
          <SpecList title="包含" items={spec.includedCases} tone="include" />
          <SpecList title="排除" items={spec.excludedCases} tone="exclude" />
        </div>

        {spec.neighborContrasts.length > 0 && (
          <section className={uiClass("csd-neighbors")}>
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
          <section className={uiClass("csd-open-questions")}>
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

const BindingSummary = ({ alignment }: { alignment: JourneyAlignmentView }) => {
  const hasBindings = alignment.confirmedBindings.length > 0;
  return (
    <section className={uiClass(`csd-section csd-binding-summary${hasBindings ? ' is-bound' : ''}`)} aria-labelledby="csd-binding-heading">
      <header className={uiClass("csd-section-head")}>
        <div>
          <small>目标表达</small>
          <h2 id="csd-binding-heading">已经绑定的表达</h2>
        </div>
        <span className={uiClass("csd-fact-pill")}>{hasBindings ? '已绑定' : '待绑定'}</span>
      </header>
      {hasBindings ? (
        <ul className={uiClass("csd-binding-list")}>
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
        <div className={uiClass("csd-binding-empty")}>
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
  const directAlignment = detail?.directAlignments.find(
    (item) => item.personalMeaningAlignmentId === meaningFocusId,
  ) ?? null;
  const alignment = focus?.alignment ?? directAlignment;

  useEffect(() => {
    if (active) screenRef.current?.scrollTo({ top: 0 });
  }, [active, personalMeaningId, meaningFocusId]);

  const body = !status.ok
    ? (
      <div className={uiClass("csd-error")} role="alert">
        <b>个人意义数据无法读取</b>
        <p>{status.error ?? '本机个人意义数据不可用。'}</p>
        <button type="button" onClick={onBack}>返回</button>
      </div>
    )
    : !personalMeaningId || !meaningFocusId
      ? unavailableCopy('没有找到对应的经验与已确认意思。')
      : !detail || !alignment
        ? unavailableCopy('没有找到对应的已确认 Sense。')
        : !alignment.semanticSpec
          ? unavailableCopy('这个已确认意思缺少 Sense 语义规格，暂时不能安全展示。')
          : (
            <>
              <section className={uiClass("csd-hero")}>
                <span className={uiClass("csd-confirm-mark")} aria-hidden="true">✓</span>
                <small>{alignment.confirmedBindings.length > 0 ? '已连接表达' : '已确认意思'}</small>
                <h2>{alignment.semanticSpec.coreMeaningFocus}</h2>
                <p>{focus ? `来自侧面：${focus.statement}` : '由当前 Context 中定位的 Expression 直接解析'}</p>
              </section>

              <section className={uiClass("csd-next-step")}>
                <div className={uiClass("csd-actions")}>
                  {focus && alignment.expressionCandidates.length > 0 && (
                    <button type="button" className={uiClass("csd-primary")} onClick={onOpenBinding}>
                      {alignment.confirmedBindings.length > 0 ? '查看/更改目标表达' : '绑定目标表达'} <span aria-hidden="true">→</span>
                    </button>
                  )}
                  <button type="button" onClick={onBack}>返回词义世界</button>
                </div>
              </section>

              <SenseSpec
                spec={alignment.semanticSpec}
                version={alignment.semanticSpecVersion}
                unresolvedQuestions={alignment.unresolvedQuestions}
              />
              <details className={uiClass("csd-identity-details")}>
                <summary>来源与技术信息</summary>
                <p>
                  ID {shortId(alignment.senseId)} · v{alignment.senseVersionNumber ?? '1'}
                </p>
                <p>
                  来源：{alignment.origin}
                  {alignment.generator ? ` · ${alignment.generator.provider} / ${alignment.generator.model}` : ''}
                </p>
              </details>
              {alignment.confirmedBindings.length > 0 && <BindingSummary alignment={alignment} />}
            </>
          );

  return (
    <section
      ref={screenRef}
      className={uiClass(`screen confirmed-sense-detail-screen${active ? ' active' : ''}`, "#s-confirmed-sense")}
      id="s-confirmed-sense"
      data-anim="slide"
    >
      <header className={uiClass("content-nav csd-nav")}>
        <button type="button" className={uiClass("content-nav-back")} onClick={onBack} aria-label="返回上一页">
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>已确认意思</h1>
        <span />
      </header>
      <div className={uiClass("content-page-body csd-body")}>{body}</div>
    </section>
  );
};

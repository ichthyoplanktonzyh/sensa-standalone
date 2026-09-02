/**
 * Personal Meaning journey detail screen.
 *
 * This is the first complete, refresh-recoverable learner journey surface:
 * Personal Meaning → clarify/accept a Meaning Focus → Sense Construction →
 * review a Sense Proposal → explicitly confirm a Sense (stable Sense + immutable
 * initial SenseVersion) → Personal Meaning Alignment. Expression Binding is a
 * separate follow-up journey and is deliberately not confirmed on this screen.
 *
 * The screen owns no journey facts of its own. It reads derived view models from
 * the journey gateway and issues learner intents back to it. Every phase shown
 * here is DERIVED from facts; nothing is a stored status. Confirmation is never
 * "learning": it creates a Sense and an Alignment, never a LearningTarget.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PHASE_LABELS,
  useJourneyDetail,
  useJourneyGateway,
  type JourneyAnchorView,
  type JourneyConstructionView,
  type JourneyDetailView,
  type JourneyFocusView,
  type JourneyProposalView,
  type CreateMeaningFocusInput,
  type ExpressionBindingPhase,
  type SenseFormationPhase,
} from '../personalMeaningJourney';
import { newUuid } from '../personalMeaningJourney/ids';

interface PersonalMeaningDetailScreenProps {
  active: boolean;
  personalMeaningId: string | null;
  initialFocusId?: string | null;
  onBack: () => void;
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
  toast: (message: string) => void;
}

/** A fresh operation id per learner intent; command idempotency guards re-sends. */
const opId = newUuid;

const ACTOR_LABEL: Record<JourneyConstructionView['turns'][number]['actor'], string> = {
  system: '系统',
  semantic_llm: '语义助手（模拟）',
  learner: '我',
};

const SENSE_FORMATION_LABELS: Record<SenseFormationPhase, string> = {
  focus_missing: '尚未形成 Focus',
  focus_pending_acceptance: 'Focus 待确认',
  clarifying: '澄清中',
  proposal_pending: 'Proposal 待确认',
  sense_confirmed: 'Sense 已确认',
};

const EXPRESSION_BINDING_LABELS: Record<ExpressionBindingPhase, string> = {
  not_ready: '尚不可开始',
  pending: '待绑定',
  partial: '部分已绑定',
  bound: '已绑定',
};

const MeaningStatusAxes = ({ detail }: { detail: JourneyDetailView }) => (
  <div className="pmj-meaning-axes" aria-label="Personal Meaning 的两个独立状态轴">
    <div className={'pmj-meaning-axis is-sense-' + detail.senseFormation.phase}>
      <small>Sense Formation · 意义形成</small>
      <strong>{SENSE_FORMATION_LABELS[detail.senseFormation.phase]}</strong>
      <span>
        {detail.senseFormation.focusCount === 0
          ? '尚无 Meaning Focus'
          : `${detail.senseFormation.confirmedSenseCount}/${detail.senseFormation.focusCount} 个 Focus 已有 Sense`}
      </span>
    </div>
    <div className={'pmj-meaning-axis is-binding-' + detail.expressionBinding.phase}>
      <small>Expression Binding · 表达连接</small>
      <strong>{EXPRESSION_BINDING_LABELS[detail.expressionBinding.phase]}</strong>
      <span>{detail.expressionBinding.confirmedBindingCount} 条当前表达绑定 · {detail.expressionBinding.boundSenseCount} 个 Sense 已连接</span>
    </div>
  </div>
);

export const PersonalMeaningDetailScreen = ({
  active,
  personalMeaningId,
  initialFocusId,
  onBack,
  onOpenConfirmedSense,
  toast,
}: PersonalMeaningDetailScreenProps) => {
  const screenRef = useRef<HTMLElement>(null);
  const gateway = useJourneyGateway();
  const { detail, status } = useJourneyDetail(personalMeaningId);

  const [busy, setBusy] = useState(false);
  const [customFocusOpen, setCustomFocusOpen] = useState(false);
  const [customStatement, setCustomStatement] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirmingFocusId, setConfirmingFocusId] = useState<string | null>(null);
  const [splitFor, setSplitFor] = useState<string | null>(null);
  const [splitStatement, setSplitStatement] = useState('');
  const [editingFocusId, setEditingFocusId] = useState<string | null>(null);
  const [editStatement, setEditStatement] = useState('');
  const [anchorsOpen, setAnchorsOpen] = useState(false);
  const [newFamiliar, setNewFamiliar] = useState('');
  const [newExperience, setNewExperience] = useState('');
  const [editingAnchorId, setEditingAnchorId] = useState<string | null>(null);
  const [anchorDraft, setAnchorDraft] = useState('');
  const [selectedFocusId, setSelectedFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (!active) {
      setSelectedFocusId(null);
      setConfirmingFocusId(null);
    }
  }, [active]);

  useEffect(() => {
    setSelectedFocusId(null);
    setConfirmingFocusId(null);
  }, [personalMeaningId]);

  useEffect(() => {
    if (active) setSelectedFocusId(initialFocusId ?? null);
  }, [active, initialFocusId]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        if (okMsg) toast(okMsg);
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : '操作失败');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const currentMeaningId = detail?.personalMeaningId ?? personalMeaningId ?? '';
  const selectedFocus = detail?.focuses.find(
    (focus) => focus.meaningFocusId === selectedFocusId,
  ) ?? null;
  const pageStateKey = selectedFocus?.alignment
    ? `complete:${selectedFocus.alignment.personalMeaningAlignmentId}`
    : selectedFocus
      ? `focus:${selectedFocus.meaningFocusId}`
      : 'overview';

  useEffect(() => {
    screenRef.current?.scrollTo({ top: 0 });
  }, [pageStateKey]);

  const exitToWorld = useCallback(() => {
    setSelectedFocusId(null);
    setConfirmingFocusId(null);
    onBack();
  }, [onBack]);

  const createAndOpenFocus = useCallback(
    async (
      input: Omit<CreateMeaningFocusInput, 'operationId' | 'personalMeaningId'>,
    ): Promise<boolean> => {
      setBusy(true);
      try {
        const result = await gateway.createMeaningFocus({
          operationId: opId(),
          personalMeaningId: currentMeaningId,
          ...input,
        });
        setSelectedFocusId(result.meaningFocusId);
        toast('已建立待确认 Focus；现在只处理这个方向');
        return true;
      } catch (error) {
        toast(error instanceof Error ? error.message : '无法建立 Meaning Focus');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [currentMeaningId, gateway, toast],
  );

  const handleConfirmSense = useCallback(
    async (focus: JourneyFocusView) => {
      if (!focus.proposal) return;
      setBusy(true);
      try {
        const result = await gateway.confirmSense({
          operationId: opId(),
          personalMeaningId: currentMeaningId,
          meaningFocusId: focus.meaningFocusId,
          senseProposalVersionId: focus.proposal.senseProposalVersionId,
        });
        setConfirmingFocusId(null);
        toast(
          result.resolution === 'reuse_existing'
            ? `已确认，并复用已存在的 Sense（${result.senseId.split('-')[0].toUpperCase()}）`
            : `已确认，建立了新的 Sense（${result.senseId.split('-')[0].toUpperCase()}）`,
        );
      } catch (error) {
        toast(error instanceof Error ? error.message : '确认失败');
      } finally {
        setBusy(false);
      }
    },
    [gateway, currentMeaningId, toast],
  );

  const renderError = () => (
    <div className="pmj-error" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <b>{status.errorKind === 'unavailable' ? '本机存储不可用' : '本机数据无法读取'}</b>
        <p>{status.error}</p>
      </div>
      <button type="button" onClick={() => gateway.reload()}>重新读取</button>
    </div>
  );

  const renderAnchorRow = (anchor: JourneyAnchorView) => {
    const isEditing = editingAnchorId === anchor.anchorId;
    return (
      <li key={anchor.anchorId} className="pmj-anchor-row">
        {isEditing ? (
          <>
            <input
              value={anchorDraft}
              onChange={(event) => setAnchorDraft(event.target.value)}
              aria-label="编辑锚点内容"
            />
            <button
              type="button"
              disabled={busy || !anchorDraft.trim()}
              onClick={() =>
                run(
                  () =>
                    gateway.editAnchor({
                      operationId: opId(),
                      personalMeaningId: currentMeaningId,
                      anchorId: anchor.anchorId,
                      kind: anchor.kind,
                      surfaceForm: anchorDraft.trim(),
                      ...(anchor.kind === 'familiar_expression'
                        ? { expressionType: anchor.expressionType }
                        : {}),
                    }),
                  '锚点已更新（身份不变）',
                ).then((succeeded) => {
                  if (succeeded) setEditingAnchorId(null);
                })
              }
            >
              保存
            </button>
            <button type="button" onClick={() => setEditingAnchorId(null)}>取消</button>
          </>
        ) : (
          <>
            <span className="pmj-anchor-body">
              <b>{anchor.surfaceForm}</b>
              <small>
                {anchor.kind === 'familiar_expression' ? anchor.expressionType : '经验'}
                {anchor.revision > 1 ? ` · v${anchor.revision}` : ''}
              </small>
            </span>
            <button
              type="button"
              onClick={() => {
                setEditingAnchorId(anchor.anchorId);
                setAnchorDraft(anchor.surfaceForm);
              }}
            >
              编辑
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    gateway.removeAnchor({
                      operationId: opId(),
                      personalMeaningId: currentMeaningId,
                      anchorId: anchor.anchorId,
                      kind: anchor.kind,
                    }),
                  '锚点已移除',
                )
              }
            >
              移除
            </button>
          </>
        )}
      </li>
    );
  };

  const renderConstruction = (focus: JourneyFocusView, construction: JourneyConstructionView) => {
    const draft = answers[focus.meaningFocusId] ?? '';
    const setDraft = (value: string) =>
      setAnswers((prev) => ({ ...prev, [focus.meaningFocusId]: value }));
    return (
      <div className="pmj-construction">
        <div className="pmj-turns">
          {construction.turns.map((turn) => (
            <div key={turn.turnId} className={`pmj-turn actor-${turn.actor}`}>
              <small>{ACTOR_LABEL[turn.actor]}</small>
              <p>{turn.body}</p>
            </div>
          ))}
        </div>

        {construction.status === 'paused' ? (
          <div className="pmj-actions">
            <span className="pmj-muted">这段澄清已暂停。</span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  gateway.resumeConstruction({
                    operationId: opId(),
                    personalMeaningId: currentMeaningId,
                    meaningFocusId: focus.meaningFocusId,
                  }),
                )
              }
            >
              继续澄清
            </button>
          </div>
        ) : construction.awaitingLearnerAnswer ? (
          <div className="pmj-answer">
            {construction.boundaryOptions.length > 0 && (
              <div className="pmj-chips" role="group" aria-label="边界选项">
                {construction.boundaryOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="pmj-chip"
                    onClick={() => setDraft(draft ? `${draft}；${option}` : option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="用自己的话回答这个边界问题…"
              rows={2}
            />
            <div className="pmj-actions">
              <button
                type="button"
                disabled={busy || !draft.trim()}
                onClick={() =>
                  run(
                    () =>
                      gateway.answerConstruction({
                        operationId: opId(),
                        personalMeaningId: currentMeaningId,
                        meaningFocusId: focus.meaningFocusId,
                        answer: draft.trim(),
                      }),
                  ).then((succeeded) => {
                    if (succeeded) setDraft('');
                  })
                }
              >
                回答
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    gateway.pauseConstruction({
                      operationId: opId(),
                      personalMeaningId: currentMeaningId,
                      meaningFocusId: focus.meaningFocusId,
                    }),
                  )
                }
              >
                暂停
              </button>
            </div>
          </div>
        ) : construction.readyForProposal ? (
          <div className="pmj-actions">
            <button
              type="button"
              className="pmj-primary"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    gateway.generateProposal({
                      operationId: opId(),
                      personalMeaningId: currentMeaningId,
                      meaningFocusId: focus.meaningFocusId,
                    }),
                  '语义助手已生成一个 Sense 提议',
                )
              }
            >
              生成 Sense 提议
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  gateway.continueClarifying({
                    operationId: opId(),
                    personalMeaningId: currentMeaningId,
                    meaningFocusId: focus.meaningFocusId,
                  }),
                )
              }
            >
              再澄清一轮
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const renderProposal = (focus: JourneyFocusView, proposal: JourneyProposalView) => (
    <div className="pmj-proposal">
      <header className="pmj-proposal-head">
        <span className="pmj-tag">Sense 提议 · v{proposal.version}</span>
        <small>
          {proposal.generator.provider}/{proposal.generator.model} · {proposal.semanticPolicyVersion}
        </small>
      </header>
      <h4>{proposal.coreMeaningFocus}</h4>

      {proposal.prototypeScenes.length > 0 && (
        <section className="pmj-block">
          <small>原型场景</small>
          <ul>
            {proposal.prototypeScenes.map((scene, index) => (
              <li key={index}>
                <b>{scene.summary}</b>
                {scene.participantRoles.length > 0 && (
                  <em> · {scene.participantRoles.join(' / ')}</em>
                )}
                {scene.directionOrCausality && <small> · {scene.directionOrCausality}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="pmj-cases">
        {proposal.includedCases.length > 0 && (
          <section className="pmj-block include">
            <small>包含</small>
            <ul>{proposal.includedCases.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        )}
        {proposal.excludedCases.length > 0 && (
          <section className="pmj-block exclude">
            <small>排除</small>
            <ul>{proposal.excludedCases.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        )}
      </div>

      {proposal.neighborContrasts.length > 0 && (
        <section className="pmj-block">
          <small>与相邻意义的区别</small>
          <ul>
            {proposal.neighborContrasts.map((contrast) => (
              <li key={contrast.label}>
                <b>{contrast.label}</b>：{contrast.distinction}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(proposal.openQuestions.length > 0 || proposal.unresolvedQuestions.length > 0) && (
        <section className="pmj-block">
          <small>仍待确认</small>
          <ul>
            {[...proposal.openQuestions, ...proposal.unresolvedQuestions].map((q, index) => (
              <li key={`${index}-${q}`}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      {proposal.expressionCandidates.length > 0 && (
        <section className="pmj-block">
          <small>候选目标表达（仅建议，确认 Sense 不会绑定它们）</small>
          <ul className="pmj-candidates-preview">
            {proposal.expressionCandidates.map((candidate) => (
              <li key={candidate.candidateId}>
                <b>{candidate.surfaceForm}</b>
                <small>{candidate.expressionType} · {candidate.languageTag}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {confirmingFocusId === focus.meaningFocusId ? (
        <div className="pmj-confirm-gate" role="group" aria-label="确认这个 Sense">
          <p>
            确认后会建立一个<strong>稳定的 Sense</strong> 和一个<strong>不可变的初始版本</strong>，
            并把它与这条个人意义对齐。这只是“我认这个意思”，<strong>不等于加入学习</strong>。
          </p>
          <div className="pmj-actions">
            <button
              type="button"
              className="pmj-primary"
              disabled={busy}
              onClick={() => handleConfirmSense(focus)}
            >
              就是这个意思，确认并完成
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirmingFocusId(null)}>
              再想想
            </button>
          </div>
        </div>
      ) : (
        <div className="pmj-actions">
          <button
            type="button"
            className="pmj-primary"
            disabled={busy}
            onClick={() => setConfirmingFocusId(focus.meaningFocusId)}
          >
            就是这个意思
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  gateway.continueClarifying({
                    operationId: opId(),
                    personalMeaningId: currentMeaningId,
                    meaningFocusId: focus.meaningFocusId,
                  }),
                '已回到澄清，可以继续细化边界',
              )
            }
          >
            继续澄清
          </button>
          <button
            type="button"
            className="pmj-danger"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  gateway.rejectProposal({
                    operationId: opId(),
                    personalMeaningId: currentMeaningId,
                    meaningFocusId: focus.meaningFocusId,
                  }),
                '已拒绝这个提议，没有建立任何 Sense',
              )
            }
          >
            拒绝
          </button>
        </div>
      )}
    </div>
  );

  const renderFocus = (focus: JourneyFocusView) => (
    <article className={`pmj-focus phase-${focus.phase}`} key={focus.meaningFocusId}>
      <header className="pmj-focus-head">
        <span className="pmj-phase-pill">{PHASE_LABELS[focus.phase]}</span>
        {focus.aspectLabel && <span className="pmj-aspect">{focus.aspectLabel}</span>}
        {focus.splitFromMeaningFocusId && <small className="pmj-muted">（拆分而来）</small>}
      </header>

      {editingFocusId === focus.meaningFocusId ? (
        <div className="pmj-focus-edit">
          <textarea
            value={editStatement}
            onChange={(event) => setEditStatement(event.target.value)}
            rows={2}
            aria-label="编辑 Focus 陈述"
          />
          <div className="pmj-actions">
            <button
              type="button"
              disabled={busy || !editStatement.trim()}
              onClick={() =>
                run(
                  () =>
                    gateway.editMeaningFocus({
                      operationId: opId(),
                      personalMeaningId: currentMeaningId,
                      meaningFocusId: focus.meaningFocusId,
                      statement: editStatement.trim(),
                      distinguishingNotes: focus.distinguishingNotes,
                    }),
                  'Focus 已更新',
                ).then((succeeded) => {
                  if (succeeded) setEditingFocusId(null);
                })
              }
            >
              保存
            </button>
            <button type="button" onClick={() => setEditingFocusId(null)}>取消</button>
          </div>
        </div>
      ) : (
        <h3 className="pmj-focus-statement">{focus.statement}</h3>
      )}

      {focus.distinguishingNotes.length > 0 && (
        <ul className="pmj-notes">
          {focus.distinguishingNotes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}

      {(focus.phase === 'focus_pending_acceptance' || focus.phase === 'focus_accepted') && (
        <div className="pmj-actions">
          {focus.phase === 'focus_pending_acceptance' ? (
            <button
              type="button"
              className="pmj-primary"
              disabled={busy}
              onClick={() =>
                run(
                  async () => {
                    await gateway.acceptMeaningFocusRevision({
                      operationId: opId(),
                      personalMeaningId: currentMeaningId,
                      meaningFocusId: focus.meaningFocusId,
                      meaningFocusRevisionId: focus.currentRevisionId,
                    });
                  },
                  '已接受当前 Focus，可开始澄清',
                )
              }
            >
              接受当前 Focus
            </button>
          ) : (
            <button
              type="button"
              className="pmj-primary"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    gateway.startConstruction({
                      operationId: opId(),
                      personalMeaningId: currentMeaningId,
                      meaningFocusId: focus.meaningFocusId,
                      meaningFocusRevisionId: focus.currentRevisionId,
                    }),
                  '已开始 Sense Construction',
                )
              }
            >
              开始澄清（Sense Construction）
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditingFocusId(focus.meaningFocusId);
              setEditStatement(focus.statement);
            }}
          >
            编辑 Focus
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSplitFor(focus.meaningFocusId);
              setSplitStatement('');
            }}
          >
            拆分出另一个 Focus
          </button>
        </div>
      )}

      {splitFor === focus.meaningFocusId && (
        <div className="pmj-split">
          <textarea
            value={splitStatement}
            onChange={(event) => setSplitStatement(event.target.value)}
            placeholder="写出要拆分出来的另一个侧面（复用同一条个人意义与锚点）…"
            rows={2}
          />
          <div className="pmj-actions">
            <button
              type="button"
              disabled={busy || !splitStatement.trim()}
              onClick={() =>
                run(
                  () =>
                    gateway.splitMeaningFocus({
                      operationId: opId(),
                      personalMeaningId: currentMeaningId,
                      meaningFocusId: focus.meaningFocusId,
                      statement: splitStatement.trim(),
                      distinguishingNotes: [],
                    }),
                  '已拆分出一个新的 Focus',
                ).then((succeeded) => {
                  if (succeeded) setSplitFor(null);
                })
              }
            >
              确认拆分
            </button>
            <button type="button" onClick={() => setSplitFor(null)}>取消</button>
          </div>
        </div>
      )}

      {/* constructing */}
      {focus.phase === 'constructing' && focus.construction &&
        renderConstruction(focus, focus.construction)}

      {/* proposal_ready */}
      {focus.phase === 'proposal_ready' && focus.proposal &&
        renderProposal(focus, focus.proposal)}

    </article>
  );

  const focusStageIndex = (focus: JourneyFocusView): number => {
    if (focus.alignment) return 3;
    if (focus.phase === 'proposal_ready') return 2;
    if (focus.phase === 'constructing' || focus.phase === 'focus_accepted') return 1;
    return 0;
  };

  const renderJourneyProgress = (focus: JourneyFocusView) => {
    const currentStage = focusStageIndex(focus);
    const steps = ['确认 Focus', '澄清边界', '确认提议', '完成'];
    return (
      <ol className="pmj-journey-progress" aria-label="从 Meaning Focus 到已确认 Sense 的进度">
        {steps.map((step, index) => (
          <li
            key={step}
            className={index < currentStage ? 'is-complete' : index === currentStage ? 'is-current' : ''}
            aria-current={index === currentStage ? 'step' : undefined}
          >
            <span>{index < currentStage ? '✓' : index + 1}</span>
            <small>{step}</small>
          </li>
        ))}
      </ol>
    );
  };

  const renderFocusOverview = (focus: JourneyFocusView) => {
    const phaseLabel = focus.alignment ? 'Sense 已确认' : PHASE_LABELS[focus.phase];
    const nextAction = focus.alignment
      ? '查看确认结果'
      : focus.phase === 'proposal_ready'
        ? '查看并确认 Sense 提议'
        : focus.phase === 'constructing'
          ? '继续本次澄清'
          : focus.phase === 'focus_accepted'
            ? '开始 Sense 澄清'
            : '查看并确认这个 Focus';
    const statusCopy = focus.alignment
      ? '这个 Focus 已经连接到一个稳定 Sense；本次确认旅程已经结束。'
      : focus.phase === 'proposal_ready'
        ? '完整 Sense 提议已经准备好，等待你的明确决定。'
        : focus.phase === 'constructing'
          ? '语义访谈正在澄清这个方向的包含、排除与相邻边界。'
          : '先确认这确实是你想保留的意义侧面，再开始 Sense Construction。';
    return (
      <article className={`pmj-focus-overview phase-${focus.phase}`} key={focus.meaningFocusId}>
        <header>
          <span className={`pmj-focus-status${focus.alignment ? ' is-confirmed' : ''}`}>
            {phaseLabel}
          </span>
          {focus.aspectLabel && <span className="pmj-aspect">{focus.aspectLabel}</span>}
        </header>
        <h3>{focus.statement}</h3>
        <p>{statusCopy}</p>
        <button
          type="button"
          onClick={() => {
            if (focus.alignment) {
              onOpenConfirmedSense(currentMeaningId, focus.meaningFocusId);
              return;
            }
            setSelectedFocusId(focus.meaningFocusId);
          }}
        >
          {nextAction}<span aria-hidden="true">→</span>
        </button>
      </article>
    );
  };

  const renderCompletion = (focus: JourneyFocusView) => {
    const alignment = focus.alignment;
    if (!alignment) return null;
    return (
      <div className="pmj-completion" role="status">
        <section className="pmj-completion-hero">
          <span className="pmj-completion-mark" aria-hidden="true">✓</span>
          <small>THIS FOCUS IS COMPLETE</small>
          <h2>这个意思已经确认</h2>
          <p>
            你已经为当前 Meaning Focus 建立了稳定 Sense 和 Personal Meaning Alignment。
            这就是本次旅程的终点，不需要继续确认表达才能离开。
          </p>
        </section>

        {renderJourneyProgress(focus)}

        <section className="pmj-completion-facts" aria-label="本次确认建立的事实">
          <span className="pmj-tag ok">Personal Meaning Alignment · 已确认</span>
          <div>
            <small>Meaning Focus</small>
            <strong>{focus.statement}</strong>
          </div>
          <div>
            <small>Stable Sense</small>
            <strong>{alignment.coreMeaningFocus || alignment.senseShortId}</strong>
            <p>
              Sense {alignment.senseShortId} · {alignment.senseVersionNumber === null
                ? `Version identity ${alignment.senseVersionId}`
                : `Version v${alignment.senseVersionNumber}`}
            </p>
          </div>
        </section>

        <section className="pmj-next-journeys">
          <small>后续是独立旅程</small>
          <h3>表达绑定与加入学习都没有自动发生</h3>
          <p>
            你可以先回到我的词义世界。Expression Binding、内容准备和加入学习会在各自入口中单独确认。
          </p>
          {alignment.confirmedBindings.length > 0 && (
            <p className="pmj-existing-bindings">
              当前已有 {alignment.confirmedBindings.length} 条已确认表达绑定；它们只是读取已有事实。
            </p>
          )}
        </section>

        <div className="pmj-actions pmj-completion-actions">
          <button type="button" className="pmj-primary" onClick={exitToWorld}>
            完成并返回我的词义世界
          </button>
          <button
            type="button"
            onClick={() => onOpenConfirmedSense(currentMeaningId, focus.meaningFocusId)}
          >
            查看已确认 Sense
          </button>
          <button type="button" onClick={() => setSelectedFocusId(null)}>
            返回 Personal Meaning 详情
          </button>
        </div>
      </div>
    );
  };

  const renderFocusWorkspace = (focus: JourneyFocusView) => (
    <div className="pmj-workspace">
      <section className="pmj-workspace-context">
        <small>当前只处理一个 Meaning Focus</small>
        <h2>{focus.statement}</h2>
        <p>确认这个 Focus 对应的 Sense 后，本次旅程结束；其他 Focus 保持独立。</p>
      </section>
      {renderJourneyProgress(focus)}
      {renderFocus(focus)}
      <section className="pmj-exit-panel">
        <div>
          <b>现在也可以结束</b>
          <p>当前事实已经保存；离开不会确认 Proposal，也不会丢失已完成的澄清。</p>
        </div>
        <div className="pmj-actions">
          <button type="button" onClick={exitToWorld}>保存并返回我的词义世界</button>
          <button type="button" onClick={() => setSelectedFocusId(null)}>返回 Meaning 详情</button>
        </div>
      </section>
    </div>
  );

  return (
    <section
      ref={screenRef}
      className={`screen sensa-semantic-world${active ? ' active' : ''}`}
      id="s-personal-meaning"
      data-anim="slide"
    >
      <header className="content-nav sensa-semantic-nav">
        <button
          className="content-nav-back"
          onClick={() => selectedFocus ? setSelectedFocusId(null) : exitToWorld()}
          aria-label={selectedFocus ? '返回 Personal Meaning 详情' : '返回我的词义世界'}
        >
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{selectedFocus?.alignment ? '确认完成' : selectedFocus ? '澄清一个 Focus' : '个人意义详情'}</h1>
        <button type="button" className="pmj-nav-exit" onClick={exitToWorld}>
          返回世界
        </button>
      </header>

      <div className="content-page-body pmj-body">
        {!status.ok && renderError()}

        {!detail ? (
          status.ok && (
            <div className="pmj-empty">
              <p>没有找到这条个人意义，可能已被移除。</p>
            </div>
          )
        ) : selectedFocus ? (
          selectedFocus.alignment
            ? renderCompletion(selectedFocus)
            : renderFocusWorkspace(selectedFocus)
        ) : (
          <>
            <section className="pmj-summary">
              <MeaningStatusAxes detail={detail} />
              <h2>{detail.displayLabel ?? '我的个人意义'}</h2>
              <p className="pmj-muted">
                这里是这条 Personal Meaning 的详情。每个 Meaning Focus 都有自己的 Sense 确认旅程；
                你可以一次只处理一个，也可以随时保存并返回世界。
              </p>

              <div className="pmj-anchors">
                <button
                  type="button"
                  className="pmj-anchors-toggle"
                  onClick={() => setAnchorsOpen((value) => !value)}
                  aria-expanded={anchorsOpen}
                >
                  <span>
                    锚点：熟悉表达 {detail.familiarAnchors.length} · 经验 {detail.experienceAnchors.length}
                  </span>
                  <i aria-hidden="true">{anchorsOpen ? '收起' : '展开/编辑'}</i>
                </button>

                {anchorsOpen && (
                  <div className="pmj-anchors-body">
                    <div className="pmj-anchor-group">
                      <small>熟悉语言表达</small>
                      <ul>{detail.familiarAnchors.map(renderAnchorRow)}</ul>
                      <div className="pmj-anchor-add">
                        <input
                          value={newFamiliar}
                          onChange={(event) => setNewFamiliar(event.target.value)}
                          placeholder="添加一个熟悉表达…"
                          aria-label="添加熟悉表达"
                        />
                        <button
                          type="button"
                          disabled={busy || !newFamiliar.trim()}
                          onClick={() =>
                            run(
                              () =>
                                gateway.addAnchor({
                                  operationId: opId(),
                                  personalMeaningId: currentMeaningId,
                                  kind: 'familiar_expression',
                                  surfaceForm: newFamiliar.trim(),
                                  expressionType: 'phrase',
                                }),
                              '已添加熟悉表达锚点',
                            ).then((succeeded) => {
                              if (succeeded) setNewFamiliar('');
                            })
                          }
                        >
                          添加
                        </button>
                      </div>
                    </div>

                    <div className="pmj-anchor-group">
                      <small>具体经验</small>
                      <ul>{detail.experienceAnchors.map(renderAnchorRow)}</ul>
                      <div className="pmj-anchor-add">
                        <input
                          value={newExperience}
                          onChange={(event) => setNewExperience(event.target.value)}
                          placeholder="添加一段具体经验…"
                          aria-label="添加具体经验"
                        />
                        <button
                          type="button"
                          disabled={busy || !newExperience.trim()}
                          onClick={() =>
                            run(
                              () =>
                                gateway.addAnchor({
                                  operationId: opId(),
                                  personalMeaningId: currentMeaningId,
                                  kind: 'experience',
                                  surfaceForm: newExperience.trim(),
                                }),
                              '已添加经验锚点',
                            ).then((succeeded) => {
                              if (succeeded) setNewExperience('');
                            })
                          }
                        >
                          添加
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Meaning Focus suggestions / acceptance */}
            {detail.focuses.length === 0 && detail.focusSuggestions.length === 0 && (
              <section className="pmj-suggest">
                <p className="pmj-muted">
                  还没有 Meaning Focus。让语义助手根据你的经验与熟悉表达，建议一到多个可澄清的意义侧面。
                </p>
                <button
                  type="button"
                  className="pmj-primary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => gateway.generateFocusSuggestions({
                        operationId: opId(),
                        personalMeaningId: currentMeaningId,
                      }),
                      '语义助手已给出 Meaning Focus 建议',
                    )
                  }
                >
                  让语义助手建议 Meaning Focus
                </button>
              </section>
            )}

            {(detail.focusSuggestions.length > 0 || detail.focuses.length === 0) && (
              <section className="pmj-suggest">
                <header className="pmj-section-head">
                  <b>Meaning Focus 建议（仅建议）</b>
                  {detail.focusSuggestionsAreMultipleAspects && (
                    <small>这些是不同的侧面，可以分别加入为待确认 Focus。</small>
                  )}
                </header>
                <ul className="pmj-suggestions">
                  {detail.focusSuggestions.map((suggestion) => (
                    <li key={suggestion.suggestionId}>
                      <div className="pmj-suggestion-body">
                        {suggestion.aspectLabel && (
                          <span className="pmj-aspect">{suggestion.aspectLabel}</span>
                        )}
                        <b>{suggestion.statement}</b>
                        {suggestion.distinguishingNotes.length > 0 && (
                          <ul className="pmj-notes">
                            {suggestion.distinguishingNotes.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => createAndOpenFocus({
                          suggestionId: suggestion.suggestionId,
                        })}
                      >
                        选择这个 Focus
                      </button>
                    </li>
                  ))}
                </ul>

                {customFocusOpen ? (
                  <div className="pmj-custom-focus">
                    <textarea
                      value={customStatement}
                      onChange={(event) => setCustomStatement(event.target.value)}
                      placeholder="用自己的话写下这个意义侧面…"
                      rows={2}
                    />
                    <input
                      value={customNotes}
                      onChange={(event) => setCustomNotes(event.target.value)}
                      placeholder="区分性说明（可选，用「；」分隔）"
                      aria-label="区分性说明"
                    />
                    <div className="pmj-actions">
                      <button
                        type="button"
                        className="pmj-primary"
                        disabled={busy || !customStatement.trim()}
                        onClick={() =>
                          createAndOpenFocus({
                            statement: customStatement.trim(),
                            distinguishingNotes: customNotes
                              .split(/[;；]/)
                              .map((note) => note.trim())
                              .filter(Boolean),
                          }).then((succeeded) => {
                            if (succeeded) {
                              setCustomFocusOpen(false);
                              setCustomStatement('');
                              setCustomNotes('');
                            }
                          })
                        }
                      >
                        建立并进入这个 Focus
                      </button>
                      <button type="button" onClick={() => setCustomFocusOpen(false)}>取消</button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="pmj-link"
                    onClick={() => setCustomFocusOpen(true)}
                  >
                    自己写一个 Focus →
                  </button>
                )}
              </section>
            )}

            {/* Meaning Focus facts are journey entry points, not nested long forms. */}
            {detail.focuses.length > 0 && (
              <section className="pmj-focuses">
                <header className="pmj-section-head">
                  <b>选择一个 Meaning Focus</b>
                  <small>{detail.focuses.length} 个独立方向</small>
                </header>
                {detail.focuses.map(renderFocusOverview)}
              </section>
            )}

            <button type="button" className="pmj-overview-exit" onClick={exitToWorld}>
              <span><b>暂时结束</b><small>所有已完成的步骤都已保存</small></span>
              <span>返回我的词义世界 →</span>
            </button>

            <p className="pmj-footnote">
              语义助手只“提议”。确认一个 Focus 的 Sense 后，本次旅程即结束；表达绑定、内容准备和
              加入学习仍是后续独立动作。刷新或暂时离开不会丢失已保存事实。
            </p>
          </>
        )}
      </div>
    </section>
  );
};

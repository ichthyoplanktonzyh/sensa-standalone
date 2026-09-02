/**
 * The AI clarification workspace.
 *
 * One conversation, one result panel, one confirmation. The conversation is the
 * main surface; the panel beside it accumulates what the two of you worked out
 * — it is a basket, not a progress bar, and it never shows "已确认" while the
 * thread is still open.
 *
 * Two things are deliberately kept apart:
 *  - 「就聊这个」 locks the Focus so the model stops exploring. It writes no
 *    domain fact and is freely reversible.
 *  - 「就确认成这样」 opens the review layer, and the learner's confirm there is
 *    the single intent that writes Focus acceptance, Sense confirmation and
 *    (optionally) the Expression Binding.
 *
 * Confirming does not navigate away. Stopping at "已确认 2 / 3" is a supported
 * resting state, and the conversation stays open so the last fact can be
 * settled in the same place it was discussed.
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, type FormEvent,
} from 'react';
import {
  useJourneyDetail,
  useJourneyGateway,
  type JourneyDetailView,
  type JourneyFocusView,
} from '../personalMeaningJourney';
import { newUuid } from '../personalMeaningJourney/ids';
import { createRealSemanticAgent } from '../personalMeaningJourney/realSemanticAgent';
import {
  loadSemanticAgentSession,
  newSemanticAgentSession,
  saveSemanticAgentSession,
} from '../personalMeaningJourney/semanticAgentSession';
import { getMedia, storeImageFile } from '../personalMeaningJourney/mediaStore';
import type {
  AgentExpressionCandidate,
  AgentFocusCandidate,
  AgentSenseCandidate,
  SemanticAgentMaterial,
  SemanticAgentMessage,
  SemanticAgentSession,
  WorkingSetTrack,
} from '../personalMeaningJourney/semanticAgent';
import type {
  SensaExpressionBindingRelation,
  SensaExpressionType,
  SensaSemanticCoverage,
} from '@sensa/contracts/sensa';

interface PersonalMeaningDetailScreenProps {
  active: boolean;
  personalMeaningId: string | null;
  onBack: () => void;
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
  toast: (message: string) => void;
}

const semanticAgent = createRealSemanticAgent();
const SEMANTIC_POLICY_VERSION = 'sensa-semantic-policy-agent-loop-v1';

const expressionTypeLabels: Record<SensaExpressionType, string> = {
  word: '单词',
  phrase: '短语',
  construction: '构式',
  sentence: '完整句子',
  utterance_strategy: '表达方式',
};

const relationLabels: Record<SensaExpressionBindingRelation, string> = {
  realizes: '实现这个意思',
  approximates: '接近这个意思',
  evokes: '唤起这个意思',
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  exact: '范围相符',
  broader: '范围更宽',
  narrower: '范围更窄',
  overlapping: '部分重叠',
};

const message = (
  role: SemanticAgentMessage['role'],
  body: string,
): SemanticAgentMessage => ({
  messageId: newUuid(),
  role,
  body,
  occurredAt: new Date().toISOString(),
});

const materialFor = (detail: JourneyDetailView): SemanticAgentMaterial => ({
  blocks: detail.materialBlocks.map((block) => {
    const media = block.personalMediaObjectId
      ? getMedia(block.personalMediaObjectId)
      : null;
    return {
      blockId: block.anchorId,
      kind: block.kind,
      bodyText: block.bodyText,
      mediaDataUrl: media?.dataUrl ?? null,
      mediaMimeType: media?.mimeType ?? null,
    };
  }),
  familiarExpression: detail.familiarAnchors[0]?.surfaceForm ?? null,
  startingPoint: detail.startingPoint,
});

const lines = (value: string): string[] =>
  value.split('\n').map((line) => line.trim()).filter(Boolean);

type TrackTone = 'idle' | 'candidate' | 'confirmed';

const trackTone = (hasCandidate: boolean, confirmed: boolean): {
  tone: TrackTone;
  label: string;
} => {
  if (confirmed) return { tone: 'confirmed', label: '已确认' };
  return hasCandidate
    ? { tone: 'candidate', label: '有候选' }
    : { tone: 'idle', label: '还在聊' };
};

// -- editable cards ---------------------------------------------------------

const FocusCard = ({
  focus,
  locked,
  editing,
  onEdit,
  onChange,
  onDone,
  onToggleLock,
  disabled,
}: {
  focus: AgentFocusCandidate;
  locked: boolean;
  editing: boolean;
  onEdit: () => void;
  onChange: (next: AgentFocusCandidate) => void;
  onDone: () => void;
  onToggleLock: () => void;
  disabled: boolean;
}) => (
  <article className="pmw-card">
    <header>
      <small>表达侧面</small>
      {!editing && <button type="button" onClick={onEdit}>改</button>}
    </header>
    {editing ? (
      <div className="pmw-edit">
        <textarea
          value={focus.statement}
          rows={2}
          onChange={(event) => onChange({ ...focus, statement: event.target.value })}
        />
        <label>
          <span>区分说明，一行一条</span>
          <textarea
            value={focus.distinguishingNotes.join('\n')}
            rows={3}
            onChange={(event) => onChange({
              ...focus,
              distinguishingNotes: lines(event.target.value),
            })}
          />
        </label>
        <button type="button" className="pmw-edit-done" onClick={onDone}>改好了</button>
      </div>
    ) : (
      <>
        <b>{focus.statement}</b>
        {focus.distinguishingNotes.length > 0 && (
          <ul>{focus.distinguishingNotes.map((note) => <li key={note}>{note}</li>)}</ul>
        )}
        <p className="pmw-why">{focus.rationale}</p>
        <button
          type="button"
          className={`pmw-lock${locked ? ' is-on' : ''}`}
          onClick={onToggleLock}
          disabled={disabled}
          aria-pressed={locked}
        >
          {locked ? '✓ 正在聊这个' : '就聊这个'}
        </button>
      </>
    )}
  </article>
);

const SenseCard = ({
  sense,
  editing,
  onEdit,
  onChange,
  onDone,
}: {
  sense: AgentSenseCandidate;
  editing: boolean;
  onEdit: () => void;
  onChange: (next: AgentSenseCandidate) => void;
  onDone: () => void;
}) => (
  <article className="pmw-card">
    <header>
      <small>稳定意思</small>
      {!editing && <button type="button" onClick={onEdit}>改</button>}
    </header>
    {editing ? (
      <div className="pmw-edit">
        <textarea
          value={sense.coreMeaningFocus}
          rows={3}
          onChange={(event) => onChange({ ...sense, coreMeaningFocus: event.target.value })}
        />
        <label>
          <span>包含哪些情况，一行一条</span>
          <textarea
            value={sense.includedCases.join('\n')}
            rows={3}
            onChange={(event) => onChange({ ...sense, includedCases: lines(event.target.value) })}
          />
        </label>
        <label>
          <span>不包含哪些情况，一行一条</span>
          <textarea
            value={sense.excludedCases.join('\n')}
            rows={3}
            onChange={(event) => onChange({ ...sense, excludedCases: lines(event.target.value) })}
          />
        </label>
        <button type="button" className="pmw-edit-done" onClick={onDone}>改好了</button>
      </div>
    ) : (
      <>
        <b>{sense.coreMeaningFocus}</b>
        {sense.prototypeScenes[0] && (
          <p className="pmw-scene">{sense.prototypeScenes[0].summary}</p>
        )}
        <div className="pmw-cases">
          {sense.includedCases.length > 0 && (
            <div className="is-include">
              <small>包含</small>
              <ul>{sense.includedCases.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
          {sense.excludedCases.length > 0 && (
            <div className="is-exclude">
              <small>不包含</small>
              <ul>{sense.excludedCases.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          )}
        </div>
        {sense.neighborContrasts.length > 0 && (
          <ul className="pmw-contrasts">
            {sense.neighborContrasts.map((contrast) => (
              <li key={contrast.label}><b>{contrast.label}</b><span>{contrast.distinction}</span></li>
            ))}
          </ul>
        )}
      </>
    )}
  </article>
);

const ExpressionCard = ({
  expression,
  editing,
  onEdit,
  onChange,
  onDone,
}: {
  expression: AgentExpressionCandidate;
  editing: boolean;
  onEdit: () => void;
  onChange: (next: AgentExpressionCandidate) => void;
  onDone: () => void;
}) => (
  <article className="pmw-card">
    <header>
      <small>目标表达</small>
      {!editing && <button type="button" onClick={onEdit}>改</button>}
    </header>
    {editing ? (
      <div className="pmw-edit">
        <input
          value={expression.surfaceForm}
          onChange={(event) => onChange({ ...expression, surfaceForm: event.target.value })}
        />
        <label>
          <span>它是什么</span>
          <select
            value={expression.expressionType}
            onChange={(event) => onChange({
              ...expression,
              expressionType: event.target.value as SensaExpressionType,
            })}
          >
            {(Object.keys(expressionTypeLabels) as SensaExpressionType[]).map((type) => (
              <option key={type} value={type}>{expressionTypeLabels[type]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>它和这个意思是什么关系</span>
          <select
            value={expression.relation}
            onChange={(event) => onChange({
              ...expression,
              relation: event.target.value as SensaExpressionBindingRelation,
            })}
          >
            {(Object.keys(relationLabels) as SensaExpressionBindingRelation[]).map((value) => (
              <option key={value} value={value}>{relationLabels[value]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>覆盖范围</span>
          <select
            value={expression.semanticCoverage}
            onChange={(event) => onChange({
              ...expression,
              semanticCoverage: event.target.value as SensaSemanticCoverage,
            })}
          >
            {(Object.keys(coverageLabels) as SensaSemanticCoverage[]).map((value) => (
              <option key={value} value={value}>{coverageLabels[value]}</option>
            ))}
          </select>
        </label>
        <button type="button" className="pmw-edit-done" onClick={onDone}>改好了</button>
      </div>
    ) : (
      <>
        <b className="pmw-surface">{expression.surfaceForm}</b>
        <p className="pmw-meta">
          {expressionTypeLabels[expression.expressionType]} ·{' '}
          {relationLabels[expression.relation]} · {coverageLabels[expression.semanticCoverage]}
        </p>
        <p className="pmw-why">{expression.rationale}</p>
      </>
    )}
  </article>
);

// -- screen -----------------------------------------------------------------

export const PersonalMeaningDetailScreen = ({
  active,
  personalMeaningId,
  onBack,
  onOpenConfirmedSense,
  toast,
}: PersonalMeaningDetailScreenProps) => {
  const gateway = useJourneyGateway();
  const { detail, status } = useJourneyDetail(personalMeaningId);
  const screenRef = useRef<HTMLElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const openedThread = useRef<string | null>(null);

  const [session, setSession] = useState<SemanticAgentSession | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [materialOpen, setMaterialOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [includeExpression, setIncludeExpression] = useState(true);
  const [editingTrack, setEditingTrack] = useState<WorkingSetTrack | null>(null);

  useEffect(() => {
    if (!personalMeaningId) {
      setSession(null);
      return;
    }
    setSession(loadSemanticAgentSession(personalMeaningId, newUuid));
    setPanelOpen(false);
    setReviewOpen(false);
    setEditingTrack(null);
    setError('');
  }, [personalMeaningId]);

  const commit = useCallback((next: SemanticAgentSession) => {
    saveSemanticAgentSession(next);
    setSession(next);
  }, []);

  useEffect(() => {
    if (active) screenRef.current?.scrollTo({ top: 0 });
  }, [active, personalMeaningId]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: session?.messages.length ? 'smooth' : 'auto',
    });
  }, [busy, session?.messages.length]);

  /** The Focus this thread confirmed, if it already did. */
  const confirmedFocus: JourneyFocusView | null = useMemo(() => {
    const focusId = session?.outcome?.meaningFocusId;
    if (!detail || !focusId) return null;
    return detail.focuses.find((focus) => focus.meaningFocusId === focusId) ?? null;
  }, [detail, session?.outcome?.meaningFocusId]);

  const alignment = confirmedFocus?.alignment ?? null;
  const boundExpression = alignment?.confirmedBindings[0] ?? null;
  const allConfirmed = Boolean(boundExpression);

  const runTurn = useCallback(async (
    baseSession: SemanticAgentSession,
    learnerBody?: string,
  ) => {
    if (!detail) return;
    const learnerMessage = learnerBody?.trim() ? message('learner', learnerBody.trim()) : null;
    const messages = learnerMessage
      ? [...baseSession.messages, learnerMessage]
      : [...baseSession.messages];
    const waiting = { ...baseSession, messages };
    commit(waiting);
    setBusy(true);
    setError('');
    try {
      const result = await semanticAgent.turn({
        material: materialFor(detail),
        messages,
        workingSet: baseSession.workingSet,
        learnerEditedTracks: baseSession.learnerEditedTracks,
        focusLocked: baseSession.focusLocked,
      });
      commit({
        ...waiting,
        messages: [...messages, message('assistant', result.assistantMessage)],
        workingSet: result.workingSet,
        readyToConfirm: result.readyToConfirm,
        provenance: result.provenance,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 暂时无法继续这轮对话。');
    } finally {
      setBusy(false);
    }
  }, [commit, detail]);

  // Open the thread by having the model read the material first, so the panel
  // is already partly filled when the learner arrives instead of starting empty.
  useEffect(() => {
    if (!active || !detail || !session) return;
    if (session.messages.length > 0 || openedThread.current === session.threadId) return;
    openedThread.current = session.threadId;
    void runTurn(session);
  }, [active, detail, runTurn, session]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || !draft.trim() || busy) return;
    const body = draft.trim();
    setDraft('');
    void runTurn(session, body);
  };

  const editTrack = <T,>(track: WorkingSetTrack, value: T) => {
    if (!session) return;
    commit({
      ...session,
      workingSet: { ...session.workingSet, [track]: value },
      learnerEditedTracks: session.learnerEditedTracks.includes(track)
        ? session.learnerEditedTracks
        : [...session.learnerEditedTracks, track],
    });
  };

  const toggleLock = () => {
    if (!session) return;
    commit({ ...session, focusLocked: !session.focusLocked });
  };

  const addImage = async (file: File | undefined) => {
    if (!file || !detail) return;
    setError('');
    try {
      const mediaId = newUuid();
      await storeImageFile(mediaId, file, new Date().toISOString());
      await gateway.addMaterialBlock({
        operationId: newUuid(),
        personalMeaningId: detail.personalMeaningId,
        block: { kind: 'image', personalMediaObjectId: mediaId },
      });
      toast('材料已补充，下一轮 AI 就能看到');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '这张图片暂时无法加入。');
    }
  };

  /** The one intent that writes facts. Three of them, or two, never a partial write. */
  const confirm = async () => {
    if (!detail || !session || busy) return;
    const { focus, sense, expression } = session.workingSet;
    if (!focus || !sense) return;
    setBusy(true);
    setError('');
    try {
      const result = await gateway.confirmClarification({
        operationId: newUuid(),
        personalMeaningId: detail.personalMeaningId,
        focus: {
          statement: focus.statement,
          distinguishingNotes: focus.distinguishingNotes,
          aspectLabel: focus.aspectLabel,
        },
        sense: {
          proposedSenseKey: sense.proposedSenseKey,
          coreMeaningFocus: sense.coreMeaningFocus,
          prototypeScenes: sense.prototypeScenes,
          includedCases: sense.includedCases,
          excludedCases: sense.excludedCases,
          neighborContrasts: sense.neighborContrasts,
          openQuestions: sense.openQuestions,
          unresolvedQuestions: sense.unresolvedQuestions,
        },
        expression: expression
          ? {
              surfaceForm: expression.surfaceForm,
              expressionType: expression.expressionType,
              languageTag: expression.languageTag,
              relation: expression.relation,
              semanticCoverage: expression.semanticCoverage,
            }
          : null,
        confirmExpression: Boolean(expression) && includeExpression,
        transcript: session.messages,
        provenance: session.provenance ?? {
          provider: 'unknown', model: 'unknown', promptVersion: 'unknown',
        },
        semanticPolicyVersion: SEMANTIC_POLICY_VERSION,
      });
      setReviewOpen(false);
      commit({
        ...session,
        outcome: {
          meaningFocusId: result.meaningFocusId,
          senseConfirmed: true,
          expressionConfirmed: result.expressionConfirmed,
          confirmedAt: new Date().toISOString(),
        },
      });
      toast(result.expressionConfirmed ? '三个事实都已确认' : '已确认 2 / 3，表达待确认');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法确认，请再试一次。');
    } finally {
      setBusy(false);
    }
  };

  /** Settle the last fact for a thread that already stopped at 已确认 2 / 3. */
  const confirmExpressionOnly = async () => {
    const expression = session?.workingSet.expression;
    const candidate = alignment?.expressionCandidates[0];
    if (!detail || !session || !confirmedFocus || !alignment || !expression || !candidate) return;
    setBusy(true);
    setError('');
    try {
      await gateway.confirmExpressionBinding({
        operationId: newUuid(),
        personalMeaningId: detail.personalMeaningId,
        meaningFocusId: confirmedFocus.meaningFocusId,
        senseVersionId: alignment.senseVersionId,
        candidateId: candidate.candidateId,
        languageTag: expression.languageTag,
        surfaceForm: expression.surfaceForm,
        expressionType: expression.expressionType,
        relation: expression.relation,
        semanticCoverage: expression.semanticCoverage,
      });
      commit({
        ...session,
        outcome: { ...session.outcome!, expressionConfirmed: true },
      });
      toast('目标表达已确认');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法确认这个表达。');
    } finally {
      setBusy(false);
    }
  };

  const startAnotherThread = () => {
    if (!detail) return;
    openedThread.current = null;
    setPanelOpen(false);
    setEditingTrack(null);
    setIncludeExpression(true);
    commit(newSemanticAgentSession(detail.personalMeaningId, newUuid()));
  };

  const working = session?.workingSet ?? { focus: null, sense: null, expression: null };
  const senseConfirmed = Boolean(alignment);
  const focusStatus = trackTone(Boolean(working.focus), senseConfirmed);
  const senseStatus = trackTone(Boolean(working.sense), senseConfirmed);
  const expressionStatus = trackTone(Boolean(working.expression), allConfirmed);
  const canConfirm = Boolean(working.focus && working.sense) && !busy;
  const canConfirmExpressionOnly = Boolean(
    working.expression && alignment?.expressionCandidates.length,
  ) && !busy;

  const body = !status.ok ? (
    <div className="pmw-error" role="alert">
      <b>语义材料无法读取</b>
      <p>{status.error}</p>
    </div>
  ) : !detail || !session ? (
    <div className="pmw-empty">没有找到这份语义材料。</div>
  ) : allConfirmed ? (
    <div className="pmw-done">
      <span className="pmw-done-mark" aria-hidden="true">✓</span>
      <h2>这条线聊完了</h2>
      <p>三个事实都已确认，它们已经进入你的词义世界。</p>
      <div className="pmw-done-facts">
        <article><small>表达侧面</small><b>{confirmedFocus?.statement}</b></article>
        <article><small>稳定意思</small><b>{alignment?.coreMeaningFocus}</b></article>
        <article>
          <small>目标表达</small>
          <b>{boundExpression?.surfaceForm}</b>
          <span>
            {expressionTypeLabels[boundExpression!.expressionType]} ·{' '}
            {relationLabels[boundExpression!.relation]} ·{' '}
            {coverageLabels[boundExpression!.semanticCoverage]}
          </span>
        </article>
      </div>
      <div className="pmw-done-actions">
        <button type="button" className="pmw-primary" onClick={startAnotherThread}>
          这段经历还有别的侧面
        </button>
        <button
          type="button"
          onClick={() => onOpenConfirmedSense(
            detail.personalMeaningId,
            confirmedFocus!.meaningFocusId,
          )}
        >
          查看完整语义结果
        </button>
        <button type="button" onClick={onBack}>回我的词义世界</button>
      </div>
    </div>
  ) : (
    <>
      {materialOpen && (
        <section className="pmw-material" aria-label="本轮语义材料">
          <p className="pmw-material-note">这段对话基于下面这份材料。可以补充，不能在这里改写。</p>
          {detail.materialBlocks.map((block) => (
            block.kind === 'image' ? (
              <img
                key={block.anchorId}
                src={getMedia(block.personalMediaObjectId ?? '')?.dataUrl ?? ''}
                alt="材料图片"
              />
            ) : (
              <p key={block.anchorId}>{block.bodyText}</p>
            )
          ))}
          {detail.familiarAnchors.map((anchor) => (
            <p key={anchor.anchorId} className="pmw-material-familiar">
              <small>中文说法</small>{anchor.surfaceForm}
            </p>
          ))}
          <button type="button" onClick={() => fileRef.current?.click()}>＋补一张图</button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              void addImage(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </section>
      )}

      <div className="pmw-transcript" ref={transcriptRef} aria-live="polite">
        {session.messages.map((item) => (
          <div key={item.messageId} className={`pmw-message is-${item.role}`}>
            {item.role === 'assistant' && (
              <span className="pmw-avatar" aria-hidden="true">✦</span>
            )}
            <div><p>{item.body}</p></div>
          </div>
        ))}
        {busy && (
          <div className="pmw-message is-assistant is-thinking">
            <span className="pmw-avatar" aria-hidden="true">✦</span>
            <div><p><i /><i /><i /></p></div>
          </div>
        )}
      </div>

      {error && (
        <div className="pmw-inline-error" role="alert">
          <span>{error}</span>
          <button type="button" disabled={busy} onClick={() => void runTurn(session)}>重试</button>
        </div>
      )}

      <section className={`pmw-panel${panelOpen ? ' is-open' : ''}`} aria-label="一起聊出来的三件事">
        <button
          type="button"
          className="pmw-panel-handle"
          onClick={() => setPanelOpen((value) => !value)}
          aria-expanded={panelOpen}
        >
          <span className={`pmw-chip is-${focusStatus.tone}`}>
            <small>侧面</small><b>{focusStatus.label}</b>
          </span>
          <span className={`pmw-chip is-${senseStatus.tone}`}>
            <small>意思</small><b>{senseStatus.label}</b>
          </span>
          <span className={`pmw-chip is-${expressionStatus.tone}`}>
            <small>表达</small><b>{expressionStatus.label}</b>
          </span>
          <span className="pmw-panel-caret" aria-hidden="true">{panelOpen ? '▾' : '▴'}</span>
        </button>

        {panelOpen && (
          <div className="pmw-panel-body">
            {senseConfirmed && (
              <p className="pmw-panel-note">
                侧面和意思已经确认过了，改不了。还差最后一个事实：目标表达。
              </p>
            )}
            {working.focus && !senseConfirmed && (
              <FocusCard
                focus={working.focus}
                locked={session.focusLocked}
                editing={editingTrack === 'focus'}
                onEdit={() => setEditingTrack('focus')}
                onDone={() => setEditingTrack(null)}
                onChange={(next) => editTrack('focus', next)}
                onToggleLock={toggleLock}
                disabled={busy}
              />
            )}
            {working.sense && !senseConfirmed && (
              <SenseCard
                sense={working.sense}
                editing={editingTrack === 'sense'}
                onEdit={() => setEditingTrack('sense')}
                onDone={() => setEditingTrack(null)}
                onChange={(next) => editTrack('sense', next)}
              />
            )}
            {working.expression && (
              <ExpressionCard
                expression={working.expression}
                editing={editingTrack === 'expression'}
                onEdit={() => setEditingTrack('expression')}
                onDone={() => setEditingTrack(null)}
                onChange={(next) => editTrack('expression', next)}
              />
            )}
            {!working.focus && !working.sense && !working.expression && (
              <p className="pmw-panel-empty">还没聊出什么。继续说说你的场景。</p>
            )}
          </div>
        )}

        {senseConfirmed ? (
          <div className="pmw-confirm-row">
            {alignment!.expressionCandidates.length === 0 ? (
              <p className="pmw-confirm-blocked">
                这次确认时还没有表达候选，没法在这条线上绑定。可以为这段经历开一条新的澄清线。
              </p>
            ) : (
              <button
                type="button"
                className="pmw-confirm is-ready"
                disabled={!canConfirmExpressionOnly}
                onClick={() => void confirmExpressionOnly()}
              >
                确认这个表达
              </button>
            )}
          </div>
        ) : (
          <div className="pmw-confirm-row">
            <button
              type="button"
              className={`pmw-confirm${session.readyToConfirm ? ' is-ready' : ''}`}
              disabled={!canConfirm}
              onClick={() => {
                setIncludeExpression(Boolean(working.expression));
                setReviewOpen(true);
              }}
            >
              就确认成这样
            </button>
          </div>
        )}
      </section>

      <form className="pmw-composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="继续说你的理解、例子或疑问…"
          rows={2}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="发送">
          <span aria-hidden="true">↑</span>
        </button>
      </form>

      {reviewOpen && working.focus && working.sense && (
        <div className="pmw-review-layer" onMouseDown={() => setReviewOpen(false)}>
          <section
            className="pmw-review"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pmw-review-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="pmw-review-title">你要确认这些</h2>
              <button type="button" onClick={() => setReviewOpen(false)} aria-label="继续聊">×</button>
            </header>

            <div className="pmw-review-body">
              <article className="pmw-review-card">
                <header><small>表达侧面</small><em>一起确认</em></header>
                <b>{working.focus.statement}</b>
                {working.focus.distinguishingNotes.length > 0 && (
                  <ul>
                    {working.focus.distinguishingNotes.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                )}
              </article>

              <article className="pmw-review-card">
                <header><small>稳定意思</small><em>一起确认</em></header>
                <b>{working.sense.coreMeaningFocus}</b>
                {working.sense.prototypeScenes[0] && (
                  <p>{working.sense.prototypeScenes[0].summary}</p>
                )}
              </article>

              <article className={`pmw-review-card${includeExpression ? '' : ' is-deferred'}`}>
                <header>
                  <small>目标表达</small>
                  {working.expression ? (
                    <label className="pmw-review-toggle">
                      <input
                        type="checkbox"
                        checked={includeExpression}
                        onChange={(event) => setIncludeExpression(event.target.checked)}
                      />
                      <span>一起确认</span>
                    </label>
                  ) : <em>暂无候选</em>}
                </header>
                {working.expression ? (
                  <>
                    <b className="pmw-surface">{working.expression.surfaceForm}</b>
                    <p>
                      {expressionTypeLabels[working.expression.expressionType]} ·{' '}
                      {relationLabels[working.expression.relation]} ·{' '}
                      {coverageLabels[working.expression.semanticCoverage]}
                    </p>
                  </>
                ) : (
                  <p>这次还没聊出合适的英语表达。确认前两个，之后可以接着聊。</p>
                )}
              </article>
            </div>

            <footer>
              <p className="pmw-review-consequence">
                确认后，这个意思会成为可复用的稳定语义
                {working.expression && includeExpression ? '，表达连接会记进你的词义世界' : ''}
                。{working.expression && includeExpression ? '' : '表达可以之后再确认。'}
              </p>
              {error && <p className="pmw-review-error" role="alert">{error}</p>}
              <div className="pmw-review-actions">
                <button
                  type="button"
                  className="pmw-primary"
                  disabled={busy}
                  onClick={() => void confirm()}
                >
                  {busy ? '正在确认…' : '确认'}
                </button>
                <button type="button" disabled={busy} onClick={() => setReviewOpen(false)}>
                  再聊聊
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );

  return (
    <section
      ref={screenRef}
      className={`screen pmw-screen${active ? ' active' : ''}`}
      id="s-personal-meaning"
      data-anim="slide"
    >
      <header className="content-nav pmw-nav">
        <button className="content-nav-back" onClick={onBack} aria-label="返回我的词义世界">
          <svg className="icon"><use href="#i-chev-l" /></svg>
        </button>
        <h1>AI 澄清</h1>
        <button
          type="button"
          className={`pmw-material-toggle${materialOpen ? ' is-open' : ''}`}
          onClick={() => setMaterialOpen((value) => !value)}
          aria-expanded={materialOpen}
        >
          材料
        </button>
      </header>
      <div className="pmw-shell">{body}</div>
    </section>
  );
};

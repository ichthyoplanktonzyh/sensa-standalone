/**
 * The AI clarification workspace.
 *
 * One conversation, one result panel, one confirmation. The conversation is the
 * main surface; the panel beside it accumulates what the two of you worked out
 * — it is a basket, not a progress bar, and it never shows "已确认" while the
 * thread is still open.
 *
 * The conversation runs as a simple loop: chat turns while the model listens
 * and asks, then「整理一下」— one consolidation the learner requests when the
 * model says it is ready — fills the panel, repeatable after corrections.
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
  SemanticAgentTurnMode,
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
  editing,
  onEdit,
  onChange,
  onDone,
}: {
  focus: AgentFocusCandidate;
  editing: boolean;
  onEdit: () => void;
  onChange: (next: AgentFocusCandidate) => void;
  onDone: () => void;
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
        <button type="button" className="pmw-edit-done" onClick={onDone}>改好了</button>
      </div>
    ) : (
      <>
        <b className="pmw-card-lead">{focus.statement}</b>
        {focus.distinguishingNotes.length > 0 && (
          <p className="pmw-card-note">{focus.distinguishingNotes[0]}</p>
        )}
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
          rows={2}
          onChange={(event) => onChange({ ...sense, coreMeaningFocus: event.target.value })}
        />
        <button type="button" className="pmw-edit-done" onClick={onDone}>改好了</button>
      </div>
    ) : (
      <>
        <b className="pmw-card-lead">{sense.coreMeaningFocus}</b>
        {sense.prototypeScenes[0] && (
          <p className="pmw-card-note">{sense.prototypeScenes[0].summary}</p>
        )}
      </>
    )}
  </article>
);

const ExpressionsCard = ({
  candidates,
  selected,
  onSelect,
  editing,
  onEdit,
  onChange,
  onDone,
}: {
  candidates: AgentExpressionCandidate[];
  selected: AgentExpressionCandidate | null;
  onSelect: (candidate: AgentExpressionCandidate) => void;
  editing: boolean;
  onEdit: () => void;
  onChange: (next: AgentExpressionCandidate) => void;
  onDone: () => void;
}) => {
  const active = selected ?? candidates[0] ?? null;
  if (!active && candidates.length === 0) return null;

  return (
    <article className="pmw-card">
      <header>
        <small>目标表达 {candidates.length > 1 ? `(${candidates.length} 个候选)` : ''}</small>
        {!editing && active && <button type="button" onClick={onEdit}>改</button>}
      </header>
      {editing && active ? (
        <div className="pmw-edit">
          <input
            value={active.surfaceForm}
            onChange={(event) => onChange({ ...active, surfaceForm: event.target.value })}
          />
          <button type="button" className="pmw-edit-done" onClick={onDone}>改好了</button>
        </div>
      ) : (
        <div className="pmw-expr-candidates">
          {candidates.map((cand) => {
            const isChosen = (selected?.surfaceForm ?? candidates[0]?.surfaceForm) === cand.surfaceForm;
            return (
              <button
                key={cand.surfaceForm}
                type="button"
                className={`pmw-expr-pill${isChosen ? ' is-selected' : ''}`}
                onClick={() => onSelect(cand)}
              >
                <span className="pmw-expr-radio" aria-hidden="true">{isChosen ? '✓' : ''}</span>
                <div className="pmw-expr-info">
                  <div className="pmw-expr-title">
                    <b className="pmw-surface">{cand.surfaceForm}</b>
                    <span className="pmw-expr-tag">{expressionTypeLabels[cand.expressionType]}</span>
                  </div>
                  {cand.rationale && <p className="pmw-expr-why">{cand.rationale}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
};

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
  /** Deltas received but not yet typed out, plus the pacer that drips them. */
  const pendingRef = useRef('');
  const pacerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drainRef = useRef<(() => void) | null>(null);
  /** The mode of the turn in flight/last attempted, so retry repeats it. */
  const lastModeRef = useRef<SemanticAgentTurnMode>('chat');

  const [session, setSession] = useState<SemanticAgentSession | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /** The assistant reply as it streams in; blank again once the turn lands. */
  const [streamingText, setStreamingText] = useState('');
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

  /** Stop the typewriter and drop whatever had not been typed out yet. */
  const stopPacer = useCallback(() => {
    if (pacerRef.current) clearInterval(pacerRef.current);
    pacerRef.current = null;
    drainRef.current = null;
    pendingRef.current = '';
  }, []);

  /**
   * The upstream typically generates the whole reply first and then hands it
   * over in one late burst, so raw deltas would pop the text in almost at
   * once. The pacer types it back out at a readable pace; a large backlog
   * speeds up modestly so the bubble never trails far behind. Once the final
   * result is in (drainRef set), the remaining tail finishes fast.
   */
  const pump = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) {
      const done = drainRef.current;
      if (pacerRef.current) clearInterval(pacerRef.current);
      pacerRef.current = null;
      drainRef.current = null;
      done?.();
      return;
    }
    const chars = Array.from(pending);
    const take = drainRef.current
      ? Math.max(2, Math.ceil(chars.length / 8))
      : Math.min(5, Math.max(1, Math.round(chars.length / 100)));
    pendingRef.current = chars.slice(take).join('');
    setStreamingText((text) => text + chars.slice(0, take).join(''));
  }, []);

  const startPacer = useCallback(() => {
    if (!pacerRef.current) pacerRef.current = setInterval(pump, 30);
  }, [pump]);

  // A turn still typing when the screen goes away must not leave a live timer.
  useEffect(() => () => {
    if (pacerRef.current) clearInterval(pacerRef.current);
    pacerRef.current = null;
    drainRef.current?.();
    drainRef.current = null;
  }, []);

  useEffect(() => {
    if (active) screenRef.current?.scrollTo({ top: 0 });
  }, [active, personalMeaningId]);

  useEffect(() => {
    // While the reply streams in, follow it without smooth-scroll fighting
    // every delta; finished messages still glide into place.
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: busy ? 'auto' : session?.messages.length ? 'smooth' : 'auto',
    });
  }, [busy, session?.messages.length, streamingText]);

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
    mode: SemanticAgentTurnMode = 'chat',
  ) => {
    if (!detail) return;
    lastModeRef.current = mode;
    const learnerMessage = learnerBody?.trim() ? message('learner', learnerBody.trim()) : null;
    const messages = learnerMessage
      ? [...baseSession.messages, learnerMessage]
      : [...baseSession.messages];
    const waiting = { ...baseSession, messages };
    commit(waiting);
    setBusy(true);
    setError('');
    stopPacer();
    setStreamingText('');
    try {
      const result = await semanticAgent.turn(
        {
          material: materialFor(detail),
          messages,
          workingSet: baseSession.workingSet,
          learnerEditedTracks: baseSession.learnerEditedTracks,
          focusLocked: baseSession.focusLocked,
          mode,
        },
        (delta) => {
          pendingRef.current += delta;
          startPacer();
        },
      );
      if (pendingRef.current) {
        // The result is in; let the bubble finish typing before the final
        // message takes its place, so the tail never snaps in.
        await new Promise<void>((resolve) => {
          drainRef.current = resolve;
          startPacer();
        });
      }
      setStreamingText('');
      commit({
        ...waiting,
        messages: [...messages, message('assistant', result.assistantMessage)],
        // Only a consolidation writes panel state; a chat turn is talk, and
        // talking must never demote a promotion the panel already earned.
        ...(mode === 'consolidate' ? {
          workingSet: result.workingSet,
          readyToConfirm: result.readyToConfirm,
          provenance: result.provenance,
        } : {}),
      });
    } catch (cause) {
      stopPacer();
      setStreamingText('');
      setError(cause instanceof Error ? cause.message : 'AI 暂时无法继续这轮对话。');
    } finally {
      setBusy(false);
    }
  }, [commit, detail]);

  // The first turn follows the declared starting point: a learner who already
  // knows the sense (or has an expression to check) consolidates immediately;
  // an uncertain one opens with a chat question.
  useEffect(() => {
    if (!active || !detail || !session) return;
    if (session.messages.length > 0 || openedThread.current === session.threadId) return;
    openedThread.current = session.threadId;
    const firstMode: SemanticAgentTurnMode = detail.startingPoint === 'from_sense'
      || detail.startingPoint === 'from_expression' ? 'consolidate' : 'chat';
    void runTurn(session, undefined, firstMode);
  }, [active, detail, runTurn, session]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || !draft.trim() || busy) return;
    const body = draft.trim();
    setDraft('');
    void runTurn(session, body, 'chat');
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
        expressionCandidates: (session.workingSet.expressions ?? (expression ? [expression] : [])).map((item) => ({
          surfaceForm: item.surfaceForm,
          expressionType: item.expressionType,
          languageTag: item.languageTag,
          relation: item.relation,
          semanticCoverage: item.semanticCoverage,
        })),
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

  const working = session?.workingSet ?? { focus: null, sense: null, expression: null, expressions: [] };
  const candidatesList = (working.expressions && working.expressions.length > 0)
    ? working.expressions
    : (working.expression ? [working.expression] : []);
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
      <h2>这个意思已确认</h2>
      <p>已为你记入词义世界。</p>
      <div className="pmw-done-facts">
        <article><small>侧面</small><b>{confirmedFocus?.statement}</b></article>
        <article><small>意思</small><b>{alignment?.coreMeaningFocus}</b></article>
        <article>
          <small>表达</small>
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
          查看已确认意思
        </button>
        <button type="button" onClick={onBack}>回词义世界</button>
      </div>
    </div>
  ) : (
    <>
      {materialOpen && (
        <section className="pmw-material" aria-label="本轮材料">
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
          <div
            className={`pmw-message is-assistant${streamingText ? ' is-streaming' : ' is-thinking'}`}
          >
            <span className="pmw-avatar" aria-hidden="true">✦</span>
            <div>
              {streamingText ? (
                <p>{streamingText}<i className="pmw-caret" aria-hidden="true" /></p>
              ) : (
                <p><i /><i /><i /></p>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="pmw-inline-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runTurn(session, undefined, lastModeRef.current)}
          >
            重试
          </button>
        </div>
      )}

      <div className="pmw-dock-bar">
        <div className="pmw-dock-chips">
          <button
            type="button"
            className={`pmw-dock-chip is-${focusStatus.tone}`}
            onClick={() => setPanelOpen(true)}
            aria-label="查看侧面"
          >
            <small>侧面</small>
            <b>{working.focus ? working.focus.statement : focusStatus.label}</b>
          </button>
          <button
            type="button"
            className={`pmw-dock-chip is-${senseStatus.tone}`}
            onClick={() => setPanelOpen(true)}
            aria-label="查看意思"
          >
            <small>意思</small>
            <b>{working.sense ? working.sense.coreMeaningFocus : senseStatus.label}</b>
          </button>
          <button
            type="button"
            className={`pmw-dock-chip is-${expressionStatus.tone}`}
            onClick={() => setPanelOpen(true)}
            aria-label="查看表达"
          >
            <small>表达</small>
            <b>
              {working.expression
                ? `${working.expression.surfaceForm}${candidatesList.length > 1 ? ` (+${candidatesList.length - 1})` : ''}`
                : expressionStatus.label}
            </b>
          </button>
        </div>

        <div className="pmw-dock-actions">
          <button
            type="button"
            className="pmw-dock-organize"
            disabled={busy}
            onClick={() => void runTurn(session, undefined, 'consolidate')}
            title="让 AI 梳理提炼当前结论"
          >
            ✨ 整理一下
          </button>
          {senseConfirmed ? (
            alignment!.expressionCandidates.length === 0 ? null : (
              <button
                type="button"
                className="pmw-dock-confirm is-ready"
                disabled={!canConfirmExpressionOnly}
                onClick={() => void confirmExpressionOnly()}
              >
                确认表达
              </button>
            )
          ) : (
            <button
              type="button"
              className={`pmw-dock-confirm${session.readyToConfirm ? ' is-ready' : ''}`}
              disabled={!canConfirm}
              onClick={() => {
                setIncludeExpression(Boolean(working.expression));
                setReviewOpen(true);
              }}
            >
              就确认成这样
            </button>
          )}
        </div>
      </div>

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

      {panelOpen && (
        <div className="pmw-preview-layer" onMouseDown={() => setPanelOpen(false)}>
          <section
            className="pmw-preview-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="当前整理结果"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2>当前整理结果</h2>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="关闭">×</button>
            </header>
            <div className="pmw-preview-body">
              {senseConfirmed && (
                <p className="pmw-panel-note">
                  侧面与意思已确认，接下来可以确认目标表达。
                </p>
              )}
              {working.focus && !senseConfirmed && (
                <FocusCard
                  focus={working.focus}
                  editing={editingTrack === 'focus'}
                  onEdit={() => setEditingTrack('focus')}
                  onDone={() => setEditingTrack(null)}
                  onChange={(next) => editTrack('focus', next)}
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
              {candidatesList.length > 0 && (
                <ExpressionsCard
                  candidates={candidatesList}
                  selected={working.expression}
                  onSelect={(cand) => editTrack('expression', cand)}
                  editing={editingTrack === 'expression'}
                  onEdit={() => setEditingTrack('expression')}
                  onDone={() => setEditingTrack(null)}
                  onChange={(next) => editTrack('expression', next)}
                />
              )}
              {!working.focus && !working.sense && candidatesList.length === 0 && (
                <p className="pmw-panel-empty">继续聊聊你的场景或疑问。</p>
              )}
            </div>
            <footer>
              <button
                type="button"
                className="pmw-primary"
                disabled={!canConfirm}
                onClick={() => {
                  setPanelOpen(false);
                  setIncludeExpression(Boolean(working.expression));
                  setReviewOpen(true);
                }}
              >
                就确认成这样
              </button>
              <button type="button" onClick={() => setPanelOpen(false)}>继续聊</button>
            </footer>
          </section>
        </div>
      )}

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
              <h2 id="pmw-review-title">确认这些内容</h2>
              <button type="button" onClick={() => setReviewOpen(false)} aria-label="继续聊">×</button>
            </header>

            <div className="pmw-review-body">
              <article className="pmw-review-card">
                <header><small>侧面</small><em>一起确认</em></header>
                <b>{working.focus.statement}</b>
              </article>

              <article className="pmw-review-card">
                <header><small>意思</small><em>一起确认</em></header>
                <b>{working.sense.coreMeaningFocus}</b>
              </article>

              <article className={`pmw-review-card${includeExpression ? '' : ' is-deferred'}`}>
                <header>
                  <small>目标表达 {candidatesList.length > 1 ? `(${candidatesList.length} 个候选)` : ''}</small>
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
                  <div className="pmw-review-candidates">
                    {candidatesList.map((cand) => {
                      const isChosen = (working.expression?.surfaceForm ?? candidatesList[0]?.surfaceForm) === cand.surfaceForm;
                      return (
                        <button
                          key={cand.surfaceForm}
                          type="button"
                          className={`pmw-review-cand-item${isChosen ? ' is-chosen' : ''}`}
                          onClick={() => editTrack('expression', cand)}
                        >
                          <span className="pmw-review-radio" aria-hidden="true">{isChosen ? '✓' : ''}</span>
                          <div className="pmw-review-cand-copy">
                            <div>
                              <b className="pmw-surface">{cand.surfaceForm}</b>
                              <span className="pmw-expr-tag">{expressionTypeLabels[cand.expressionType]}</span>
                            </div>
                            {cand.rationale && <small>{cand.rationale}</small>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p>这次还没聊出合适的英语表达。确认前两个，之后可以接着聊。</p>
                )}
              </article>
            </div>

            <footer>
              <p className="pmw-review-consequence">
                确认后将保存到词义世界{working.expression && includeExpression ? '并连接表达' : '，表达可稍后绑定'}。
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

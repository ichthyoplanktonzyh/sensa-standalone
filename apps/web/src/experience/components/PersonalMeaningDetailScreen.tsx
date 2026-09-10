import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { uiClass } from '../ui/classes';
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

export interface MeaningConversationController {
 material:string; source?:{url:string|null;title:string}; messages:{role:"learner"|"assistant";body:string}[];
 candidate:{expression:string;meaning:string;explanation:string}|null;
 accepted:boolean;busy:boolean;notice:string;recipient:string;canContinue:boolean;
 onSend:(text:string)=>Promise<void>;onContinue:()=>Promise<void>;onStop:()=>void;onConfirm:()=>Promise<void>;
}
interface PersonalMeaningDetailScreenProps {
 learningControls?:import('react').ReactNode;
 conversation?:MeaningConversationController;
  active: boolean;
  personalMeaningId: string | null;
  onBack: () => void;
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
  toast: (message: string) => void;
}

const semanticAgent = createRealSemanticAgent();
const SEMANTIC_POLICY_VERSION = 'sensa-semantic-policy-agent-loop-v1';

const expressionTypeLabels: Record<SensaExpressionType, string> = {
  get word() { return uiText('word'); },
  get phrase() { return uiText('phrase'); },
  get construction() { return uiText('construction'); },
  get sentence() { return uiText('sentence'); },
  get utterance_strategy() { return uiText('expressionStrategy'); },
};

const relationLabels: Record<SensaExpressionBindingRelation, string> = {
  get realizes() { return uiText('expressesThisMeaning'); },
  get approximates() { return uiText('approximatesThisMeaning'); },
  get evokes() { return uiText('evokesThisMeaning'); },
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  get exact() { return uiText('matchingScope'); },
  get broader() { return uiText('broaderScope'); },
  get narrower() { return uiText('narrowerScope'); },
  get overlapping() { return uiText('partialOverlap'); },
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
  if (confirmed) return { tone: 'confirmed', get label() { return uiText('confirmed'); } };
  return hasCandidate
    ? { tone: 'candidate', get label() { return uiText('candidateReady'); } }
    : { tone: 'idle', get label() { return uiText('inConversation'); } };
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
  <article className={uiClass("pmw-card")}>
    <header>
      <small>{uiText('meaningFocus')}</small>
      {!editing && <button type="button" onClick={onEdit}>{uiText('edit')}</button>}
    </header>
    {editing ? (
      <div className={uiClass("pmw-edit")}>
        <textarea
          value={focus.statement}
          rows={2}
          onChange={(event) => onChange({ ...focus, statement: event.target.value })}
        />
        <button type="button" className={uiClass("pmw-edit-done")} onClick={onDone}>{uiText('done')}</button>
      </div>
    ) : (
      <>
        <b className={uiClass("pmw-card-lead")}>{focus.statement}</b>
        {focus.distinguishingNotes.length > 0 && (
          <p className={uiClass("pmw-card-note")}>{focus.distinguishingNotes[0]}</p>
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
  <article className={uiClass("pmw-card")}>
    <header>
      <small>{uiText('meaning')}</small>
      {!editing && <button type="button" onClick={onEdit}>{uiText('edit')}</button>}
    </header>
    {editing ? (
      <div className={uiClass("pmw-edit")}>
        <textarea
          value={sense.coreMeaningFocus}
          rows={2}
          onChange={(event) => onChange({ ...sense, coreMeaningFocus: event.target.value })}
        />
        <button type="button" className={uiClass("pmw-edit-done")} onClick={onDone}>{uiText('done')}</button>
      </div>
    ) : (
      <>
        <b className={uiClass("pmw-card-lead")}>{sense.coreMeaningFocus}</b>
        {sense.prototypeScenes[0] && (
          <p className={uiClass("pmw-card-note")}>{sense.prototypeScenes[0].summary}</p>
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
    <article className={uiClass("pmw-card")}>
      <header>
        <small>{uiText('targetExpression')}{candidates.length > 1 ? uiText('candidateCount', { count: candidates.length }) : ''}</small>
        {!editing && active && <button type="button" onClick={onEdit}>{uiText('edit')}</button>}
      </header>
      {editing && active ? (
        <div className={uiClass("pmw-edit")}>
          <input
            value={active.surfaceForm}
            onChange={(event) => onChange({ ...active, surfaceForm: event.target.value })}
          />
          <button type="button" className={uiClass("pmw-edit-done")} onClick={onDone}>{uiText('done')}</button>
        </div>
      ) : (
        <div className={uiClass("pmw-expr-candidates")}>
          {candidates.map((cand) => {
            const isChosen = (selected?.surfaceForm ?? candidates[0]?.surfaceForm) === cand.surfaceForm;
            return (
              <button
                key={cand.surfaceForm}
                type="button"
                className={uiClass(`pmw-expr-pill${isChosen ? ' is-selected' : ''}`)}
                onClick={() => onSelect(cand)}
              >
                <span className={uiClass("pmw-expr-radio")} aria-hidden="true">{isChosen ? '✓' : ''}</span>
                <div className={uiClass("pmw-expr-info")}>
                  <div className={uiClass("pmw-expr-title")}>
                    <b className={uiClass("pmw-surface")}>{cand.surfaceForm}</b>
                    <span className={uiClass("pmw-expr-tag")}>{expressionTypeLabels[cand.expressionType]}</span>
                  </div>
                  {cand.rationale && <p className={uiClass("pmw-expr-why")}>{cand.rationale}</p>}
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

export const PersonalMeaningDetailScreen=(props:PersonalMeaningDetailScreenProps)=>props.conversation
 ? <ConnectedMeaningConversation {...props} conversation={props.conversation}/>
 : <PreviewPersonalMeaningDetailScreen {...props}/>;
const PreviewPersonalMeaningDetailScreen = ({
  active,
  personalMeaningId,
  onBack,
  onOpenConfirmedSense,
  toast,
}: PersonalMeaningDetailScreenProps) => {
  useTranslation();
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
      setError(cause instanceof Error ? cause.message : uiText('unableToContinueThisConversationPleaseRetry'));
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
      toast(uiText('materialAddedForTheNextTurn'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiText('unableToAddThisImage'));
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
      toast(result.expressionConfirmed ? uiText('meaningAndExpressionConfirmed') : uiText('meaningConfirmedExpressionStillPending'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiText('unableToConfirmPleaseRetry'));
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
      toast(uiText('targetExpressionConfirmed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiText('unableToConfirmThisExpression'));
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
    <div className={uiClass("pmw-error")} role="alert">
      <b>{uiText('unableToReadThisMaterial')}</b>
      <p>{status.error}</p>
    </div>
  ) : !detail || !session ? (
    <div className={uiClass("pmw-empty")}>{uiText('thisMaterialWasNotFound')}</div>
  ) : allConfirmed ? (
    <div className={uiClass("pmw-done")}>
      <span className={uiClass("pmw-done-mark")} aria-hidden="true">✓</span>
      <h2>{uiText('meaningConfirmed')}</h2>
      <p>{uiText('savedToYourMeanings')}</p>
      <div className={uiClass("pmw-done-facts")}>
        <article><small>{uiText('focus')}</small><b>{confirmedFocus?.statement}</b></article>
        <article><small>{uiText('meaning2')}</small><b>{alignment?.coreMeaningFocus}</b></article>
        <article>
          <small>{uiText('expression')}</small>
          <b>{boundExpression?.surfaceForm}</b>
          <span>
            {expressionTypeLabels[boundExpression!.expressionType]} ·{' '}
            {relationLabels[boundExpression!.relation]} ·{' '}
            {coverageLabels[boundExpression!.semanticCoverage]}
          </span>
        </article>
      </div>
      <div className={uiClass("pmw-done-actions")}>
        <button type="button" className={uiClass("pmw-primary")} onClick={startAnotherThread}>
          {uiText('exploreAnotherAspectOfThisExperience')}</button>
        <button
          type="button"
          onClick={() => onOpenConfirmedSense(
            detail.personalMeaningId,
            confirmedFocus!.meaningFocusId,
          )}
        >
          {uiText('viewConfirmedMeaning')}</button>
        <button type="button" onClick={onBack}>{uiText('backToMyContent')}</button>
      </div>
    </div>
  ) : (
    <>
      {materialOpen && (
        <section className={uiClass("pmw-material")} aria-label={uiText('contextForThisConversation')}>
          {detail.materialBlocks.map((block) => (
            block.kind === 'image' ? (
              <img
                key={block.anchorId}
                src={getMedia(block.personalMediaObjectId ?? '')?.dataUrl ?? ''}
                alt={uiText('contextImage')}
              />
            ) : (
              <p key={block.anchorId}>{block.bodyText}</p>
            )
          ))}
          {detail.familiarAnchors.map((anchor) => (
            <p key={anchor.anchorId} className={uiClass("pmw-material-familiar")}>
              <small>{uiText('chineseExpression')}</small>{anchor.surfaceForm}
            </p>
          ))}
          <button type="button" onClick={() => fileRef.current?.click()}>{uiText('addAnImage')}</button>
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

      <div className={uiClass("pmw-transcript")} ref={transcriptRef} aria-live="polite">
        {session.messages.map((item) => (
          <div key={item.messageId} className={uiClass(`pmw-message is-${item.role}`)}>
            {item.role === 'assistant' && (
              <span className={uiClass("pmw-avatar")} aria-hidden="true">✦</span>
            )}
            <div><p>{item.body}</p></div>
          </div>
        ))}
        {busy && (
          <div
            className={uiClass(`pmw-message is-assistant${streamingText ? ' is-streaming' : ' is-thinking'}`)}
          >
            <span className={uiClass("pmw-avatar")} aria-hidden="true">✦</span>
            <div>
              {streamingText ? (
                <p>{streamingText}<i className={uiClass("pmw-caret")} aria-hidden="true" /></p>
              ) : (
                <p><i /><i /><i /></p>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className={uiClass("pmw-inline-error")} role="alert">
          <span>{error}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runTurn(session, undefined, lastModeRef.current)}
          >
            {uiText('retry')}</button>
        </div>
      )}

      <div className={uiClass("pmw-dock-bar")}>
        <div className={uiClass("pmw-dock-chips")}>
          <button
            type="button"
            className={uiClass(`pmw-dock-chip is-${focusStatus.tone}`)}
            onClick={() => setPanelOpen(true)}
            aria-label={uiText('viewFocus')}
          >
            <small>{uiText('focus')}</small>
            <b>{working.focus ? working.focus.statement : focusStatus.label}</b>
          </button>
          <button
            type="button"
            className={uiClass(`pmw-dock-chip is-${senseStatus.tone}`)}
            onClick={() => setPanelOpen(true)}
            aria-label={uiText('viewMeaning')}
          >
            <small>{uiText('meaning2')}</small>
            <b>{working.sense ? working.sense.coreMeaningFocus : senseStatus.label}</b>
          </button>
          <button
            type="button"
            className={uiClass(`pmw-dock-chip is-${expressionStatus.tone}`)}
            onClick={() => setPanelOpen(true)}
            aria-label={uiText('viewExpression')}
          >
            <small>{uiText('expression')}</small>
            <b>
              {working.expression
                ? `${working.expression.surfaceForm}${candidatesList.length > 1 ? ` (+${candidatesList.length - 1})` : ''}`
                : expressionStatus.label}
            </b>
          </button>
        </div>

        <div className={uiClass("pmw-dock-actions")}>
          <button
            type="button"
            className={uiClass("pmw-dock-organize")}
            disabled={busy}
            onClick={() => void runTurn(session, undefined, 'consolidate')}
            title={uiText('summarizeTheCurrentUnderstanding')}
          >
            {uiText('summarize')}</button>
          {senseConfirmed ? (
            alignment!.expressionCandidates.length === 0 ? null : (
              <button
                type="button"
                className={uiClass("pmw-dock-confirm is-ready")}
                disabled={!canConfirmExpressionOnly}
                onClick={() => void confirmExpressionOnly()}
              >
                {uiText('confirmExpression')}</button>
            )
          ) : (
            <button
              type="button"
              className={uiClass(`pmw-dock-confirm${session.readyToConfirm ? ' is-ready' : ''}`)}
              disabled={!canConfirm}
              onClick={() => {
                setIncludeExpression(Boolean(working.expression));
                setReviewOpen(true);
              }}
            >
              {uiText('reviewAndConfirm')}</button>
          )}
        </div>
      </div>

      <form className={uiClass("pmw-composer")} onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={uiText('shareYourUnderstandingExamplesOrQuestions')}
          rows={2}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label={uiText('send')}>
          <span aria-hidden="true">↑</span>
        </button>
      </form>

      {panelOpen && (
        <div className={uiClass("pmw-preview-layer")} onMouseDown={() => setPanelOpen(false)}>
          <section
            className={uiClass("pmw-preview-sheet")}
            role="dialog"
            aria-modal="true"
            aria-label={uiText('currentUnderstanding')}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2>{uiText('currentUnderstanding')}</h2>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label={uiText('close')}>×</button>
            </header>
            <div className={uiClass("pmw-preview-body")}>
              {senseConfirmed && (
                <p className={uiClass("pmw-panel-note")}>
                  {uiText('theFocusAndMeaningAreConfirmedYou')}</p>
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
                <p className={uiClass("pmw-panel-empty")}>{uiText('tellUsMoreAboutYourContextOr')}</p>
              )}
            </div>
            <footer>
              <button
                type="button"
                className={uiClass("pmw-primary")}
                disabled={!canConfirm}
                onClick={() => {
                  setPanelOpen(false);
                  setIncludeExpression(Boolean(working.expression));
                  setReviewOpen(true);
                }}
              >
                {uiText('reviewAndConfirm')}</button>
              <button type="button" onClick={() => setPanelOpen(false)}>{uiText('keepTalking')}</button>
            </footer>
          </section>
        </div>
      )}

      {reviewOpen && working.focus && working.sense && (
        <div className={uiClass("pmw-review-layer")} onMouseDown={() => setReviewOpen(false)}>
          <section
            className={uiClass("pmw-review")}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pmw-review-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="pmw-review-title">{uiText('confirmTheseDetails')}</h2>
              <button type="button" onClick={() => setReviewOpen(false)} aria-label={uiText('keepTalking')}>×</button>
            </header>

            <div className={uiClass("pmw-review-body")}>
              <article className={uiClass("pmw-review-card")}>
                <header><small>{uiText('focus')}</small><em>{uiText('confirmTogether')}</em></header>
                <b>{working.focus.statement}</b>
              </article>

              <article className={uiClass("pmw-review-card")}>
                <header><small>{uiText('meaning2')}</small><em>{uiText('confirmTogether')}</em></header>
                <b>{working.sense.coreMeaningFocus}</b>
              </article>

              <article className={uiClass(`pmw-review-card${includeExpression ? '' : ' is-deferred'}`)}>
                <header>
                  <small>{uiText('targetExpression')}{candidatesList.length > 1 ? uiText('candidateCount', { count: candidatesList.length }) : ''}</small>
                  {working.expression ? (
                    <label className={uiClass("pmw-review-toggle")}>
                      <input
                        type="checkbox"
                        checked={includeExpression}
                        onChange={(event) => setIncludeExpression(event.target.checked)}
                      />
                      <span>{uiText('confirmTogether')}</span>
                    </label>
                  ) : <em>{uiText('noCandidatesYet')}</em>}
                </header>
                {working.expression ? (
                  <div className={uiClass("pmw-review-candidates")}>
                    {candidatesList.map((cand) => {
                      const isChosen = (working.expression?.surfaceForm ?? candidatesList[0]?.surfaceForm) === cand.surfaceForm;
                      return (
                        <button
                          key={cand.surfaceForm}
                          type="button"
                          className={uiClass(`pmw-review-cand-item${isChosen ? ' is-chosen' : ''}`)}
                          onClick={() => editTrack('expression', cand)}
                        >
                          <span className={uiClass("pmw-review-radio")} aria-hidden="true">{isChosen ? '✓' : ''}</span>
                          <div className={uiClass("pmw-review-cand-copy")}>
                            <div>
                              <b className={uiClass("pmw-surface")}>{cand.surfaceForm}</b>
                              <span className={uiClass("pmw-expr-tag")}>{expressionTypeLabels[cand.expressionType]}</span>
                            </div>
                            {cand.rationale && <small>{cand.rationale}</small>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p>{uiText('noSuitableEnglishExpressionYetYouCan')}</p>
                )}
              </article>
            </div>

            <footer>
              <p className={uiClass("pmw-review-consequence")}>
                {uiText('confirmationSavesThisToYourMeanings')}{working.expression && includeExpression ? uiText('andConnectsTheExpression') : uiText('youCanConnectAnExpressionLater')}。
              </p>
              {error && <p className={uiClass("pmw-review-error")} role="alert">{error}</p>}
              <div className={uiClass("pmw-review-actions")}>
                <button
                  type="button"
                  className={uiClass("pmw-primary")}
                  disabled={busy}
                  onClick={() => void confirm()}
                >
                  {busy ? uiText('confirming') : uiText('confirm')}
                </button>
                <button type="button" disabled={busy} onClick={() => setReviewOpen(false)}>
                  {uiText('keepTalking2')}</button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );

  return <MeaningWorkspaceFrame active={active} onBack={onBack} materialOpen={materialOpen} onToggleMaterial={()=>setMaterialOpen(v=>!v)} screenRef={screenRef}>{body}</MeaningWorkspaceFrame>;
};

/** One existing workspace frame for both persisted and preview controllers. */
function MeaningWorkspaceFrame({active,onBack,materialOpen,onToggleMaterial,screenRef,children}:{active:boolean;onBack:()=>void;materialOpen:boolean;onToggleMaterial:()=>void;screenRef?:import('react').Ref<HTMLElement>;children:import('react').ReactNode}){
 return <section ref={screenRef} className={uiClass(`screen pmw-screen${active?' active':''}`, '#s-personal-meaning')} id="s-personal-meaning" data-anim="slide">
  <div className="ml-auto flex h-full w-full flex-col bg-[#fbfbfa] shadow-xl lg:max-w-[860px]">
   <header className={uiClass('content-nav pmw-nav')}>
    <button className={uiClass('content-nav-back')} onClick={onBack} aria-label={uiText('backToMyContent2')}><svg className={uiClass('icon')}><use href="#i-chev-l"/></svg></button>
    <h1>{uiText('clarifyYourMeaning')}</h1>
    <button type="button" className={uiClass(`pmw-material-toggle${materialOpen?' is-open':''}`)} onClick={onToggleMaterial} aria-expanded={materialOpen}>{uiText('context')}</button>
   </header><div className={uiClass('pmw-shell')}>{children}</div>
  </div>
 </section>;
}
function ConnectedMeaningConversation({active,onBack,conversation:c,learningControls}:PersonalMeaningDetailScreenProps & {conversation:MeaningConversationController}){
 useTranslation();
 const [text,setText]=useState(''),[materialOpen,setMaterialOpen]=useState(false),[panelOpen,setPanelOpen]=useState(false),[reviewOpen,setReviewOpen]=useState(false);
 const transcript=useRef<HTMLDivElement>(null);
 useEffect(()=>{transcript.current?.scrollTo({top:transcript.current.scrollHeight});},[c.messages.length,c.busy]);
 const candidate=c.candidate;
 const send=async()=>{await c.onSend(text);setText('');};
 return <MeaningWorkspaceFrame active={active} onBack={onBack} materialOpen={materialOpen} onToggleMaterial={()=>setMaterialOpen(v=>!v)}>
  {materialOpen&&<section className={uiClass('pmw-material')} aria-label={uiText('contextForThisConversation')}><p>{c.material}</p></section>}
  <p className="px-5 text-xs">{c.source?.url&&<a href={c.source.url} target="_blank" rel="noreferrer">查看来源：{c.source.title||c.source.url}</a>}</p>
  <p className="px-5 py-3 text-xs leading-6 text-[#68748d]">发送至：{c.recipient}。发送或继续时才会提供本次材料和对话。</p>
  <div ref={transcript} className={uiClass('pmw-transcript')} aria-live="polite">
   {c.messages.map((m,i)=><div key={i} className={uiClass(`pmw-message is-${m.role}`)}>{m.role==='assistant'&&<span className={uiClass('pmw-avatar')} aria-hidden="true">✦</span>}<div><p>{m.body}</p></div></div>)}
   {c.busy&&<div className={uiClass('pmw-message is-assistant is-thinking')}><span className={uiClass('pmw-avatar')} aria-hidden="true">✦</span><div><p><i/><i/><i/></p></div></div>}
   {c.accepted&&<div className={uiClass('pmw-done')}><span className={uiClass('pmw-done-mark')}>✓</span><h2>意思已确认</h2><p>已保存在本机。</p></div>}
  </div>
  {c.accepted&&learningControls}
  {c.notice&&<div className={uiClass('pmw-inline-error')} role="status">{c.notice}</div>}
  <div className={uiClass('pmw-dock-bar')}>
   <div className={uiClass('pmw-dock-chips')}>
    <button className={uiClass(`pmw-dock-chip is-${c.accepted?'confirmed':candidate?'candidate':'idle'}`)} onClick={()=>setPanelOpen(true)} aria-label={uiText('viewMeaning')}><small>{uiText('meaning2')}</small><b>{candidate?.meaning??uiText('inConversation')}</b></button>
    <button className={uiClass(`pmw-dock-chip is-${c.accepted?'confirmed':candidate?'candidate':'idle'}`)} onClick={()=>setPanelOpen(true)} aria-label={uiText('viewExpression')}><small>{uiText('expression')}</small><b>{candidate?.expression??uiText('inConversation')}</b></button>
   </div>
   <div className={uiClass('pmw-dock-actions')}>
    {c.canContinue&&!c.accepted&&<button className={uiClass('pmw-dock-organize')} disabled={c.busy} onClick={()=>void c.onContinue()}>继续对话</button>}
    {c.busy&&<button className={uiClass('pmw-dock-organize')} onClick={c.onStop}>停止请求</button>}
    {!c.accepted&&<button className={uiClass(`pmw-dock-confirm${candidate?' is-ready':''}`)} disabled={c.busy||!candidate} onClick={()=>setReviewOpen(true)}>{uiText('reviewAndConfirm')}</button>}
   </div>
  </div>
  {!c.accepted&&<form className={uiClass('pmw-composer')} onSubmit={e=>{e.preventDefault();void send().catch(()=>{});}}><textarea aria-label="补充或更正" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.currentTarget.form?.requestSubmit();}}} placeholder={uiText('shareYourUnderstandingExamplesOrQuestions')} rows={2} disabled={c.busy}/><button type="submit" disabled={c.busy||!text.trim()} aria-label={uiText('send')}><span aria-hidden="true">↑</span></button></form>}
  {panelOpen&&<div className={uiClass('pmw-preview-layer')} onMouseDown={()=>setPanelOpen(false)}><section className={uiClass('pmw-preview-sheet')} role="dialog" aria-modal="true" aria-label="当前理解" onMouseDown={e=>e.stopPropagation()}><header><h2>当前理解</h2><button onClick={()=>setPanelOpen(false)}>{uiText('close')}</button></header><div className={uiClass('pmw-preview-body')}>{candidate?<><article className={uiClass('pmw-card')}><small>{uiText('meaning2')}</small><p>{candidate.meaning}</p></article><article className={uiClass('pmw-card')}><b>{candidate.expression}</b><p>{candidate.explanation}</p></article></>:<p>{uiText('tellUsMoreAboutYourContextOr')}</p>}</div></section></div>}
  {reviewOpen&&candidate&&<div className={uiClass('pmw-review-layer')}><section className={uiClass('pmw-review')} role="dialog" aria-modal="true" aria-labelledby="pmw-review-title"><header><h2 id="pmw-review-title">{uiText('confirmTheseDetails')}</h2><button disabled={c.busy} onClick={()=>setReviewOpen(false)}>{uiText('close')}</button></header><div className={uiClass('pmw-review-body')}><article className={uiClass('pmw-review-card')}><small>场景</small><p>{c.material}</p></article><article className={uiClass('pmw-review-card')}><small>{uiText('meaning2')}</small><p>{candidate.meaning}</p></article><article className={uiClass('pmw-review-card')}><small>{uiText('expression')}</small><b>{candidate.expression}</b><p>{candidate.explanation}</p></article><p className={uiClass('pmw-review-consequence')}>确认只保存这个意思与表达，不自动加入学习。</p>{c.notice&&<p role="status">{c.notice}</p>}<div className={uiClass('pmw-review-actions')}><button className={uiClass('pmw-primary')} disabled={c.busy} onClick={()=>void c.onConfirm().then(()=>setReviewOpen(false)).catch(()=>{})}>就是这个意思，保存</button><button disabled={c.busy} onClick={()=>setReviewOpen(false)}>继续澄清</button></div></div></section></div>}
 </MeaningWorkspaceFrame>;
}

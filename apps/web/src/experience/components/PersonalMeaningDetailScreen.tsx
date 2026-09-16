import {ExpressionChatInput} from './ExpressionChatInput';
import type {ConversationImage} from '../../data/library/conversationImages';
import {localFlowText} from '../../i18n/localFlowText';
import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { classNames } from '../ui/primitives';
import { SensaDetailWorkspaceLayout } from '../ui/SensaPageLayouts';
import { SensaOverlayLayout } from '../ui/SensaComponents';
import './PersonalMeaningDetailScreen.css';
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
 * A Focus is only proposed when the Context needs an explicit aspect boundary.
 * The learner's confirmation always writes Sense confirmation and Alignment,
 * optionally writes Focus acceptance, and may bind the Expression in the same
 * intent.
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
  useJourneyClarificationDraft,
  useJourneyGateway,
  type ClarificationDraftView,
  type JourneyDetailView,
  type JourneyFocusView,
} from '../personalMeaningJourney';
import { newUuid } from '../personalMeaningJourney/ids';
import { createRealSemanticAgent } from '../personalMeaningJourney/realSemanticAgent';
import { languageRoutesSnapshot } from '../../data/library/language';
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
import {
  type SensaExpressionBindingRelation,
  type SensaExpressionType,
  type SensaIntakeContext,
  type SensaSemanticCoverage,
} from '@sensa/contracts/sensa';

export interface MeaningConversationController {
 material:string; images?:ConversationImage[]; source?:{url:string|null;title:string}; messages:{role:"learner"|"assistant";body:string;images?:ConversationImage[]}[];
 candidate:{context:string;expression:string;meaning:string;explanation:string}|null;
 onUpdateContext?:(text:string,images:ConversationImage[])=>Promise<void>;
 accepted:boolean;busy:boolean;notice:string;recipient:string;canContinue:boolean;
 onSend:(text:string,images:ConversationImage[])=>Promise<void>;onContinue:()=>Promise<void>;onStop:()=>void;onConfirm:()=>Promise<void>;
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
      mediaDataUrl: block.inlineDataUrl ?? media?.dataUrl ?? null,
      mediaMimeType: block.inlineMimeType ?? media?.mimeType ?? null,
    };
  }),
  familiarExpression: detail.familiarAnchors[0]?.surfaceForm ?? null,
  startingPoint: detail.startingPoint,
});

const materialForDraft = (draft: ClarificationDraftView): SemanticAgentMaterial => ({
  blocks: draft.materialBlocks.map((block, index) => {
    const media = block.personalMediaObjectId ? getMedia(block.personalMediaObjectId) : null;
    return {
      blockId: block.personalMediaObjectId ?? `draft-text-${index}`,
      kind: block.kind,
      bodyText: block.bodyText ?? null,
      mediaDataUrl: media?.dataUrl ?? null,
      mediaMimeType: media?.mimeType ?? null,
    };
  }),
  familiarExpression: draft.familiarExpression,
  startingPoint: draft.startingPoint,
});

const completedContextForDraft = (
  draft: ClarificationDraftView,
  messages: SemanticAgentMessage[],
  supportLanguageTag: string,
): SensaIntakeContext | null => {
  if (draft.context) return structuredClone(draft.context);
  const textSegment = messages
    .filter((message) => message.role === 'learner')
    .map((message) => message.body.trim())
    .filter(Boolean)
    .join('\n\n');
  if (!textSegment) return null;
  return {
    modality: 'text',
    textSegment,
    mediaReferenceIds: [],
    languageTag: supportLanguageTag,
    source: {
      client: 'sensa-web',
      url: null,
      title: 'Inbox clarification',
      sourceReferenceId: draft.intakeId,
      domSelector: null,
      paragraphContext: null,
    },
  };
};

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
  <article className={classNames("pmw-card")}>
    <header>
      <small>{uiText('meaningFocus')}</small>
      {!editing && <button type="button" onClick={onEdit}>{uiText('edit')}</button>}
    </header>
    {editing ? (
      <div className={classNames("pmw-edit")}>
        <textarea
          value={focus.statement}
          rows={2}
          onChange={(event) => onChange({ ...focus, statement: event.target.value })}
        />
        <button type="button" className={classNames("pmw-edit-done")} onClick={onDone}>{uiText('done')}</button>
      </div>
    ) : (
      <>
        <b className={classNames("pmw-card-lead")}>{focus.statement}</b>
        {focus.distinguishingNotes.length > 0 && (
          <p className={classNames("pmw-card-note")}>{focus.distinguishingNotes[0]}</p>
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
  <article className={classNames("pmw-card")}>
    <header>
      <small>{uiText('meaning')}</small>
      {!editing && <button type="button" onClick={onEdit}>{uiText('edit')}</button>}
    </header>
    {editing ? (
      <div className={classNames("pmw-edit")}>
        <textarea
          value={sense.coreMeaningFocus}
          rows={2}
          onChange={(event) => onChange({ ...sense, coreMeaningFocus: event.target.value })}
        />
        <button type="button" className={classNames("pmw-edit-done")} onClick={onDone}>{uiText('done')}</button>
      </div>
    ) : (
      <>
        <b className={classNames("pmw-card-lead")}>{sense.coreMeaningFocus}</b>
        {sense.prototypeScenes[0] && (
          <p className={classNames("pmw-card-note")}>{sense.prototypeScenes[0].summary}</p>
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
    <article className={classNames("pmw-card")}>
      <header>
        <small>{uiText('targetExpression')}{candidates.length > 1 ? uiText('candidateCount', { count: candidates.length }) : ''}</small>
        {!editing && active && <button type="button" onClick={onEdit}>{uiText('edit')}</button>}
      </header>
      {editing && active ? (
        <div className={classNames("pmw-edit")}>
          <input
            value={active.surfaceForm}
            onChange={(event) => onChange({ ...active, surfaceForm: event.target.value })}
          />
          <button type="button" className={classNames("pmw-edit-done")} onClick={onDone}>{uiText('done')}</button>
        </div>
      ) : (
        <div className={classNames("pmw-expr-candidates")}>
          {candidates.map((cand) => {
            const isChosen = (selected?.surfaceForm ?? candidates[0]?.surfaceForm) === cand.surfaceForm;
            return (
              <button
                key={cand.surfaceForm}
                type="button"
                className={classNames(`pmw-expr-pill${isChosen ? ' is-selected' : ''}`)}
                onClick={() => onSelect(cand)}
              >
                <span className={classNames("pmw-expr-radio")} aria-hidden="true">{isChosen ? '✓' : ''}</span>
                <div className={classNames("pmw-expr-info")}>
                  <div className={classNames("pmw-expr-title")}>
                    <b className={classNames("pmw-surface")}>{cand.surfaceForm}</b>
                    <span className={classNames("pmw-expr-tag")}>{expressionTypeLabels[cand.expressionType]}</span>
                  </div>
                  {cand.rationale && <p className={classNames("pmw-expr-why")}>{cand.rationale}</p>}
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
  const clarificationDraft = useJourneyClarificationDraft(personalMeaningId);
  const clarificationMaterial = detail
    ? materialFor(detail)
    : clarificationDraft ? materialForDraft(clarificationDraft) : null;
  const draftMode = !detail && clarificationDraft !== null;
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

  /** The optional Focus this thread confirmed, if it needed one. */
  const confirmedFocus: JourneyFocusView | null = useMemo(() => {
    const focusId = session?.outcome?.meaningFocusId;
    if (!detail || !focusId) return null;
    return detail.focuses.find((focus) => focus.meaningFocusId === focusId) ?? null;
  }, [detail, session?.outcome?.meaningFocusId]);

  const alignment = confirmedFocus?.alignment
    ?? detail?.directAlignments.find(
      (candidate) => candidate.personalMeaningAlignmentId
        === session?.outcome?.personalMeaningAlignmentId,
    )
    ?? null;
  const boundExpression = alignment?.confirmedBindings[0] ?? null;
  const allConfirmed = Boolean(boundExpression);

  const runTurn = useCallback(async (
    baseSession: SemanticAgentSession,
    learnerBody?: string,
    mode: SemanticAgentTurnMode = 'chat',
  ) => {
    if (!clarificationMaterial) return;
    lastModeRef.current = mode;
    const learnerMessage = learnerBody?.trim() ? message('learner', learnerBody.trim()) : null;
    const messages = learnerMessage
      ? [...baseSession.messages, learnerMessage]
      : [...baseSession.messages];
    const languageContext=baseSession.languageContext??(await languageRoutesSnapshot()).context;
    const waiting = { ...baseSession, messages,languageContext };
    commit(waiting);
    setBusy(true);
    setError('');
    stopPacer();
    setStreamingText('');
    try {
      const result = await semanticAgent.turn(
        {
          material: clarificationMaterial,
          messages,
          workingSet: baseSession.workingSet,
          learnerEditedTracks: baseSession.learnerEditedTracks,
          focusLocked: baseSession.focusLocked,
          mode,
          languages:languageContext,
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
  }, [clarificationMaterial, commit]);

  // The first turn follows the declared starting point: a learner who already
  // knows the sense (or has an expression to check) consolidates immediately;
  // an uncertain one opens with a chat question.
  useEffect(() => {
    if (!active || !clarificationMaterial || !session) return;
    if (session.messages.length > 0 || openedThread.current === session.threadId) return;
    openedThread.current = session.threadId;
    const firstMode: SemanticAgentTurnMode = clarificationMaterial.startingPoint === 'from_sense'
      || clarificationMaterial.startingPoint === 'from_expression' ? 'consolidate' : 'chat';
    void runTurn(session, undefined, firstMode);
  }, [active, clarificationMaterial, runTurn, session]);

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
    if (!file || (!detail && !clarificationDraft)) return;
    setError('');
    try {
      const mediaId = newUuid();
      await storeImageFile(mediaId, file, new Date().toISOString());
      if (detail) {
        await gateway.addMaterialBlock({
          operationId: newUuid(),
          personalMeaningId: detail.personalMeaningId,
          block: { kind: 'image', personalMediaObjectId: mediaId },
        });
      } else {
        await gateway.addClarificationMaterial(
          newUuid(),
          clarificationDraft!.intakeId,
          { kind: 'image', personalMediaObjectId: mediaId },
        );
      }
      toast(uiText('materialAddedForTheNextTurn'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : uiText('unableToAddThisImage'));
    }
  };

  /** One atomic confirmation; Focus is included only when disambiguation needed it. */
  const confirm = async () => {
    if ((!detail && !clarificationDraft) || !session || busy) return;
    const { focus, sense, expression } = session.workingSet;
    if (!sense || (draftMode && (!expression || !includeExpression))) return;
    setBusy(true);
    setError('');
    try {
      const languageContext = session.languageContext
        ?? (await languageRoutesSnapshot()).context;
      const completedContext = clarificationDraft
        ? completedContextForDraft(clarificationDraft, session.messages, languageContext.supportLanguageTag)
        : null;
      if (draftMode && !completedContext) {
        throw new Error(uiText('addContext'));
      }
      const clarification = {
        operationId: newUuid(),
        languageContext,
        focus: focus ? {
          statement: focus.statement,
          distinguishingNotes: focus.distinguishingNotes,
          aspectLabel: focus.aspectLabel,
        } : null,
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
      };
      const result = draftMode
        ? await gateway.completeClarificationDraft({
            ...clarification,
            intakeId: clarificationDraft!.intakeId,
            context: completedContext!,
            confirmExpression: true,
          })
        : await gateway.confirmClarification({
            ...clarification,
            personalMeaningId: detail!.personalMeaningId,
          });
      setReviewOpen(false);
      commit({
        ...session,
        outcome: {
          meaningFocusId: result.meaningFocusId,
          personalMeaningAlignmentId: result.personalMeaningAlignmentId,
          senseConfirmed: true,
          expressionConfirmed: result.expressionConfirmed,
          confirmedAt: new Date().toISOString(),
        },
      });
      toast(result.expressionConfirmed ? uiText('meaningAndExpressionConfirmed') : uiText('meaningConfirmedExpressionStillPending'));
      if (draftMode) {
        onOpenConfirmedSense(
          (result as Awaited<ReturnType<typeof gateway.completeClarificationDraft>>).personalMeaningId,
          result.meaningFocusId ?? result.personalMeaningAlignmentId,
        );
      }
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
  const hasCompleteContext = !draftMode
    || Boolean(clarificationDraft?.context)
    || Boolean(session?.messages.some(
      (message) => message.role === 'learner' && message.body.trim(),
    ));
  const canConfirm = Boolean(
    working.sense
    && hasCompleteContext
    && (!draftMode || (working.expression && includeExpression)),
  ) && !busy;
  const canConfirmExpressionOnly = Boolean(
    working.expression && alignment?.expressionCandidates.length,
  ) && !busy;

  const body = !status.ok ? (
    <div className={classNames("pmw-error")} role="alert">
      <b>{uiText('unableToReadThisMaterial')}</b>
      <p>{status.error}</p>
    </div>
  ) : (!detail && !clarificationDraft) || !session ? (
    <div className={classNames("pmw-empty")}>{uiText('thisMaterialWasNotFound')}</div>
  ) : allConfirmed ? (
    <div className={classNames("pmw-done")}>
      <span className={classNames("pmw-done-mark")} aria-hidden="true">✓</span>
      <h2>{uiText('meaningConfirmed')}</h2>
      <p>{uiText('savedToYourMeanings')}</p>
      <div className={classNames("pmw-done-facts")}>
        {confirmedFocus && (
          <article><small>{uiText('focus')}</small><b>{confirmedFocus.statement}</b></article>
        )}
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
      <div className={classNames("pmw-done-actions")}>
        <button type="button" className={classNames("pmw-primary")} onClick={startAnotherThread}>
          {uiText('exploreAnotherAspectOfThisExperience')}</button>
        <button
          type="button"
          onClick={() => onOpenConfirmedSense(
            detail!.personalMeaningId,
            confirmedFocus?.meaningFocusId ?? alignment!.personalMeaningAlignmentId,
          )}
        >
          {uiText('viewConfirmedMeaning')}</button>
        <button type="button" onClick={onBack}>{uiText('backToMyContent')}</button>
      </div>
    </div>
  ) : (
    <>
      {materialOpen && (
        <section className={classNames("pmw-material")} aria-label={uiText('contextForThisConversation')}>
          {(detail?.materialBlocks ?? clarificationDraft!.materialBlocks.map((block, index) => ({
            anchorId: block.personalMediaObjectId ?? `draft-text-${index}`,
            kind: block.kind,
            bodyText: block.bodyText ?? null,
            personalMediaObjectId: block.personalMediaObjectId ?? null,
            inlineDataUrl: null,
            inlineMimeType: null,
            revision: 1,
          }))).map((block) => (
            block.kind === 'image' ? (
              <img
                key={block.anchorId}
                src={block.inlineDataUrl ?? getMedia(block.personalMediaObjectId ?? '')?.dataUrl ?? ''}
                alt={uiText('contextImage')}
              />
            ) : (
              <p key={block.anchorId}>{block.bodyText}</p>
            )
          ))}
          {(detail?.familiarAnchors ?? (clarificationDraft?.familiarExpression ? [{
            anchorId: clarificationDraft.intakeId,
            surfaceForm: clarificationDraft.familiarExpression,
          }] : [])).map((anchor) => (
            <p key={anchor.anchorId} className={classNames("pmw-material-familiar")}>
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

      <div className={classNames("pmw-transcript")} ref={transcriptRef} aria-live="polite">
        {session.messages.map((item) => (
          <div key={item.messageId} className={classNames(`pmw-message is-${item.role}`)}>
            {item.role === 'assistant' && (
              <span className={classNames("pmw-avatar")} aria-hidden="true">✦</span>
            )}
            <div><p>{item.body}</p></div>
          </div>
        ))}
        {busy && (
          <div
            className={classNames(`pmw-message is-assistant${streamingText ? ' is-streaming' : ' is-thinking'}`)}
          >
            <span className={classNames("pmw-avatar")} aria-hidden="true">✦</span>
            <div>
              {streamingText ? (
                <p>{streamingText}<i className={classNames("pmw-caret")} aria-hidden="true" /></p>
              ) : (
                <p><i /><i /><i /></p>
              )}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className={classNames("pmw-inline-error")} role="alert">
          <span>{error}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runTurn(session, undefined, lastModeRef.current)}
          >
            {uiText('retry')}</button>
        </div>
      )}

      <div className={classNames("pmw-dock-bar")}>
        <div className={classNames("pmw-dock-chips")}>
          <button
            type="button"
            className={classNames(`pmw-dock-chip is-${focusStatus.tone}`)}
            onClick={() => setPanelOpen(true)}
            aria-label={uiText('viewFocus')}
          >
            <small>{uiText('focus')}</small>
            <b>{working.focus ? working.focus.statement : focusStatus.label}</b>
          </button>
          <button
            type="button"
            className={classNames(`pmw-dock-chip is-${senseStatus.tone}`)}
            onClick={() => setPanelOpen(true)}
            aria-label={uiText('viewMeaning')}
          >
            <small>{uiText('meaning2')}</small>
            <b>{working.sense ? working.sense.coreMeaningFocus : senseStatus.label}</b>
          </button>
          <button
            type="button"
            className={classNames(`pmw-dock-chip is-${expressionStatus.tone}`)}
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

        <div className={classNames("pmw-dock-actions")}>
          <button
            type="button"
            className={classNames("pmw-dock-organize")}
            disabled={busy}
            onClick={() => void runTurn(session, undefined, 'consolidate')}
            title={uiText('summarizeTheCurrentUnderstanding')}
          >
            {uiText('summarize')}</button>
          {senseConfirmed ? (
            alignment!.expressionCandidates.length === 0 ? null : (
              <button
                type="button"
                className={classNames("pmw-dock-confirm is-ready")}
                disabled={!canConfirmExpressionOnly}
                onClick={() => void confirmExpressionOnly()}
              >
                {uiText('confirmExpression')}</button>
            )
          ) : (
            <button
              type="button"
              className={classNames(`pmw-dock-confirm${session.readyToConfirm ? ' is-ready' : ''}`)}
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

      <form className={classNames("pmw-composer")} onSubmit={submit}>
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
        <SensaOverlayLayout variant="sheet" mode="container" measure="standard" className="z-20" label={uiText('currentUnderstanding')} onDismiss={() => setPanelOpen(false)} dismissOnBackdrop regions={{
          header: <div className={classNames("pmw-overlay-header")}>
              <h2>{uiText('currentUnderstanding')}</h2>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label={uiText('close')}>×</button>
            </div>,
          primary: <div className={classNames("pmw-preview-body")}>
              {senseConfirmed && (
                <p className={classNames("pmw-panel-note")}>
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
                <p className={classNames("pmw-panel-empty")}>{uiText('tellUsMoreAboutYourContextOr')}</p>
              )}
            </div>,
          controls: <div className={classNames("pmw-preview-controls")}>
              <button
                type="button"
                className={classNames("pmw-primary")}
                disabled={!canConfirm}
                onClick={() => {
                  setPanelOpen(false);
                  setIncludeExpression(Boolean(working.expression));
                  setReviewOpen(true);
                }}
              >
                {uiText('reviewAndConfirm')}</button>
              <button type="button" onClick={() => setPanelOpen(false)}>{uiText('keepTalking')}</button>
            </div>,
        }} />
      )}

      {reviewOpen && working.sense && (
        <SensaOverlayLayout variant="sheet" mode="container" measure="standard" className="z-20" labelledBy="pmw-review-title" onDismiss={() => setReviewOpen(false)} dismissOnBackdrop regions={{
          header: <div className={classNames("pmw-overlay-header")}>
              <h2 id="pmw-review-title">{uiText('confirmTheseDetails')}</h2>
              <button type="button" onClick={() => setReviewOpen(false)} aria-label={uiText('keepTalking')}>×</button>
            </div>,

          primary: <div className={classNames("pmw-review-body")}>
              {working.focus && (
                <article className={classNames("pmw-review-card")}>
                  <header><small>{uiText('focus')}</small><em>{uiText('confirmTogether')}</em></header>
                  <b>{working.focus.statement}</b>
                </article>
              )}

              <article className={classNames("pmw-review-card")}>
                <header><small>{uiText('meaning2')}</small><em>{uiText('confirmTogether')}</em></header>
                <b>{working.sense.coreMeaningFocus}</b>
              </article>

              <article className={classNames(`pmw-review-card${includeExpression ? '' : ' is-deferred'}`)}>
                <header>
                  <small>{uiText('targetExpression')}{candidatesList.length > 1 ? uiText('candidateCount', { count: candidatesList.length }) : ''}</small>
                  {working.expression ? (
                    <label className={classNames("pmw-review-toggle")}>
                      <input
                        type="checkbox"
                        checked={includeExpression}
                        disabled={draftMode}
                        onChange={(event) => setIncludeExpression(event.target.checked)}
                      />
                      <span>{uiText('confirmTogether')}</span>
                    </label>
                  ) : <em>{uiText('noCandidatesYet')}</em>}
                </header>
                {working.expression ? (
                  <div className={classNames("pmw-review-candidates")}>
                    {candidatesList.map((cand) => {
                      const isChosen = (working.expression?.surfaceForm ?? candidatesList[0]?.surfaceForm) === cand.surfaceForm;
                      return (
                        <button
                          key={cand.surfaceForm}
                          type="button"
                          className={classNames(`pmw-review-cand-item${isChosen ? ' is-chosen' : ''}`)}
                          onClick={() => editTrack('expression', cand)}
                        >
                          <span className={classNames("pmw-review-radio")} aria-hidden="true">{isChosen ? '✓' : ''}</span>
                          <div className={classNames("pmw-review-cand-copy")}>
                            <div>
                              <b className={classNames("pmw-surface")}>{cand.surfaceForm}</b>
                              <span className={classNames("pmw-expr-tag")}>{expressionTypeLabels[cand.expressionType]}</span>
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
            </div>,

          controls: <div className={classNames("pmw-review-controls")}>
              <p className={classNames("pmw-review-consequence")}>
                {uiText('confirmationSavesThisToYourMeanings')}{working.expression && includeExpression ? uiText('andConnectsTheExpression') : uiText('youCanConnectAnExpressionLater')}。
              </p>
              {error && <p className={classNames("pmw-review-error")} role="alert">{error}</p>}
              <div className={classNames("pmw-review-actions")}>
                <button
                  type="button"
                  className={classNames("pmw-primary")}
                  disabled={busy}
                  onClick={() => void confirm()}
                >
                  {busy ? uiText('confirming') : uiText('confirm')}
                </button>
                <button type="button" disabled={busy} onClick={() => setReviewOpen(false)}>
                  {uiText('keepTalking2')}</button>
              </div>
            </div>,
        }} />
      )}
    </>
  );

  return <MeaningWorkspaceFrame active={active} onBack={onBack} materialOpen={materialOpen} onToggleMaterial={()=>setMaterialOpen(v=>!v)} screenRef={screenRef}>{body}</MeaningWorkspaceFrame>;
};

/** One existing workspace frame for both persisted and preview controllers. */
function MeaningWorkspaceFrame({active,onBack,materialOpen,onToggleMaterial,screenRef,children,title}:{active:boolean;onBack:()=>void;materialOpen:boolean;onToggleMaterial:()=>void;screenRef?:import('react').Ref<HTMLElement>;title?:string;children:import('react').ReactNode}){
 return <SensaDetailWorkspaceLayout
  ref={screenRef}
  className={classNames(`screen pmw-screen${active?' active':''}`, '#s-personal-meaning')}
  id="s-personal-meaning"
  data-anim="slide"
  presentation="panel"
  regions={{
   header: <div className={classNames('content-nav pmw-nav')}>
    <button className={classNames('content-nav-back')} onClick={onBack} aria-label={uiText('backToMyContent2')}><svg className={classNames('icon')}><use href="#i-chev-l"/></svg></button>
    <h1>{title??uiText('clarifyYourMeaning')}</h1>
    <button type="button" className={classNames(`pmw-material-toggle${materialOpen?' is-open':''}`)} onClick={onToggleMaterial} aria-expanded={materialOpen}>{uiText('context')}</button>
   </div>,
   primary: <div className={classNames('pmw-shell')}>{children}</div>,
  }}
 />;
}
function ConnectedMeaningConversation({active,onBack,conversation:c,learningControls}:PersonalMeaningDetailScreenProps & {conversation:MeaningConversationController}){
 useTranslation();
 const [materialOpen,setMaterialOpen]=useState(false),[editing,setEditing]=useState(false);
 const transcript=useRef<HTMLDivElement>(null);
 useEffect(()=>{transcript.current?.scrollTo({top:transcript.current.scrollHeight});},[c.messages.length,c.busy]);
 const candidate=c.candidate;
 if(c.accepted&&candidate)return <MeaningWorkspaceFrame title={localFlowText('savedExpression')} active={active} onBack={onBack} materialOpen={false} onToggleMaterial={()=>setMaterialOpen(v=>!v)}>
  <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
   <article className="space-y-5 py-5" aria-label={localFlowText('expressionDetails')}>
    <div><p className="text-sm text-fg-secondary">{uiText('expression')}</p><h2 className="mt-2 text-3xl font-semibold">{candidate.expression}</h2></div>
    <div><h3 className="text-sm text-fg-secondary">{uiText('meaning2')}</h3><p className="mt-2 whitespace-pre-wrap leading-7">{candidate.meaning}</p></div>
    <div><h3 className="text-sm text-fg-secondary">{localFlowText('context')}</h3><p className="mt-2 whitespace-pre-wrap leading-7">{candidate.context}</p>{c.images?.map(image=><img key={image.id} src={image.dataUrl} alt={image.name} className="mt-3 max-h-64 max-w-full rounded-control object-contain"/>)}</div>
   </article>
   {c.onUpdateContext&&<button className="mb-4 rounded-control border border-border-strong bg-surface-subtle px-4 py-3 focus-visible:outline-2 focus-visible:outline-focus" onClick={()=>setEditing(v=>!v)}>{localFlowText(editing?'cancelEdit':'editContext')}</button>}
   {editing&&<ExpressionChatInput busy={c.busy} initialText={candidate.context} inputLabel={localFlowText('context')} inputHint={localFlowText('context')} initialImages={c.images??[]} submitLabel={localFlowText('saveContext')} onSend={async(text,images)=>{await c.onUpdateContext!(text,images);setEditing(false);}}/>}
   {c.notice&&<p role="status">{c.notice}</p>}
   {learningControls}
   <details className="mt-5" open={materialOpen||undefined}><summary className="cursor-pointer py-3 text-sm text-fg-secondary">{localFlowText('conversationHistory')}</summary><div className="space-y-4 text-sm leading-7"><p>{c.material}</p>{c.messages.map((m,i)=><div key={i}><p>{m.body}</p>{m.images?.map(image=><img key={image.id} src={image.dataUrl} alt={image.name} className="max-h-64 max-w-full"/>)}</div>)}</div></details>
  </div>
 </MeaningWorkspaceFrame>;
 return <MeaningWorkspaceFrame title={localFlowText('findExpression')} active={active} onBack={onBack} materialOpen={materialOpen} onToggleMaterial={()=>setMaterialOpen(v=>!v)}>
  {materialOpen&&<section className={classNames('pmw-material')} aria-label={uiText('contextForThisConversation')}><p>{c.material}</p></section>}
  <p className="px-5 text-xs">{c.source?.url&&<a href={c.source.url} target="_blank" rel="noreferrer">{localFlowText('viewSource')}{c.source.title||c.source.url}</a>}</p>

  <div ref={transcript} className={classNames('pmw-transcript')} aria-live="polite">
   {(c.material||c.images?.length)?<div className={classNames('pmw-message is-learner')}><div>{c.material&&<p>{c.material}</p>}{c.images?.map(image=><img key={image.id} src={image.dataUrl} alt={image.name} className="mt-2 max-h-64 max-w-full rounded-control object-contain"/>)}</div></div>:<div className="mx-auto max-w-md px-6 py-10 text-center"><h2 className="text-lg font-medium">{localFlowText('chatWelcome')}</h2><p className="mt-3 text-sm leading-6 text-fg-secondary">{localFlowText('chatWelcomeHint')}</p></div>}
   {c.messages.map((m,i)=><div key={i} className={classNames(`pmw-message is-${m.role}`)}>{m.role==='assistant'&&<span className={classNames('pmw-avatar')} aria-hidden="true">✦</span>}<div>{m.body&&<p>{m.body}</p>}{m.images?.map(image=><img key={image.id} src={image.dataUrl} alt={image.name} className="mt-2 max-h-64 max-w-full rounded-xl object-contain"/>)}</div></div>)}
   {c.busy&&<div className={classNames('pmw-message is-assistant is-thinking')}><span className={classNames('pmw-avatar')} aria-hidden="true">✦</span><div><p role="status">{localFlowText('clarificationWorking')}</p></div></div>}
   {c.accepted&&<div className={classNames('pmw-done')}><span className={classNames('pmw-done-mark')}>✓</span><h2>{localFlowText('meaningConfirmed')}</h2><p>{localFlowText('savedLocally')}</p></div>}
  </div>
  {c.accepted&&learningControls}
  {c.notice&&<div className={classNames('pmw-inline-error')} role="status">{c.notice}</div>}
  {candidate&&!c.accepted&&<section className="mx-4 mb-3 rounded-card border border-border-subtle bg-surface-panel p-4 sm:mx-6" aria-label={localFlowText('expressionCandidate')}>
   <h2 className="text-xl font-semibold">{candidate.expression}</h2><p className="mt-2 text-sm">{candidate.meaning}</p>
   <p className="mt-3 text-sm leading-6 text-fg-secondary">{localFlowText('myContext')}{candidate.context}</p>
   <button className="mt-4 min-h-11 rounded-control bg-action-primary px-5 text-sm text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40" disabled={c.busy} onClick={()=>void c.onConfirm().catch(()=>{})}>{localFlowText('saveExpression')}</button>
  </section>}
  <div className="mx-6 mb-2 flex gap-3">
   {c.canContinue&&!c.accepted&&<button className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface-subtle px-4 text-sm text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40" disabled={c.busy} onClick={()=>void c.onContinue()}>{localFlowText('continueConversation')}</button>}
   {c.busy&&<button className={classNames('pmw-dock-organize')} onClick={c.onStop}>{localFlowText('stopRequest')}</button>}
  </div>
  {!c.accepted&&<ExpressionChatInput busy={c.busy} onSend={c.onSend}/>}
 </MeaningWorkspaceFrame>;
}

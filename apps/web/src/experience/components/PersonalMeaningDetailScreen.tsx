import '../../i18n/contentResources';
import {ExpressionChatInput} from './ExpressionChatInput';
import type {ConversationImage} from '../../data/library/conversationImages';
import {localFlowNotice,localFlowText} from '../../i18n/localFlowText';
import {sameClarificationSource,ClarificationSourceChangedError} from '../personalMeaningJourney/clarificationSource';
import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
import { classNames } from '../ui/primitives';
import { SensaDetailWorkspaceLayout } from '../ui/SensaPageLayouts';
import { SensaOverlayLayout } from '../ui/SensaComponents';
import './PersonalMeaningDetailScreen.css';
import {PersonalMeaningGovernance} from './PersonalMeaningGovernance';
/**
 * The AI clarification workspace.
 *
 * One conversation, one result panel, one confirmation. The conversation is the
 * main surface; the panel beside it accumulates what the two of you worked out
 * — it is a basket, not a progress bar, and it never shows "已确认" while the
 * thread is still open.
 *
 * Every learner turn runs the same bounded teacher flow. The agent replies
 * naturally, then privately structures a ready proposal for learner review.
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
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  useJourneyDetail,
  useJourneyGateway,
  type ClarificationDraftView,
  type JourneyAlignmentView,
  type JourneyDetailView,
  type JourneyFocusView,
} from '../personalMeaningJourney';
import { newUuid } from '../personalMeaningJourney/ids';
import { createRealSemanticAgent } from '../personalMeaningJourney/realSemanticAgent';
import {intakeSourceLabel,intakeSourceUrl} from '../personalMeaningJourney/sourcePresentation';
import type {JourneyMaterialBlockView} from '../personalMeaningJourney/types';
import {completedContextForDraft} from '../personalMeaningJourney/clarificationContext';
import { beginAgentBusinessTrace } from '../../observability/agentTrace';
import { languageRoutesSnapshot } from '../../data/library/language';
import {
  loadLatestSemanticAgentSession,
  loadSemanticAgentSession,
  newSemanticAgentSession,
  saveSemanticAgentSession,
  type SemanticAgentSessionPersistenceIssue,
} from '../personalMeaningJourney/semanticAgentSession';
import {SemanticAgentSessionPersistenceNotice} from './SemanticAgentSessionPersistenceNotice';
import {
  getMedia,
  MediaStoreFullError,
  removeMedia,
  stageMedia,
  storeImageFile,
  useMediaStoreVersion,
} from '../personalMeaningJourney/mediaStore';
import {Camera, ImagePlus} from 'lucide-react';
import {
  MAX_SCENE_IMAGES,
  useSceneImageInput,
} from './useSceneImageInput';
import {SceneImageAttemptStatus} from './SceneImageAttemptStatus';
import type {
  AgentExpressionCandidate,
  AgentContextCandidate,
  AgentFocusCandidate,
  AgentSenseCandidate,
  SemanticAgentMaterial,
  SemanticAgentMessage,
  SemanticAgentSession,
  WorkingSetTrack,
} from '../personalMeaningJourney/semanticAgent';
import {
  type SensaExpressionBindingRelation,
  type SensaExpressionType,
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
 governanceControls?:import('react').ReactNode;
 learningControls?:import('react').ReactNode;
 alignmentLearningControls?:(detail:JourneyDetailView,alignment:JourneyAlignmentView)=>import('react').ReactNode;
 conversation?:MeaningConversationController;
  active: boolean;
  personalMeaningId: string | null;
  onBack: () => void;
  onConversationCreated?: (intakeId: string) => void;
  onOpenConfirmedSense: (personalMeaningId: string, meaningFocusId: string) => void;
  toast: (message: string) => void;
}

const semanticAgent = createRealSemanticAgent();
const SEMANTIC_POLICY_VERSION = 'sensa-semantic-policy-react-v1';

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
  mediaReferenceIds: string[] = [],
): SemanticAgentMessage => ({
  messageId: newUuid(),
  role,
  body,
  ...(mediaReferenceIds.length ? { mediaReferenceIds } : {}),
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

const ContextCard = ({
  context,
  editing,
  onEdit,
  onChange,
  onDone,
}: {
  context: AgentContextCandidate;
  editing: boolean;
  onEdit: () => void;
  onChange: (next: AgentContextCandidate) => void;
  onDone: () => void;
}) => (
  <article className={classNames("pmw-card")}>
    <header>
      <small>{uiText('context')}</small>
      {!editing && <button type="button" onClick={onEdit}>{uiText('edit')}</button>}
    </header>
    {editing ? (
      <div className={classNames("pmw-edit")}>
        <textarea
          value={context.summary}
          rows={3}
          onChange={(event) => onChange({ ...context, summary: event.target.value })}
        />
        <button type="button" className={classNames("pmw-edit-done")} onClick={onDone}>{uiText('done')}</button>
      </div>
    ) : (
      <>
        <b className={classNames("pmw-card-lead")}>{context.summary}</b>
        {context.salientDetails[0] && (
          <p className={classNames("pmw-card-note")}>{context.salientDetails[0]}</p>
        )}
      </>
    )}
  </article>
);

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

export const PersonalMeaningDetailScreen=(props:PersonalMeaningDetailScreenProps)=>{
 useMediaStoreVersion();
 const {t}=useTranslation(),snapshot=useJourneyDetail(props.personalMeaningId);
 const [governanceNotice,setGovernanceNotice]=useState('');
 const detail=snapshot.detail;
 const actions=detail?<PersonalMeaningGovernance key={detail.personalMeaningId} detail={detail} disabled={!snapshot.status.ok||!!snapshot.status.loading} readCurrent={snapshot.readCurrent} reload={snapshot.reload} onNotice={setGovernanceNotice}/>:null;
 const controls=<>{actions}{governanceNotice&&<p role="alert" className="mb-4 text-sm text-feedback-danger">{governanceNotice.startsWith('localFlow.')?localFlowNotice(governanceNotice):t(governanceNotice)}<button className="ml-3 min-h-11 underline" onClick={()=>{setGovernanceNotice('');snapshot.reload();}}>{t('meaningGovernance.retryRead')}</button></p>}</>;
 if(props.personalMeaningId&&!snapshot.status.ok)return <MeaningWorkspaceFrame active={props.active} onBack={props.onBack} materialOpen={false} onToggleMaterial={()=>{}} showMaterialToggle={false}><div role="alert" className="px-5 py-6"><p>{localFlowText('progressReadFailed')}</p>{controls}<button className="min-h-11 underline" onClick={snapshot.reload}>{t('meaningGovernance.retryRead')}</button></div></MeaningWorkspaceFrame>;
 if(detail?.status==='deleted')return <MeaningWorkspaceFrame active={props.active} onBack={props.onBack} materialOpen={false} onToggleMaterial={()=>{}} title={t('meaningGovernance.deleted')} showMaterialToggle={false}>
  <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
   <article className="mb-5 space-y-4" aria-label={localFlowText('expressionDetails')}>
    <h2 className="text-3xl font-semibold">{detail.directAlignments[0]?.confirmedBindings[0]?.surfaceForm??detail.displayLabel}</h2>
    {[...detail.directAlignments,...detail.focuses.flatMap(focus=>focus.alignment?[focus.alignment]:[])].map(alignment=><p key={alignment.personalMeaningAlignmentId}>{alignment.coreMeaningFocus}</p>)}
    {detail.materialBlocks.map(block=>{
     const image=block.inlineDataUrl??(block.personalMediaObjectId?getMedia(block.personalMediaObjectId)?.dataUrl:null);
     return <div key={block.anchorId}>{block.bodyText&&<p className="whitespace-pre-wrap leading-7">{block.bodyText}</p>}{image&&<img src={image} alt={localFlowText('context')} className="max-h-64 max-w-full object-contain"/>}</div>;
    })}
    {(detail.capturedSources??detail.materialBlocks.flatMap(block=>block.capturedSource?[{anchorId:block.anchorId,...block.capturedSource}]:[])).map(captured=><CapturedMaterialSource key={captured.anchorId} captured={captured} currentText={detail.materialBlocks.flatMap(block=>block.bodyText?[block.bodyText]:[]).join('\n\n')}/>)}
   </article>{controls}
  </div>
 </MeaningWorkspaceFrame>;
 const governed={...props,governanceControls:controls};
 return props.conversation
  ? <ConnectedMeaningConversation {...governed} conversation={props.conversation}/>
  : !props.personalMeaningId && props.onConversationCreated
    ? <NewMeaningConversationScreen {...props} onConversationCreated={props.onConversationCreated}/>
    : <PreviewPersonalMeaningDetailScreen {...governed}/>;
};

const persistPreparedImages = async (images: ConversationImage[]): Promise<string[]> => {
  const stored: string[] = [];
  try {
    for (const image of images) {
      const payload = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1);
      stageMedia({
        mediaId: image.id,
        mediaKind: 'image',
        mimeType: 'image/jpeg',
        dataUrl: image.dataUrl,
        sizeBytes: Math.round(payload.length * 0.75),
        createdAt: new Date().toISOString(),
      });
      stored.push(image.id);
    }
    return stored;
  } catch (cause) {
    await Promise.allSettled(stored.map(removeMedia));
    throw cause;
  }
};

function CapturedMaterialSource({captured,currentText}:{captured:NonNullable<JourneyMaterialBlockView['capturedSource']>;currentText:string|null}){
  const source=captured.source,href=source?intakeSourceUrl(source):null;
  return <details className="mt-3 break-words text-body-support text-fg-secondary">
    <summary className="cursor-pointer text-metadata">{source?intakeSourceLabel(source):localFlowText('viewSource')}</summary>
    {captured.text&&captured.text!==currentText&&<p className="mt-2 whitespace-pre-wrap leading-7">{captured.text}</p>}
    {href&&source&&<a href={href} target="_blank" rel="noreferrer">{localFlowText('viewSource')}{source.title??source.url}</a>}
  </details>;
}

/**
 * The checkpoint presentation for an accepted tuple: the expression is now
 * the object being viewed, not another turn in the clarification Agent.
 */
const ConfirmedExpressionDetail = ({
  detail,
  focus,
  alignment,
  session,
  contextText,
  contextImages,
  busy,
  error,
  onSaveContext,
  learningControls,
}: {
  detail: JourneyDetailView;
  focus: JourneyFocusView | null;
  alignment: JourneyAlignmentView;
  session: SemanticAgentSession;
  contextText: string;
  contextImages: ConversationImage[];
  busy: boolean;
  error: string;
  onSaveContext: (text: string, images: ConversationImage[],expectedRevision:number) => Promise<void>;
  learningControls?:import('react').ReactNode;
}) => {
  const [editing, setEditing] = useState<{revision:number;text:string;images:ConversationImage[]}|null>(null);
  const expression = alignment.confirmedBindings[0]!;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <article className="space-y-5 py-5" aria-label={localFlowText('expressionDetails')}>
        <div>
          <p className="text-sm text-fg-secondary">{uiText('expression')}</p>
          <h2 className="mt-2 text-3xl font-semibold">{expression.surfaceForm}</h2>
          <p className="mt-2 text-sm text-fg-tertiary">
            {expressionTypeLabels[expression.expressionType]} · {relationLabels[expression.relation]} ·{' '}
            {coverageLabels[expression.semanticCoverage]}
          </p>
        </div>
        {focus && (
          <div>
            <h3 className="text-sm text-fg-secondary">{uiText('focus')}</h3>
            <p className="mt-2 whitespace-pre-wrap leading-7">{focus.statement}</p>
          </div>
        )}
        <div>
          <h3 className="text-sm text-fg-secondary">{uiText('meaning2')}</h3>
          <p className="mt-2 whitespace-pre-wrap leading-7">{alignment.coreMeaningFocus}</p>
        </div>
        <div>
          <h3 className="text-sm text-fg-secondary">{localFlowText('context')}</h3>
          {contextText && <p className="mt-2 whitespace-pre-wrap leading-7">{contextText}</p>}
          {contextImages.map((image) => (
            <img
              key={image.id}
              src={image.dataUrl}
              alt={image.name}
              className="mt-3 max-h-64 max-w-full rounded-control object-contain"
            />
          ))}
          {(detail.capturedSources??detail.materialBlocks.flatMap(block=>block.capturedSource?[{anchorId:block.anchorId,...block.capturedSource}]:[])).map(captured=><CapturedMaterialSource key={captured.anchorId} captured={captured} currentText={contextText}/>)}
        </div>
      </article>
      {learningControls}
      <button
        type="button"
        disabled={busy}
        className="mb-4 rounded-control border border-border-strong bg-surface-subtle px-4 py-3 focus-visible:outline-2 focus-visible:outline-focus"
        onClick={() => setEditing(value=>value?null:{revision:detail.revision,text:contextText,images:contextImages})}
      >
        {localFlowText(editing ? 'cancelEdit' : 'editContext')}
      </button>
      {editing && (
        <ExpressionChatInput
          key={`context-${editing.revision}`}
          busy={busy}
          initialText={editing.text}
          inputLabel={localFlowText('context')}
          inputHint={localFlowText('context')}
          initialImages={editing.images}
          imageUse="scene"
          maxImages={MAX_SCENE_IMAGES}
          submitLabel={localFlowText('saveContext')}
          onSend={async (text, images) => {
            await onSaveContext(text, images,editing.revision);
            setEditing(null);
          }}
        />
      )}
      {error && <p className="mb-4 text-sm text-feedback-danger" role="alert">{localFlowNotice(error)}</p>}
      {session.messages.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer py-3 text-sm text-fg-secondary">
            {localFlowText('conversationHistory')}
          </summary>
          <div className="space-y-4 text-sm leading-7">
            {session.messages.map((item) => (
              <div key={item.messageId}>
                {item.body && <p>{item.body}</p>}
                {item.mediaReferenceIds?.map((mediaId) => {
                  const media = getMedia(mediaId);
                  return media
                    ? <img key={mediaId} src={media.dataUrl} alt={localFlowText('contextImage')} className="max-h-64 max-w-full" />
                    : null;
                })}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};

/** Empty Sensa-native entry. Nothing enters Inbox until the first message. */
const NewMeaningConversationScreen = ({
  active,
  onBack,
  onConversationCreated,
}: PersonalMeaningDetailScreenProps & { onConversationCreated: (intakeId: string) => void }) => {
  useTranslation();
  const gateway = useJourneyGateway();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const begin = async (body: string, images: ConversationImage[]) => {
    setBusy(true);
    setError('');
    let mediaIds: string[] = [];
    let draftCreated = false;
    try {
      mediaIds = await persistPreparedImages(images);
      const result = await gateway.createClarificationDraft({
        operationId: newUuid(),
        blocks: [
          ...(body.trim() ? [{ kind: 'text' as const, bodyText: body.trim() }] : []),
          ...mediaIds.map((personalMediaObjectId) => ({
            kind: 'image' as const,
            personalMediaObjectId,
          })),
        ],
        startingPoint: null,
      });
      draftCreated = true;
      const session = newSemanticAgentSession(result.intakeId, newUuid());
      session.messages = [message('learner', body.trim(), mediaIds)];
      await saveSemanticAgentSession(session);
      onConversationCreated(result.intakeId);
    } catch (cause) {
      if (!draftCreated) await Promise.allSettled(mediaIds.map(removeMedia));
      setError(cause instanceof Error ? cause.message : uiText('unableToContinueThisConversationPleaseRetry'));
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  return (
    <MeaningWorkspaceFrame
      active={active}
      onBack={onBack}
      materialOpen={false}
      onToggleMaterial={() => undefined}
      title={localFlowText('sensaConversation')}
      showMaterialToggle={false}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-end">
        <div className="mx-auto max-w-lg px-6 py-12 text-center">
          <span className={classNames('pmw-avatar mx-auto mb-5')} aria-hidden="true">✦</span>
          <h2 className="text-xl font-medium">{localFlowText('chatWelcome')}</h2>
          <p className="mt-3 text-sm leading-6 text-fg-secondary">{localFlowText('chatWelcomeHint')}</p>
        </div>
        {error && <div className={classNames('pmw-inline-error')} role="alert">{localFlowNotice(error)}</div>}
        <ExpressionChatInput busy={busy} imageUse="scene" maxImages={MAX_SCENE_IMAGES} onSend={begin}/>
      </div>
    </MeaningWorkspaceFrame>
  );
};
const PreviewPersonalMeaningDetailScreen = ({
  active,
  personalMeaningId,
  onBack,
  onConversationCreated,
  toast,
  alignmentLearningControls,
  governanceControls,
}: PersonalMeaningDetailScreenProps) => {
  useTranslation();
  const gateway = useJourneyGateway();
  const { detail, status,reload,draft:clarificationDraft,source,readCurrent } = useJourneyDetail(personalMeaningId);
  const clarificationMaterial = detail
    ? materialFor(detail)
    : clarificationDraft ? materialForDraft(clarificationDraft) : null;
  const draftMode = !detail && clarificationDraft !== null;
  const screenRef = useRef<HTMLElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const openedThread = useRef<string | null>(null);
  const turnAbortRef = useRef<AbortController | null>(null);
  const turnLock=useRef(false);
  const streamFrameRef = useRef<number | null>(null);
  const streamTextRef = useRef('');
  const [session, setSession] = useState<SemanticAgentSession | null>(null);
  const [sessionPersistenceIssue, setSessionPersistenceIssue] = useState<SemanticAgentSessionPersistenceIssue | null>(null);
  const [busy, setBusy] = useState(false);
  const [streamingAssistant, setStreamingAssistant] = useState('');
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState('');
  const [materialOpen, setMaterialOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [includeExpression, setIncludeExpression] = useState(true);
  const [editingTrack, setEditingTrack] = useState<WorkingSetTrack | null>(null);
  const readUnavailable=!!status.loading||!status.ok;

  useEffect(() => {
    if (!personalMeaningId) {
      setSession(null);
      setSessionPersistenceIssue(null);
      return;
    }
    const loaded = loadSemanticAgentSession(personalMeaningId, newUuid);
    setSession(loaded.session);
    setSessionPersistenceIssue(
      loaded.persistence === 'conflict'
        ? 'conflict'
        : loaded.persistence === 'tab-only' ? 'storage' : null,
    );
    setPanelOpen(false);
    setReviewOpen(false);
    setEditingTrack(null);
    setError('');
    setImageError('');
    setStreamingAssistant('');
  }, [personalMeaningId]);

  const commit = useCallback(async (next: SemanticAgentSession) => {
    setSession(next);
    const result = await saveSemanticAgentSession(next);
    setSessionPersistenceIssue(result.saved ? null : result.reason);
    return result;
  }, []);

  // A pending structured turn must stop when its screen goes away.
  useEffect(() => () => {
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
    streamFrameRef.current = null;
  }, []);

  useEffect(() => {
    if (active) screenRef.current?.scrollTo({ top: 0 });
  }, [active, personalMeaningId]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: busy ? 'auto' : session?.messages.length ? 'smooth' : 'auto',
    });
  }, [busy, session?.messages.length, streamingAssistant]);

  /** The optional Focus this thread confirmed, if it needed one. */
  const sessionFocus: JourneyFocusView | null = useMemo(() => {
    const focusId = session?.outcome?.meaningFocusId;
    if (!detail || !focusId) return null;
    return detail.focuses.find((focus) => focus.meaningFocusId === focusId) ?? null;
  }, [detail, session?.outcome?.meaningFocusId]);

  const sessionAlignment = sessionFocus?.alignment
    ?? detail?.directAlignments.find(
      (candidate) => candidate.personalMeaningAlignmentId
        === session?.outcome?.personalMeaningAlignmentId,
    )
    ?? null;
  const persistedConfirmed = useMemo(() => {
    if (!detail) return null;
    for (const focus of detail.focuses) {
      if (focus.alignment?.confirmedBindings.length) {
        return { focus, alignment: focus.alignment };
      }
    }
    const direct = detail.directAlignments.find(
      (candidate) => candidate.confirmedBindings.length > 0,
    );
    return direct ? { focus: null, alignment: direct } : null;
  }, [detail]);
  const alignment = persistedConfirmed?.alignment ?? sessionAlignment ?? null;
  const confirmedFocus = persistedConfirmed?.focus ?? sessionFocus;
  const boundExpression = alignment?.confirmedBindings[0] ?? null;
  const allConfirmed = Boolean(boundExpression);
  const confirmedContextText = detail?.materialBlocks
    .filter((block) => block.kind === 'text' && block.bodyText)
    .map((block) => block.bodyText)
    .join('\n\n')
    ?? '';
  const confirmedContextImages = useMemo<ConversationImage[]>(() => (
    detail?.materialBlocks.flatMap((block) => {
      if (block.kind !== 'image') return [];
      const stored = block.personalMediaObjectId ? getMedia(block.personalMediaObjectId) : null;
      const dataUrl = block.inlineDataUrl ?? stored?.dataUrl;
      if (!dataUrl) return [];
      return [{
        id: block.personalMediaObjectId ?? newUuid(),
        name: localFlowText('contextImage'),
        dataUrl,
      }];
    }) ?? []
  ), [detail]);

  const runTurn = useCallback(async (
    baseSession: SemanticAgentSession,
    learnerBody?: string,
    learnerMediaReferenceIds: string[] = [],
  ) => {
    if (!clarificationMaterial||readUnavailable||turnLock.current) return false;
    turnLock.current=true;setBusy(true);setError('');
    if (baseSession.messages.length === 0) beginAgentBusinessTrace();
    const learnerMessage = learnerBody?.trim() || learnerMediaReferenceIds.length
      ? message('learner', learnerBody?.trim() ?? '', learnerMediaReferenceIds)
      : null;
    const messages = learnerMessage
      ? [...baseSession.messages, learnerMessage]
      : [...baseSession.messages];
    streamTextRef.current = '';
    setStreamingAssistant('');
    turnAbortRef.current?.abort();
    const controller = new AbortController();
    turnAbortRef.current = controller;
    try {
      const languageContext=baseSession.languageContext??(await languageRoutesSnapshot()).context;
      const current=await readCurrent();
      if(!current.source)throw new ClarificationSourceChangedError();
      const material=current.detail?materialFor(current.detail):current.draft?materialForDraft(current.draft):null;
      if(!material)throw new ClarificationSourceChangedError();
      if(controller.signal.aborted)throw controller.signal.reason??new DOMException('Aborted','AbortError');
      const waiting = { ...baseSession, messages,languageContext,readyToConfirm:false,proposalSource:current.source };
      const waitingPersistence = await commit(waiting);
      if (!waitingPersistence.saved && waitingPersistence.reason === 'conflict') return false;
      const result = await semanticAgent.turn({
        material,
        messages,
        workingSet: baseSession.workingSet,
        readyToConfirm: baseSession.readyToConfirm,
        learnerEditedTracks: baseSession.learnerEditedTracks,
        focusLocked: baseSession.focusLocked,
        languages:languageContext,
        signal: controller.signal,
        onAssistantText: (text) => {
          if (controller.signal.aborted || turnAbortRef.current !== controller) return;
          streamTextRef.current = text;
          if (streamFrameRef.current !== null) return;
          streamFrameRef.current = requestAnimationFrame(() => {
            streamFrameRef.current = null;
            if (!controller.signal.aborted && turnAbortRef.current === controller) {
              setStreamingAssistant(streamTextRef.current);
            }
          });
        },
      });
      if (controller.signal.aborted) {
        throw controller.signal.reason ?? new DOMException('Aborted', 'AbortError');
      }
      await commit({
        ...waiting,
        messages: [...messages, message('assistant', result.assistantMessage)],
        workingSet: result.workingSet,
        readyToConfirm: result.readyToConfirm,
        provenance: result.provenance,
        steps: [...waiting.steps, ...result.steps].slice(-40),
      });
      return true;
    } catch (cause) {
      setError(controller.signal.aborted
        ? localFlowText('requestStopped')
        : cause instanceof Error ? cause.message : uiText('unableToContinueThisConversationPleaseRetry'));
      return false;
    } finally {
      if (turnAbortRef.current === controller) {
        turnAbortRef.current = null;
        if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
        streamFrameRef.current = null;
        streamTextRef.current = '';
        setStreamingAssistant('');
        setBusy(false);
        turnLock.current=false;
      }
    }
  }, [clarificationMaterial, commit,readUnavailable,readCurrent]);

  const stopTurn = useCallback(() => {
    turnAbortRef.current?.abort();
  }, []);

  // Captured material opens in the same agent as an ordinary user message.
  // The agent decides whether to propose immediately or ask a natural question.
  useEffect(() => {
    if (!active || !clarificationMaterial || !session||readUnavailable) return;
    if (allConfirmed) return;
    if (session.messages.some((item) => item.role === 'assistant')
      || openedThread.current === session.threadId) return;
    openedThread.current = session.threadId;
    void runTurn(session);
  }, [active, allConfirmed, clarificationMaterial, runTurn, session,readUnavailable]);

  const sendConversationMessage = async (body: string, images: ConversationImage[]) => {
    if(readUnavailable)throw new Error(status.error??localFlowText('loadingSensa'));
    if (!session || busy || !clarificationMaterial) return;
    if (images.length === 0) {
      if(!await runTurn(session, body))throw new Error('clarification_turn_not_completed');
      return;
    }
    setBusy(true);
    setError('');
    let mediaIds:string[]=[];
    const attached = new Set<string>();
    try {
      mediaIds=await persistPreparedImages(images);
      for (const mediaId of mediaIds) {
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
        attached.add(mediaId);
      }
      if(!await runTurn(session,body,mediaIds))throw new Error('clarification_turn_not_completed');
    } catch (cause) {
      await Promise.allSettled(mediaIds.filter((id) => !attached.has(id)).map(removeMedia));
      setError(cause instanceof Error ? cause.message : uiText('unableToContinueThisConversationPleaseRetry'));
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const saveConfirmedContext = async (body: string, images: ConversationImage[],expectedRevision:number) => {
    if (!detail || !session || busy||readUnavailable)throw new Error(status.error??localFlowText('meaningChanged'));
    setBusy(true);
    setError('');
    const alreadyStored = new Set(
      images.filter((image) => getMedia(image.id)).map((image) => image.id),
    );
    let mediaIds: string[] = [];
    try {
      if(detail.revision!==expectedRevision)throw new Error('localFlow.meaningChanged');
      mediaIds = await persistPreparedImages(images);
      await gateway.reviseContext({
        operationId: newUuid(),
        personalMeaningId: detail.personalMeaningId,
        expectedRevision,
        blocks: [
          ...(body.trim() ? [{ kind: 'text' as const, bodyText: body.trim() }] : []),
          ...mediaIds.map((personalMediaObjectId) => ({
            kind: 'image' as const,
            personalMediaObjectId,
          })),
        ],
      });
      await commit({
        ...session,
        workingSet: {
          ...session.workingSet,
          context: {
            summary: body.trim(),
            salientDetails: session.workingSet.context?.salientDetails ?? [],
            unresolvedDetails: [],
            rationale: session.workingSet.context?.rationale ?? '',
          },
        },
      });
      toast(localFlowText('savedLocally'));
    } catch (cause) {
      await Promise.allSettled(mediaIds.filter((id) => !alreadyStored.has(id)).map(removeMedia));
      setError(cause instanceof Error ? cause.message : uiText('unableToContinueThisConversationPleaseRetry'));
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const editTrack = <T,>(track: WorkingSetTrack, value: T) => {
    if (!session) return;
    void commit({
      ...session,
      workingSet: { ...session.workingSet, [track]: value },
      learnerEditedTracks: session.learnerEditedTracks.includes(track)
        ? session.learnerEditedTracks
        : [...session.learnerEditedTracks, track],
    });
  };

  const materialImageCount = (detail?.materialBlocks ?? clarificationDraft?.materialBlocks ?? [])
    .filter((block) => block.kind === 'image').length;

  const addImageFile = useCallback(async (file: File) => {
    if(readUnavailable)throw new Error(status.error??localFlowText('loadingSensa'));
    const currentDetail = detail;
    const currentDraft = clarificationDraft;
    if (!currentDetail && !currentDraft) return;
    const mediaId = newUuid();
    try {
      await storeImageFile(mediaId, file, new Date().toISOString());
      if (currentDetail) {
        await gateway.addMaterialBlock({
          operationId: newUuid(),
          personalMeaningId: currentDetail.personalMeaningId,
          block: { kind: 'image', personalMediaObjectId: mediaId },
        });
      } else if (currentDraft) {
        await gateway.addClarificationMaterial(
          newUuid(),
          currentDraft.intakeId,
          { kind: 'image', personalMediaObjectId: mediaId },
        );
      }
    } catch (cause) {
      await removeMedia(mediaId).catch(() => undefined);
      throw cause;
    }
  }, [clarificationDraft, detail, gateway,readUnavailable,status.error]);

  const sceneImages = useSceneImageInput({
    disabled: busy||readUnavailable,
    imageCount: materialImageCount,
    onAddFile: addImageFile,
    onStart: () => setImageError(''),
    onRejected: () => setImageError(localFlowText('sceneImageRequirements')),
    onFailed: (failures) => setImageError(
      failures.some(({cause}) => cause instanceof MediaStoreFullError)
        ? localFlowText('sceneStorageFull')
        : uiText('unableToAddThisImage'),
    ),
    onComplete: ({statuses}) => {
      if (statuses.some(({state}) => state === 'added')) {
        toast(uiText('materialAddedForTheNextTurn'));
      }
    },
  });

  useEffect(() => {
    sceneImages.clearStatuses();
  }, [personalMeaningId, sceneImages.clearStatuses]);

  const imageInputUnavailable = busy || readUnavailable || sceneImages.processing;

  /** One atomic confirmation; Focus is included only when disambiguation needed it. */
  const confirm = async () => {
    if ((!detail && !clarificationDraft) || !session || busy) return;
    if(readUnavailable)return;
    const { context, focus, sense, expression } = session.workingSet;
    if (!session.readyToConfirm || !context || !sense || (draftMode && (!expression || !includeExpression))) return;
    setBusy(true);
    setError('');
    try {
      if(!sameClarificationSource(session.proposalSource,source))throw new ClarificationSourceChangedError();
      const languageContext = session.languageContext
        ?? (await languageRoutesSnapshot()).context;
      const completedContext = clarificationDraft
        ? completedContextForDraft(clarificationDraft, context, languageContext.supportLanguageTag,session.learnerEditedTracks.includes('context'))
        : null;
      if (draftMode && !completedContext) {
        throw new Error(uiText('addContext'));
      }
      const clarification = {
        operationId: newUuid(),
        source:session.proposalSource!,
        languageContext,
        focus: focus ? {
          statement: focus.statement,
          distinguishingNotes: focus.distinguishingNotes,
          aspectLabel: focus.aspectLabel,
        } : null,
        sense: {
          proposedSenseKey: sense.proposedSenseKey,
          ...(sense.reuseSense ? {reuseSense: sense.reuseSense} : {}),
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
            contextWordingSource:session.learnerEditedTracks.includes('context')?'learner_authored':'llm_suggested',
            confirmExpression: true,
          })
        : await gateway.confirmClarification({
            ...clarification,
            personalMeaningId: detail!.personalMeaningId,
          });
      setReviewOpen(false);
      await commit({
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
        onConversationCreated?.(
          (result as Awaited<ReturnType<typeof gateway.completeClarificationDraft>>).personalMeaningId,
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
    if (!detail || !session?.readyToConfirm || busy || !confirmedFocus || !alignment || !expression || !candidate) return;
    if(readUnavailable)return;
    setBusy(true);
    setError('');
    try {
      await gateway.confirmExpressionBinding({
        operationId: newUuid(),
        source:source!,
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
      await commit({
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

  const working = session?.workingSet ?? { context: null, focus: null, sense: null, expression: null, expressions: [] };
  const candidatesList = (working.expressions && working.expressions.length > 0)
    ? working.expressions
    : (working.expression ? [working.expression] : []);
  const senseConfirmed = Boolean(alignment);
  const sourceStale=!!session?.readyToConfirm&&!senseConfirmed&&!readUnavailable&&!sameClarificationSource(session.proposalSource,source);
  const contextStatus = trackTone(Boolean(working.context), senseConfirmed);
  const senseStatus = trackTone(Boolean(working.sense), senseConfirmed);
  const expressionStatus = trackTone(Boolean(working.expression), allConfirmed);
  const hasCompleteContext = !draftMode
    || Boolean(clarificationDraft?.context)
    || Boolean(session?.messages.some(
      (message) => message.role === 'learner' && message.body.trim(),
    ));
  const canConfirm = Boolean(
    session?.readyToConfirm
    && working.context
    &&
    working.sense
    && hasCompleteContext
    && (!draftMode || (working.expression && includeExpression)),
  ) && !busy&&!readUnavailable&&sameClarificationSource(session?.proposalSource,source);
  const canConfirmExpressionOnly = Boolean(
    session?.readyToConfirm && working.expression && alignment?.expressionCandidates.length,
  ) && !busy&&!readUnavailable&&!!source;

  const body = !status.ok ? (
    <div className={classNames("pmw-error")} role="alert">
      <b>{uiText('unableToReadThisMaterial')}</b>
      <p>{status.error}</p>
      <button type="button" onClick={reload}>{localFlowText('retryPreparation')}</button>
    </div>
  ) : status.loading&&!detail&&!clarificationDraft||(detail||clarificationDraft)&&!session ? (
    <div className={classNames("pmw-empty")} role="status" aria-busy="true">{localFlowText('loadingSensa')}</div>
  ) : (!detail && !clarificationDraft) || !session ? (
    <div className={classNames("pmw-empty")}>{uiText('thisMaterialWasNotFound')}</div>
  ) : allConfirmed && detail && alignment ? (
    <ConfirmedExpressionDetail
      detail={detail}
      focus={confirmedFocus}
      alignment={alignment}
      session={session}
      contextText={confirmedContextText}
      contextImages={confirmedContextImages}
      busy={busy||!!status.loading}
      error={error}
      onSaveContext={saveConfirmedContext}
      learningControls={<>{alignmentLearningControls?.(detail,alignment)}{governanceControls}</>}
    />
  ) : (
    <>
      {materialOpen && (
        <section
          className={classNames("pmw-material data-[dragging=true]:ring-2 data-[dragging=true]:ring-focus")}
          aria-label={uiText('contextForThisConversation')}
          aria-busy={sceneImages.processing || undefined}
          data-dragging={sceneImages.dragging}
          onDragOver={sceneImages.onDragOver}
          onDragLeave={sceneImages.onDragLeave}
          onDrop={sceneImages.onDrop}
          onPaste={sceneImages.onPaste}
        >
          <p
            role="status"
            aria-live="polite"
            className={sceneImages.dragging
              ? "pointer-events-none rounded-control border border-dashed border-border-strong bg-accent-soft p-4 text-center text-body-support text-fg-secondary"
              : "sr-only"}
          >
            {sceneImages.dragging
              ? localFlowText('dropImages')
              : sceneImages.processing ? localFlowText('readingImages') : ''}
          </p>
          {(detail?.materialBlocks ?? clarificationDraft!.materialBlocks.map((block, index) => ({
            anchorId: block.personalMediaObjectId ?? `draft-text-${index}`,
            kind: block.kind,
            bodyText: block.bodyText ?? null,
            personalMediaObjectId: block.personalMediaObjectId ?? null,
            inlineDataUrl: null,
            inlineMimeType: null,
            revision: 1,
          }))).map((block:JourneyMaterialBlockView) => (
            block.kind === 'image' ? (
              <img
                key={block.anchorId}
                src={block.inlineDataUrl ?? getMedia(block.personalMediaObjectId ?? '')?.dataUrl ?? ''}
                alt={uiText('contextImage')}
              />
            ) : (
              <div key={block.anchorId}>
                <p>{block.bodyText}</p>
                {block.capturedSource&&<CapturedMaterialSource captured={block.capturedSource} currentText={block.bodyText}/>}
              </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={imageInputUnavailable || materialImageCount >= MAX_SCENE_IMAGES}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus size={17} aria-hidden="true" />
              {uiText('addAnImage')}
            </button>
            <button
              type="button"
              disabled={imageInputUnavailable || materialImageCount >= MAX_SCENE_IMAGES}
              onClick={() => cameraRef.current?.click()}
            >
              <Camera size={17} aria-hidden="true" />
              {localFlowText('takePhoto')}
            </button>
            <span className="text-metadata text-fg-tertiary">
              {localFlowText('sceneImageCount',{count:materialImageCount,max:MAX_SCENE_IMAGES})}
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={imageInputUnavailable || materialImageCount >= MAX_SCENE_IMAGES}
            onChange={(event) => {
              void sceneImages.addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            disabled={imageInputUnavailable || materialImageCount >= MAX_SCENE_IMAGES}
            onChange={(event) => {
              void sceneImages.addFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          {imageError && <p className="text-body-support text-feedback-danger" role="alert">{imageError}</p>}
          <SceneImageAttemptStatus
            statuses={sceneImages.statuses}
            className="space-y-1 text-body-support"
          />
        </section>
      )}

      <div className={classNames("pmw-transcript")} ref={transcriptRef} aria-live="polite">
        {session.messages.map((item) => (
          <div key={item.messageId} className={classNames(`pmw-message is-${item.role}`)}>
            {item.role === 'assistant' && (
              <span className={classNames("pmw-avatar")} aria-hidden="true">✦</span>
            )}
            <div>
              {item.body && <p>{item.body}</p>}
              {item.mediaReferenceIds?.map((mediaId) => {
                const media = getMedia(mediaId);
                return media ? <img key={mediaId} src={media.dataUrl} alt={uiText('contextImage')} /> : null;
              })}
            </div>
          </div>
        ))}
        {busy && (
          <div className={classNames(`pmw-message is-assistant${streamingAssistant ? '' : ' is-thinking'}`)}>
            <span className={classNames("pmw-avatar")} aria-hidden="true">✦</span>
            <div>{streamingAssistant ? <p>{streamingAssistant}</p> : <p><i /><i /><i /></p>}</div>
          </div>
        )}
      </div>

      {sourceStale&&!reviewOpen&&<div className={classNames('pmw-inline-error')} role="alert">
        <span>{localFlowText('clarificationSourceChanged')}</span>
        <button type="button" disabled={busy||readUnavailable} onClick={()=>void runTurn(session!)}>{uiText('keepTalking2')}</button>
      </div>}
      {error && (
        <div className={classNames("pmw-inline-error")} role="alert">
          <span>{localFlowNotice(error)}</span>
          <button
            type="button"
            disabled={busy||readUnavailable}
            onClick={() => void runTurn(session)}
          >
            {uiText('retry')}</button>
        </div>
      )}

      <div className={classNames("pmw-dock-bar")}>
        <div className={classNames("pmw-dock-chips")}>
          <button
            type="button"
            className={classNames(`pmw-dock-chip is-${contextStatus.tone}`)}
            onClick={() => setPanelOpen(true)}
            aria-label={uiText('context')}
          >
            <small>{uiText('context')}</small>
            <b>{working.context ? working.context.summary : contextStatus.label}</b>
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

      <ExpressionChatInput busy={imageInputUnavailable} imageUse="scene" onStop={busy ? stopTurn : undefined} maxImages={Math.max(0, MAX_SCENE_IMAGES-materialImageCount)} onSend={sendConversationMessage}/>

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
              {working.context && !senseConfirmed && (
                <ContextCard
                  context={working.context}
                  editing={editingTrack === 'context'}
                  onEdit={() => setEditingTrack('context')}
                  onDone={() => setEditingTrack(null)}
                  onChange={(next) => editTrack('context', next)}
                />
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
              {!working.context && !working.focus && !working.sense && candidatesList.length === 0 && (
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
              {working.context && (
                <article className={classNames("pmw-review-card")}>
                  <header><small>{uiText('context')}</small><em>{uiText('confirmTogether')}</em></header>
                  <b>{working.context.summary}</b>
                </article>
              )}
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
              {sourceStale&&<div role="alert"><p>{localFlowText('clarificationSourceChanged')}</p><button type="button" disabled={busy||readUnavailable} onClick={()=>{setReviewOpen(false);void runTurn(session!);}}>{uiText('keepTalking2')}</button></div>}
              <p className={classNames("pmw-review-consequence")}>
                {uiText('confirmationSavesThisToYourMeanings')}{working.expression && includeExpression ? uiText('andConnectsTheExpression') : uiText('youCanConnectAnExpressionLater')}。
              </p>
              {error && <p className={classNames("pmw-review-error")} role="alert">{localFlowNotice(error)}</p>}
              <div className={classNames("pmw-review-actions")}>
                <button
                  type="button"
                  className={classNames("pmw-primary")}
                  disabled={!canConfirm}
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

  return <MeaningWorkspaceFrame
    active={active}
    onBack={onBack}
    materialOpen={materialOpen}
    onToggleMaterial={()=>setMaterialOpen(v=>!v)}
    screenRef={screenRef}
    title={allConfirmed ? localFlowText('savedExpression') : undefined}
    showMaterialToggle={!allConfirmed}
  >
    <SemanticAgentSessionPersistenceNotice
      issue={sessionPersistenceIssue}
      busy={busy}
      onRetry={() => {
        if (session) void commit(session);
      }}
      onLoadLatest={() => {
        if (!personalMeaningId) return;
        const loaded = loadLatestSemanticAgentSession(personalMeaningId, newUuid);
        setSession(loaded.session);
        setSessionPersistenceIssue(loaded.persistence === 'tab-only' ? 'storage' : null);
      }}
    />
    {body}
  </MeaningWorkspaceFrame>;
};

/** One existing workspace frame for both persisted and preview controllers. */
function MeaningWorkspaceFrame({active,onBack,materialOpen,onToggleMaterial,screenRef,children,title,showMaterialToggle=true}:{active:boolean;onBack:()=>void;materialOpen:boolean;onToggleMaterial:()=>void;screenRef?:import('react').Ref<HTMLElement>;title?:string;showMaterialToggle?:boolean;children:import('react').ReactNode}){
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
    {showMaterialToggle?<button type="button" className={classNames(`pmw-material-toggle${materialOpen?' is-open':''}`)} onClick={onToggleMaterial} aria-expanded={materialOpen}>{uiText('context')}</button>:<span/>}
   </div>,
   primary: <div className={classNames('pmw-shell')}>{children}</div>,
  }}
 />;
}
function ConnectedMeaningConversation({active,onBack,conversation:c,learningControls,governanceControls}:PersonalMeaningDetailScreenProps & {conversation:MeaningConversationController}){
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
   {editing&&<ExpressionChatInput busy={c.busy} imageUse="scene" initialText={candidate.context} inputLabel={localFlowText('context')} inputHint={localFlowText('context')} initialImages={c.images??[]} submitLabel={localFlowText('saveContext')} onSend={async(text,images)=>{await c.onUpdateContext!(text,images);setEditing(false);}}/>}
   {c.notice&&<p role="status">{c.notice}</p>}
   {learningControls}
   {governanceControls}
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

import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
/**
 * 待处理材料盒（Inbox）抽屉。
 *
 * 慢轨摄取材料的处理台：每张卡片呈现原文摘要、来源与附带媒体，轻点候选
 * 义项即走快轨结案落库；「召唤 AI」先把材料建成 Meaning（材料本身成为
 * 澄清会话的语境）再移出 Inbox；「丢弃」直接移除。组件只发意图，所有
 * 写入都经过 gateway 的幂等命令。
 */

import { useEffect, useState } from 'react';
import type { SensaIntakeItem, SensaIntakeSense } from '@sensa/contracts/sensa';
import { newUuid } from '../personalMeaningJourney/ids';
import { type JourneyWorldItemView, useJourneyGateway } from '../personalMeaningJourney';
import { SensaOverlayLayout } from '../ui/SensaComponents';

interface IntakeInboxDrawerProps {
  open: boolean;
  drafts?: JourneyWorldItemView[];
  onOpenDraft?: (id: string) => void;
  items: SensaIntakeItem[];
  onClose: () => void;
  /** 召唤 AI 成功后回调：关闭抽屉并打开新 Meaning 的澄清会话。 */
  onSummoned: (personalMeaningId: string) => void;
  toast: (message: string) => void;
}

const statusLabels: Record<SensaIntakeItem['status'], string> = {
  get pending_context() { return uiText('addContext'); },
  get pending_sense() { return uiText('confirmMeaning'); },
  get pending_expression() { return uiText('selectExpression'); },
  get pending_acceptance() { return uiText('readyForAcceptance'); },
};

interface DisambiguationOption {
  senseKey: string | null;
  definitionSummary: string;
}

/**
 * Quick-disambiguation options come from the captured payload itself: the
 * draft sense (if one was carried as a candidate) plus its alternatives.
 * Only `pending_sense` items have an expression, so only they can resolve.
 */
const disambiguationOptions = (item: SensaIntakeItem): DisambiguationOption[] => {
  if (item.status !== 'pending_sense' && item.status !== 'pending_acceptance') return [];
  const sense = item.payload.sense;
  if (!sense) return [];
  return [{
    senseKey: sense.senseKey,
    definitionSummary: sense.semanticSpec.coreMeaningFocus,
  }];
};

export const IntakeInboxDrawer = ({
  open,
  drafts = [],
  onOpenDraft,
  items,
  onClose,
  onSummoned,
  toast,
}: IntakeInboxDrawerProps) => {
  useTranslation();
  const gateway = useJourneyGateway();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const resolve = async (item: SensaIntakeItem, option: DisambiguationOption) => {
    setBusyId(item.intakeId);
    try {
      const sense: SensaIntakeSense = {
        senseKey: option.senseKey,
        semanticSpec: item.payload.sense!.semanticSpec,
        wordingSource: item.payload.sense?.wordingSource ?? 'learner_authored',
      };
      const result = await gateway.resolveInboxItem(newUuid(), item.intakeId, { sense });
      toast(result.route === 'fast_track'
        ? uiText('meaningConfirmedAndSaved')
        : uiText('thisMaterialStillNeedsClarificationTryAnother'));
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : uiText('unableToProcessThisMaterial'));
    } finally {
      setBusyId(null);
    }
  };

  const summon = async (item: SensaIntakeItem) => {
    const text = item.payload.context?.textSegment?.trim();
    if (!text) return;
    setBusyId(item.intakeId);
    try {
      // The captured context becomes the material; the AI interview opens on
      // it right away, so the item leaves the Inbox in the same gesture.
      const created = await gateway.createPersonalMeaning({
        operationId: newUuid(),
        blocks: [{ kind: 'text', bodyText: text }],
        startingPoint: item.status === 'pending_expression' ? 'from_experience' : 'from_expression',
      });
      await gateway.dismissInboxItem(newUuid(), item.intakeId);
      onSummoned(created.personalMeaningId);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : uiText('unableToStartClarification'));
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (item: SensaIntakeItem) => {
    setBusyId(item.intakeId);
    try {
      await gateway.dismissInboxItem(newUuid(), item.intakeId);
      toast(uiText('materialDiscarded'));
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : uiText('unableToDiscardThisMaterial'));
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <SensaOverlayLayout variant="sheet" measure="standard" className="z-[120]" labelledBy="intake-drawer-title" onDismiss={onClose} dismissOnBackdrop regions={{
      header: <div className="flex min-h-12 items-center justify-between gap-4">
          <div>
            <small className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{uiText('inbox')}</small>
            <h2 className="mt-1 text-section-title font-semibold" id="intake-drawer-title">{uiText('inboxCount', { count: items.length + drafts.length })}</h2>
          </div>
          <button className="grid size-11 place-items-center rounded-control border-0 bg-transparent text-xl text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={onClose} aria-label={uiText('close')}>×</button>
        </div>,
      primary: <div>
          <p className="mb-5 text-body-support leading-6 text-fg-secondary">
            {uiText('capturedMaterialAwaitingYourConfirmation')}</p>
          {drafts.map(item => <button key={item.personalMeaningId} type="button" onClick={()=>onOpenDraft?.(item.personalMeaningId)} className="mb-4 block w-full rounded-card border border-border-subtle bg-surface-panel p-5 text-left focus-visible:outline-2 focus-visible:outline-focus"><span className="text-xs text-fg-tertiary">{uiText('continueDraft')}</span><strong className="mt-3 block text-sm font-medium leading-6">{item.experienceAnchors[0]?.surfaceForm || item.familiarAnchors[0]?.surfaceForm || item.primaryLabel}</strong></button>)}
          {items.map((item) => {
            const busy = busyId === item.intakeId || busyId != null;
            const options = disambiguationOptions(item);
            const source = item.payload.context?.source;
            const mediaCount = item.payload.context?.mediaReferenceIds.length ?? 0;
            const hasText = Boolean(item.payload.context?.textSegment?.trim());
            return (
              <article className="mb-4 rounded-card border border-border-subtle bg-surface-panel p-5" key={item.intakeId}>
                <header className="flex items-center justify-between gap-3">
                  <span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata font-semibold text-fg-secondary">
                    {statusLabels[item.status]}
                  </span>
                  {mediaCount > 0 && (
                    <span className="text-metadata text-fg-tertiary">
                      <span aria-hidden="true">🖼</span> {uiText('includes2')}{mediaCount} {uiText('images')}</span>
                  )}
                </header>
                <p className="mt-4 text-body leading-7 text-fg-primary">{item.summaryView}</p>
                {source && (
                  <p className="mt-3 break-words text-metadata leading-5 text-fg-tertiary">
                    {uiText('webSource')}{source.title ?? source.url ?? uiText('unknownSource')}
                  </p>
                )}
                {options.length > 0 && (
                  <div className="mt-4 grid gap-2" role="group" aria-label={uiText('chooseAMeaningToConfirm')}>
                    {options.map((option, index) => (
                      <button
                        className="min-h-12 rounded-control border border-border-subtle bg-surface-subtle px-4 text-left text-body-support text-fg-secondary hover:bg-surface-selected focus-visible:outline-2 focus-visible:outline-focus"
                        type="button"
                        key={`${option.definitionSummary}-${index}`}
                        disabled={busy}
                        onClick={() => void resolve(item, option)}
                      >
                        {option.definitionSummary}
                      </button>
                    ))}
                  </div>
                )}
                <footer className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="min-h-12 rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus"
                    disabled={busy || !hasText}
                    onClick={() => void summon(item)}
                  >
                    {uiText('clarify')}</button>
                  <button
                    type="button"
                    className="min-h-12 rounded-control border border-border-strong bg-surface-panel px-5 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
                    disabled={busy}
                    onClick={() => void discard(item)}
                  >
                    {uiText('discard')}</button>
                </footer>
              </article>
            );
          })}
          {items.length === 0 && drafts.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <span className="mb-4 grid size-14 place-items-center rounded-card bg-accent-soft text-xl font-bold text-feedback-success" aria-hidden="true">✓</span>
              <p className="text-body-support text-fg-secondary">{uiText('yourInboxIsEmpty')}</p>
            </div>
          )}
        </div>,
    }} />
  );
};

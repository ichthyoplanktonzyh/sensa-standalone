import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
/**
 * Read-only endpoint for Meaning Formation.
 *
 * This is intentionally separate from the content Sense detail. It reads the
 * exact Personal Meaning → optional Focus → Alignment projection and is the only place
 * from which the independent Expression Binding journey begins. A complete
 * Alignment can also be explicitly added to learning through the injected
 * learning control; the detail screen itself remains a read projection.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  useJourneyDetail,
  type JourneyAlignmentView,
  type JourneySemanticSpecView,
} from '../personalMeaningJourney';
import type {
  SensaExpressionBindingRelation,
  SensaSemanticCoverage,
} from '@sensa/contracts/sensa';
import {
  contentNavigationBackClass,
  contentNavigationClass,
  iconClass,
  slideScreenClass,
} from '../ui/primitives';
import { SensaDetailWorkspaceLayout } from '../ui/SensaPageLayouts';

export interface ConfirmedSenseDetailScreenProps {
  active: boolean;
  personalMeaningId: string | null;
  meaningFocusId: string | null;
  onBack: () => void;
  onOpenBinding: () => void;
  learningControls?: (detail: NonNullable<ReturnType<typeof useJourneyDetail>['detail']>, alignment: JourneyAlignmentView) => ReactNode;
}

const relationLabels: Record<SensaExpressionBindingRelation, string> = {
  get realizes() { return uiText('expressesThisMeaning'); },
  get approximates() { return uiText('approximatesThisMeaning'); },
  get evokes() { return uiText('evokesThisMeaning'); },
};

const coverageLabels: Record<SensaSemanticCoverage, string> = {
  get exact() { return uiText('exactCoverage'); },
  get broader() { return uiText('broaderScope'); },
  get narrower() { return uiText('narrowerScope'); },
  get overlapping() { return uiText('partialOverlap'); },
};

const expressionTypeLabels = {
  get word() { return uiText('word'); },
  get phrase() { return uiText('phrase'); },
  get construction() { return uiText('construction'); },
  get sentence() { return uiText('sentence'); },
  get utterance_strategy() { return uiText('expressionStrategy'); },
} as const;

const languageLabel = (languageTag: string): string =>
  languageTag === 'en' ? uiText('english') : languageTag;

const shortId = (id: string): string => id.split('-')[0].toUpperCase();

const unavailableCopy = (reason: string) => (
  <div className="rounded-card border border-dashed border-border-strong bg-surface-panel p-8 text-center" role="alert">
    <span className="mx-auto grid size-9 place-items-center rounded-full bg-accent-soft font-bold text-feedback-warning" aria-hidden="true">!</span>
    <h2 className="mt-4 text-section-title font-semibold">{uiText('unableToOpen')}</h2>
    <p className="mt-2 text-body-support leading-6 text-fg-secondary">{reason}</p>
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
    <section className={`rounded-control p-3 ${tone === 'exclude' ? 'bg-surface-subtle text-feedback-danger' : tone === 'include' ? 'bg-accent-soft text-feedback-success' : 'bg-surface-subtle text-fg-secondary'}`}>
      <h3 className="text-metadata font-bold uppercase tracking-wide">{title}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-body-support leading-6 text-fg-secondary">
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
  <details className="group rounded-card border border-border-subtle bg-surface-panel px-5 shadow-raised">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 text-control-label font-semibold text-fg-primary marker:hidden after:text-lg after:text-fg-tertiary after:content-['＋'] group-open:after:content-['−'] [&::-webkit-details-marker]:hidden">{uiText('scenesAndBoundaries')}<span className="text-metadata font-medium text-fg-tertiary">v{version ?? '1'}</span></summary>
      <div className="pb-5">
        {spec.prototypeScenes.map((scene, index) => (
          <article className="mt-3 rounded-control border border-border-subtle bg-surface-subtle p-4" key={`${scene.summary}-${index}`}>
            <small className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{uiText('typicalScene')}{spec.prototypeScenes.length > 1 ? ` ${index + 1}` : ''}</small>
            <h3 className="mt-2 text-body font-semibold leading-6">{scene.summary}</h3>
            <dl className="mt-3 space-y-2 text-body-support">
              {scene.participantRoles.length > 0 && (
                <div className="grid grid-cols-[5rem_1fr] gap-3"><dt className="text-fg-tertiary">{uiText('participants')}</dt><dd className="text-fg-secondary">{scene.participantRoles.join(' / ')}</dd></div>
              )}
              {scene.states.length > 0 && (
                <div className="grid grid-cols-[5rem_1fr] gap-3"><dt className="text-fg-tertiary">{uiText('state')}</dt><dd className="text-fg-secondary">{scene.states.join('；')}</dd></div>
              )}
              {scene.directionOrCausality && (
                <div className="grid grid-cols-[5rem_1fr] gap-3"><dt className="text-fg-tertiary">{uiText('directionCausality')}</dt><dd className="text-fg-secondary">{scene.directionOrCausality}</dd></div>
              )}
            </dl>
          </article>
        ))}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SpecList title={uiText('includes')} items={spec.includedCases} tone="include" />
          <SpecList title={uiText('excludes')} items={spec.excludedCases} tone="exclude" />
        </div>

        {spec.neighborContrasts.length > 0 && (
          <section className="mt-4 border-t border-dashed border-border-subtle pt-4">
            <h3 className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{uiText('distinctionsFromNearbyMeanings')}</h3>
            <ul className="mt-3 space-y-3">
              {spec.neighborContrasts.map((contrast) => (
                <li className="flex flex-col gap-1" key={contrast.label}>
                  <b className="text-body-support text-fg-primary">{contrast.label}</b>
                  <span className="text-body-support leading-6 text-fg-secondary">{contrast.distinction}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {spec.openQuestions.length > 0 || unresolvedQuestions.length > 0 ? (
          <section className="mt-4 border-t border-dashed border-border-subtle pt-4">
            <h3 className="text-metadata font-bold uppercase tracking-wide text-feedback-warning">{uiText('remainingQuestions')}</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-body-support leading-6 text-fg-secondary">
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
    <section className={`rounded-card border bg-surface-panel p-5 shadow-raised ${hasBindings ? 'border-border-strong' : 'border-border-subtle'}`} aria-labelledby="csd-binding-heading">
      <header className="flex items-start justify-between gap-4">
        <div>
          <small className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{uiText('targetExpression')}</small>
          <h2 className="mt-1 text-section-title font-semibold" id="csd-binding-heading">{uiText('connectedExpressions')}</h2>
        </div>
        <span className="rounded-pill bg-accent-soft px-3 py-1 text-metadata font-bold text-fg-secondary">{hasBindings ? uiText('connected') : uiText('pending')}</span>
      </header>
      {hasBindings ? (
        <ul className="mt-4 space-y-3">
          {alignment.confirmedBindings.map((binding) => (
            <li className="rounded-control border border-border-subtle bg-accent-soft p-4" key={binding.bindingVersionId}>
              <div className="flex flex-wrap items-baseline gap-2">
                <strong className="font-language text-lg text-fg-primary">{binding.surfaceForm}</strong>
                <span className="text-metadata text-fg-secondary">{expressionTypeLabels[binding.expressionType]} · {languageLabel(binding.languageTag)}</span>
              </div>
              <small className="mt-2 block text-metadata text-fg-secondary">{relationLabels[binding.relation]} · {coverageLabels[binding.semanticCoverage]}</small>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-control bg-surface-subtle p-4 text-body-support text-fg-secondary">
          <b>{uiText('noTargetExpressionConfirmedYet')}</b>
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
  learningControls,
}: ConfirmedSenseDetailScreenProps) => {
  useTranslation();
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
      <div className="rounded-card border border-dashed border-feedback-danger bg-surface-panel p-7 text-center" role="alert">
        <b className="text-body text-feedback-danger">{uiText('unableToLoadYourMeanings')}</b>
        <p className="mt-2 text-body-support leading-6 text-fg-secondary">{status.error ?? uiText('localMeaningDataIsUnavailable')}</p>
        <button className="mt-4 min-h-11 rounded-control border border-border-strong bg-surface-panel px-4 text-control-label font-semibold text-fg-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={onBack}>{uiText('back')}</button>
      </div>
    )
    : !personalMeaningId || !meaningFocusId
      ? unavailableCopy(uiText('theContextAndConfirmedMeaningWereNot'))
      : !detail || !alignment
        ? unavailableCopy(uiText('theConfirmedMeaningWasNotFound'))
        : !alignment.semanticSpec
          ? unavailableCopy(uiText('theSemanticSpecificationIsMissingThisMeaning'))
          : (
            <>
              <section className="rounded-card border border-border-subtle bg-surface-panel p-6 shadow-raised">
                <span className="mb-4 grid size-9 place-items-center rounded-control bg-accent-soft font-bold text-feedback-success" aria-hidden="true">✓</span>
                <small className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{alignment.confirmedBindings.length > 0 ? uiText('expressionConnected') : uiText('confirmedMeaning')}</small>
                <h2 className="mt-2 text-page-title font-semibold leading-tight">{alignment.semanticSpec.coreMeaningFocus}</h2>
                <p className="mt-3 text-body-support leading-7 text-fg-secondary">{focus ? uiText('fromFocus', { focus: focus.statement }) : uiText('resolvedDirectlyFromTheExpressionInThis')}</p>
              </section>

              <section className="rounded-card border border-border-subtle bg-surface-panel p-5">
                <div className="flex flex-col gap-3">
                  {focus && alignment.expressionCandidates.length > 0 && (
                    <button type="button" className="min-h-12 rounded-control border-0 bg-action-primary px-5 text-control-label font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" onClick={onOpenBinding}>
                      {alignment.confirmedBindings.length > 0 ? uiText('viewOrChangeExpression') : uiText('connectAnExpression')} <span aria-hidden="true">→</span>
                    </button>
                  )}
                  <button className="min-h-12 rounded-control border border-border-strong bg-surface-panel px-5 text-control-label font-semibold text-fg-primary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus" type="button" onClick={onBack}>{uiText('backToMyContent3')}</button>
                </div>
              </section>

              <SenseSpec
                spec={alignment.semanticSpec}
                version={alignment.semanticSpecVersion}
                unresolvedQuestions={alignment.unresolvedQuestions}
              />
              <details className="group rounded-card border border-border-subtle bg-surface-panel px-5 text-metadata text-fg-tertiary">
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-semibold text-fg-secondary after:text-lg after:content-['＋'] group-open:after:content-['−'] [&::-webkit-details-marker]:hidden">{uiText('sourceDetails')}</summary>
                <p className="mb-2 break-words">
                  ID {shortId(alignment.senseId)} · v{alignment.senseVersionNumber ?? '1'}
                </p>
                <p className="mb-4 break-words">
                  {uiText('source')}{alignment.origin}
                  {alignment.generator ? ` · ${alignment.generator.provider} / ${alignment.generator.model}` : ''}
                </p>
              </details>
              {alignment.confirmedBindings.length > 0 && <BindingSummary alignment={alignment} />}
              {alignment.confirmedBindings.length > 0 && learningControls?.(detail, alignment)}
            </>
          );

  return (
    <SensaDetailWorkspaceLayout
      ref={screenRef}
      className={slideScreenClass(active)}
      id="s-confirmed-sense"
      data-anim="slide"
      aria-hidden={!active}
      regions={{
        header: <div className={contentNavigationClass}>
        <button type="button" className={contentNavigationBackClass} onClick={onBack} aria-label={uiText('back2')}>
          <svg className={iconClass} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{uiText('confirmedMeaning')}</h1>
        <span />
      </div>,
        primary: <div className="flex flex-col gap-4">{body}</div>,
      }}
    />
  );
};

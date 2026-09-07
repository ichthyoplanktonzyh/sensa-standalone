import { useTranslation } from 'react-i18next';
import { uiText } from '../../i18n/uiText';
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
  <div className={uiClass("csd-unavailable")} role="alert">
    <span className={uiClass("csd-unavailable-mark")} aria-hidden="true">!</span>
    <h2>{uiText('unableToOpen')}</h2>
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
      <summary>{uiText('scenesAndBoundaries')}<span>v{version ?? '1'}</span></summary>
      <div className={uiClass("csd-spec-details-body")}>
        {spec.prototypeScenes.map((scene, index) => (
          <article className={uiClass("csd-prototype-scene")} key={`${scene.summary}-${index}`}>
            <small>{uiText('typicalScene')}{spec.prototypeScenes.length > 1 ? ` ${index + 1}` : ''}</small>
            <h3>{scene.summary}</h3>
            <dl>
              {scene.participantRoles.length > 0 && (
                <div><dt>{uiText('participants')}</dt><dd>{scene.participantRoles.join(' / ')}</dd></div>
              )}
              {scene.states.length > 0 && (
                <div><dt>{uiText('state')}</dt><dd>{scene.states.join('；')}</dd></div>
              )}
              {scene.directionOrCausality && (
                <div><dt>{uiText('directionCausality')}</dt><dd>{scene.directionOrCausality}</dd></div>
              )}
            </dl>
          </article>
        ))}

        <div className={uiClass("csd-spec-columns")}>
          <SpecList title={uiText('includes')} items={spec.includedCases} tone="include" />
          <SpecList title={uiText('excludes')} items={spec.excludedCases} tone="exclude" />
        </div>

        {spec.neighborContrasts.length > 0 && (
          <section className={uiClass("csd-neighbors")}>
            <h3>{uiText('distinctionsFromNearbyMeanings')}</h3>
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
            <h3>{uiText('remainingQuestions')}</h3>
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
          <small>{uiText('targetExpression')}</small>
          <h2 id="csd-binding-heading">{uiText('connectedExpressions')}</h2>
        </div>
        <span className={uiClass("csd-fact-pill")}>{hasBindings ? uiText('connected') : uiText('pending')}</span>
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
      <div className={uiClass("csd-error")} role="alert">
        <b>{uiText('unableToLoadYourMeanings')}</b>
        <p>{status.error ?? uiText('localMeaningDataIsUnavailable')}</p>
        <button type="button" onClick={onBack}>{uiText('back')}</button>
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
              <section className={uiClass("csd-hero")}>
                <span className={uiClass("csd-confirm-mark")} aria-hidden="true">✓</span>
                <small>{alignment.confirmedBindings.length > 0 ? uiText('expressionConnected') : uiText('confirmedMeaning')}</small>
                <h2>{alignment.semanticSpec.coreMeaningFocus}</h2>
                <p>{focus ? uiText('fromFocus', { focus: focus.statement }) : uiText('resolvedDirectlyFromTheExpressionInThis')}</p>
              </section>

              <section className={uiClass("csd-next-step")}>
                <div className={uiClass("csd-actions")}>
                  {focus && alignment.expressionCandidates.length > 0 && (
                    <button type="button" className={uiClass("csd-primary")} onClick={onOpenBinding}>
                      {alignment.confirmedBindings.length > 0 ? uiText('viewOrChangeExpression') : uiText('connectAnExpression')} <span aria-hidden="true">→</span>
                    </button>
                  )}
                  <button type="button" onClick={onBack}>{uiText('backToMyContent3')}</button>
                </div>
              </section>

              <SenseSpec
                spec={alignment.semanticSpec}
                version={alignment.semanticSpecVersion}
                unresolvedQuestions={alignment.unresolvedQuestions}
              />
              <details className={uiClass("csd-identity-details")}>
                <summary>{uiText('sourceDetails')}</summary>
                <p>
                  ID {shortId(alignment.senseId)} · v{alignment.senseVersionNumber ?? '1'}
                </p>
                <p>
                  {uiText('source')}{alignment.origin}
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
        <button type="button" className={uiClass("content-nav-back")} onClick={onBack} aria-label={uiText('back2')}>
          <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <h1>{uiText('confirmedMeaning')}</h1>
        <span />
      </header>
      <div className={uiClass("content-page-body csd-body")}>{body}</div>
    </section>
  );
};

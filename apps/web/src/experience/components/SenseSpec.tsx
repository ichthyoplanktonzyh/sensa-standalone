import {uiText} from '../../i18n/uiText';
import type {JourneySemanticSpecView} from '../personalMeaningJourney/types';
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

export const SenseSpec = ({
  spec,
  version=null,
  unresolvedQuestions=[],
}: {
  spec: JourneySemanticSpecView;
  version?: number | null;
  unresolvedQuestions?: readonly string[];
}) => (
  <details className="group rounded-card border border-border-subtle bg-surface-panel px-5 shadow-raised">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 text-control-label font-semibold text-fg-primary marker:hidden after:text-lg after:text-fg-tertiary after:content-['＋'] group-open:after:content-['−'] [&::-webkit-details-marker]:hidden">{uiText('scenesAndBoundaries')}{version!==null&&<span className="text-metadata font-medium text-fg-tertiary">v{version}</span>}</summary>
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

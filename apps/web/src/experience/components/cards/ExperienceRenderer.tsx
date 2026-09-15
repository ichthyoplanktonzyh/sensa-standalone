import {cardText} from '../../../i18n/originalCards';
import { iconClass } from '../../ui/primitives';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  InteractionExperience,
  RuntimeLearningContent,
  TextExperience,
} from '../../../learning/content/learningCatalog';

interface ExperienceRendererProps {
  experience: RuntimeLearningContent['experience'];
  mode: 'introduction' | 'replay';
  replayAction?: 'return' | 'reveal';
  primaryActionLabel?: string;
  onPrimaryAction: () => void;
}

function ExperienceStage({
  experience,
  activeIndex,
}: {
  experience: InteractionExperience;
  activeIndex: number;
}) {
  if (experience.rendererVariant === 'physical_threshold') {
    const stateName = experience.states[activeIndex]?.state ?? 'intact';
    const damageClass = stateName.replace(/_crack$/, '') || 'intact';
    return (
      <div className={`relative grid min-h-64 place-items-center overflow-hidden rounded-card bg-surface-subtle damage-${damageClass}`} aria-hidden="true">
        <div className="absolute inset-x-0 bottom-10 h-px bg-border-strong" />
        <div className="absolute right-1/3 top-12 text-2xl text-decorative">✦</div>
        <div className="relative h-28 w-20 rounded-b-card border-2 border-border-strong bg-surface-panel/60">
          <i className="absolute -left-1 -right-1 -top-1 h-2 rounded-full border-2 border-border-strong" />
          <i className={`absolute left-8 top-4 h-16 w-px rotate-12 bg-border-strong transition-opacity ${activeIndex > 0 ? 'opacity-100' : 'opacity-0'}`} />
          <i className={`absolute left-5 top-12 h-12 w-px -rotate-45 bg-border-strong transition-opacity ${activeIndex > 1 ? 'opacity-100' : 'opacity-0'}`} />
          <i className={`absolute right-5 top-10 h-14 w-px rotate-45 bg-border-strong transition-opacity ${activeIndex > 2 ? 'opacity-100' : 'opacity-0'}`} />
        </div>
        <span className="absolute bottom-4 text-metadata font-semibold text-fg-secondary">{experience.presentation.objectLabelL1}</span>
      </div>
    );
  }

  if (experience.rendererVariant === 'continuation_timeline') {
    const statusLabels = experience.presentation.statusLabelsL1;
    return (
      <div className="relative min-h-64 overflow-hidden rounded-card bg-surface-subtle p-6" role="img" aria-label={experience.stageCaptionL1}>
        <div className="flex items-center justify-between gap-4">
          <span className="text-body font-semibold">{experience.presentation.projectLabelL1}</span>
          <strong className="rounded-pill bg-accent-soft px-3 py-1 text-metadata text-action-primary">{statusLabels[activeIndex < 2 ? 0 : 1] ?? ''}</strong>
        </div>
        <div className="mt-10 grid grid-flow-col items-start gap-2" aria-hidden="true">
          {experience.states.map((state, index) => (
            <span
              key={state.state}
              className="relative flex flex-col items-center gap-2 text-center"
            >
              <i className={`size-4 rounded-full border-2 ${index <= activeIndex ? 'border-action-primary bg-action-primary' : 'border-border-strong bg-surface-panel'}`} />
              <small className="text-metadata text-fg-secondary">{state.labelL1}</small>
            </span>
          ))}
        </div>
        <div className={`mt-6 flex flex-wrap justify-center gap-2 transition-opacity ${activeIndex >= 2 ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true">
          {experience.presentation.supportLabelsL1.map((label) => <b className="rounded-pill bg-accent-soft px-3 py-1 text-metadata text-fg-secondary" key={label}>{label}</b>)}
        </div>
        <span className="absolute bottom-4 left-0 right-0 text-center text-metadata text-fg-secondary">{experience.stageCaptionL1}</span>
      </div>
    );
  }

  const isReceiver = experience.rendererVariant === 'receiver_transfer';
  const objectLabel = experience.presentation.objectLabelL1;
  const objectState = activeIndex === 0 ? 'at-owner' : activeIndex >= experience.maximum ? 'returned' : 'at-user';
  return (
    <div
      className={`relative min-h-64 overflow-hidden rounded-card bg-surface-subtle p-6 is-${experience.presentation.stageClassName}`}
      role="img"
      aria-label={experience.stageCaptionL1}
    >
      <div className="text-center text-metadata font-bold uppercase tracking-wide text-fg-tertiary">
        {experience.presentation.viewpointLabelL1}
      </div>
      <div className="absolute bottom-20 left-8 flex flex-col items-center gap-2">
        <i className="size-12 rounded-full border border-border-strong bg-surface-panel" aria-hidden="true" />
        <span className="text-metadata text-fg-secondary">{experience.presentation.ownerLabelL1}</span>
      </div>
      <div className="absolute bottom-28 left-24 right-24 h-px bg-border-strong" aria-hidden="true" />
      <div className="absolute bottom-20 right-8 flex flex-col items-center gap-2">
        <i className="size-12 rounded-full border border-border-strong bg-surface-panel" aria-hidden="true" />
        <span className="text-metadata text-fg-secondary">{experience.presentation.userLabelL1}</span>
      </div>
      <div className={`absolute bottom-32 left-1/2 -translate-x-1/2 rounded-control bg-decorative px-3 py-2 text-metadata font-semibold text-action-on-primary ${objectState}`} aria-hidden="true">
        <span>{objectLabel}</span>
      </div>
      <span className="absolute bottom-4 left-0 right-0 text-center text-metadata text-fg-secondary">{experience.stageCaptionL1}</span>
    </div>
  );
}

interface InteractiveExperienceRendererProps extends Omit<ExperienceRendererProps, 'experience'> {
  experience: InteractionExperience;
}

function InteractiveExperienceRenderer({
  experience,
  mode,
  replayAction = 'return',
  primaryActionLabel,
  onPrimaryAction,
}: InteractiveExperienceRendererProps) {
  const [force, setForce] = useState(experience.minimum);
  const [showTextFallback, setShowTextFallback] = useState(false);
  useEffect(() => {
    setForce(experience.minimum);
    setShowTextFallback(false);
  }, [experience.renderKey, experience.minimum]);
  const currentState = useMemo(
    () => experience.states.find((state) => state.value === force) ?? experience.states[0],
    [experience.states, force],
  );

  if (!currentState) return null;

  const range = experience.maximum - experience.minimum;
  const progress = range > 0 ? ((force - experience.minimum) / range) * 100 : 0;
  const rangeStyle: CSSProperties = {
    background: `linear-gradient(90deg, var(--sensa-decorative) 0%, var(--sensa-decorative) ${progress}%, var(--sensa-border-subtle) ${progress}%, var(--sensa-border-subtle) 100%)`,
  };
  const activeIndex = experience.states.findIndex((state) => state.value === currentState.value);
  const isReplay = mode === 'replay';
  const reopensReveal = isReplay && replayAction === 'reveal';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8 text-fg-primary sm:px-10">
      <div>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{isReplay ? cardText('replayTheMeaningConnection') : cardText('buildANewMeaning')}</span>
        <h1 className="mt-3 text-page-title font-semibold">{isReplay ? cardText('revisitTheExperience') : cardText('experienceItFirst')}</h1>
        {!showTextFallback && <p className="mt-3 text-body-support leading-6 text-fg-secondary">{experience.instructionL1}</p>}
      </div>

      {showTextFallback && experience.fallbackTextSceneL1 ? (
        <div className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-6" data-render-key={`${experience.renderKey}.text-scene-fallback`}>
          <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('textScene')}</span>
          <p className="mt-4 text-body leading-8 text-fg-primary">{experience.fallbackTextSceneL1}</p>
        </div>
      ) : (
        <div className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-4" data-render-key={experience.renderKey}>
          <ExperienceStage experience={experience} activeIndex={activeIndex} />

          <div className="p-3 pt-6">
            <div className="flex items-center justify-between gap-4">
              <span className="text-control-label font-semibold">{experience.controlLabelL1}</span>
              <strong className="text-control-label text-action-primary">{currentState.labelL1}</strong>
            </div>
            <input
              className="mt-5 h-1.5 w-full cursor-pointer appearance-none rounded-pill accent-action-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
              type="range"
              min={experience.minimum}
              max={experience.maximum}
              step={experience.step}
              value={force}
              style={rangeStyle}
              onChange={(event) => setForce(Number(event.currentTarget.value))}
              aria-label={experience.controlLabelL1}
              aria-valuetext={currentState.labelL1}
            />
            <div className="mt-3 flex items-center justify-between text-metadata text-fg-tertiary" aria-hidden="true">
              <span>{experience.labelsL1[0]}</span>
              <span>{experience.labelsL1[experience.labelsL1.length - 1]}</span>
            </div>
          </div>

          <div className="mx-3 mb-3 flex items-start gap-3 rounded-control bg-accent-soft p-4" role="status" aria-live="polite">
            <i className="mt-1 size-2 shrink-0 rounded-full bg-progress" />
            <p className="text-body-support leading-6 text-fg-secondary">{currentState.feedbackL1}</p>
          </div>
        </div>
      )}

      <div className="mt-auto grid gap-3 pt-8">
        <button
          type="button"
          className="flex min-h-14 w-full items-center justify-between rounded-control border-0 bg-action-primary px-5 text-body font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus"
          onClick={onPrimaryAction}
        >
          {primaryActionLabel
            ?? (reopensReveal ? cardText('seeTheExpressionAgain') : isReplay ? cardText('returnToYourAnswer') : cardText('revealThisMeaning'))}
          <svg className={iconClass} aria-hidden="true">
            <use href={isReplay && !reopensReveal ? '#i-chev-r' : '#i-eye'} />
          </svg>
        </button>
        {experience.fallbackTextSceneL1 && (
          <button
            type="button"
            className="min-h-11 rounded-control border-0 bg-transparent px-4 text-control-label font-semibold text-fg-secondary hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
            onClick={() => setShowTextFallback((shown) => !shown)}
          >
            {showTextFallback ? cardText('useTheInteractiveScene') : cardText('useTheTextScene')}
          </button>
        )}
      </div>
    </div>
  );
}

interface TextExperienceRendererProps extends Omit<ExperienceRendererProps, 'experience'> {
  experience: TextExperience;
}

function TextExperienceRenderer({
  experience,
  mode,
  replayAction = 'return',
  primaryActionLabel,
  onPrimaryAction,
}: TextExperienceRendererProps) {
  const isReplay = mode === 'replay';
  const reopensReveal = isReplay && replayAction === 'reveal';
  return (
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-8 text-fg-primary sm:px-10">
      <div>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{isReplay ? cardText('replayTheMeaningConnection') : cardText('buildANewMeaning')}</span>
        <h1 className="mt-3 text-page-title font-semibold">{isReplay ? cardText('revisitTheExperience') : cardText('experienceItFirst')}</h1>
      </div>

      <div className="mt-6 rounded-card border border-border-subtle bg-surface-panel p-6" data-render-key={experience.renderKey}>
        <span className="text-metadata font-bold uppercase tracking-wide text-fg-tertiary">{cardText('textScene')}</span>
        <p className="mt-4 text-body leading-8 text-fg-primary">{experience.sceneL1}</p>
      </div>

      <div className="mt-auto pt-8">
        <button
          type="button"
          className="flex min-h-14 w-full items-center justify-between rounded-control border-0 bg-action-primary px-5 text-body font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-focus"
          onClick={onPrimaryAction}
        >
          {primaryActionLabel
            ?? (reopensReveal ? cardText('seeTheExpressionAgain') : isReplay ? cardText('returnToYourAnswer') : cardText('revealThisMeaning'))}
          <svg className={iconClass} aria-hidden="true">
            <use href={isReplay && !reopensReveal ? '#i-chev-r' : '#i-eye'} />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function ExperienceRenderer(props: ExperienceRendererProps) {
  return props.experience.kind === 'text'
    ? <TextExperienceRenderer {...props} experience={props.experience} />
    : <InteractiveExperienceRenderer {...props} experience={props.experience} />;
}

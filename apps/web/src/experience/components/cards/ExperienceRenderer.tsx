import {cardText} from '../../../i18n/originalCards';
import { uiClass } from '../../ui/classes';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  PrototypeInteractionExperience,
  PrototypeIntroductionPackage,
  PrototypeTextExperience,
} from '../../content/learningCatalog';

interface ExperienceRendererProps {
  experience: PrototypeIntroductionPackage['experience'];
  mode: 'introduction' | 'replay';
  replayAction?: 'return' | 'reveal';
  primaryActionLabel?: string;
  onPrimaryAction: () => void;
}

function ExperienceStage({
  experience,
  activeIndex,
}: {
  experience: PrototypeInteractionExperience;
  activeIndex: number;
}) {
  if (experience.rendererVariant === 'physical_threshold') {
    const stateName = experience.states[activeIndex]?.state ?? 'intact';
    const damageClass = stateName.replace(/_crack$/, '') || 'intact';
    return (
      <div className={uiClass(`intro-object-stage damage-${damageClass}`)} aria-hidden="true">
        <div className={uiClass("intro-stage-light")} />
        <div className={uiClass("intro-table-edge")} />
        <div className={uiClass("intro-impact-mark")}>✦</div>
        <div className={uiClass("intro-glass-cup")}>
          <i className={uiClass("intro-glass-rim")} />
          <i className={uiClass("intro-crack intro-crack-a")} />
          <i className={uiClass("intro-crack intro-crack-b")} />
          <i className={uiClass("intro-crack intro-crack-c")} />
        </div>
        <span className={uiClass("intro-stage-caption")}>{experience.presentation.objectLabelL1}</span>
      </div>
    );
  }

  if (experience.rendererVariant === 'continuation_timeline') {
    const statusLabels = experience.presentation.statusLabelsL1;
    return (
      <div className={uiClass("intro-object-stage intro-process-stage")} role="img" aria-label={experience.stageCaptionL1}>
        <div className={uiClass("intro-process-project")}>
          <span>{experience.presentation.projectLabelL1}</span>
          <strong>{statusLabels[activeIndex < 2 ? 0 : 1] ?? ''}</strong>
        </div>
        <div className={uiClass("intro-process-line")} aria-hidden="true">
          {experience.states.map((state, index) => (
            <span
              key={state.state}
              className={uiClass(index === activeIndex ? 'active' : index < activeIndex ? 'done' : '')}
            >
              <i />
              <small>{state.labelL1}</small>
            </span>
          ))}
        </div>
        <div className={uiClass(`intro-support-stream${activeIndex >= 2 ? ' visible' : ''}`)} aria-hidden="true">
          {experience.presentation.supportLabelsL1.map((label) => <b key={label}>{label}</b>)}
        </div>
        <span className={uiClass("intro-stage-caption")}>{experience.stageCaptionL1}</span>
      </div>
    );
  }

  const isReceiver = experience.rendererVariant === 'receiver_transfer';
  const objectLabel = experience.presentation.objectLabelL1;
  const objectState = activeIndex === 0 ? 'at-owner' : activeIndex >= experience.maximum ? 'returned' : 'at-user';
  return (
    <div
      className={uiClass(`intro-object-stage intro-transfer-stage is-${experience.presentation.stageClassName}`)}
      role="img"
      aria-label={experience.stageCaptionL1}
    >
      <div className={uiClass(`intro-transfer-viewpoint viewpoint-${isReceiver ? 'user' : 'owner'}`)}>
        {experience.presentation.viewpointLabelL1}
      </div>
      <div className={uiClass("intro-transfer-actor actor-owner")}>
        <i aria-hidden="true" />
        <span>{experience.presentation.ownerLabelL1}</span>
      </div>
      <div className={uiClass("intro-transfer-path")} aria-hidden="true"><i /></div>
      <div className={uiClass("intro-transfer-actor actor-user")}>
        <i aria-hidden="true" />
        <span>{experience.presentation.userLabelL1}</span>
      </div>
      <div className={uiClass(`intro-transfer-object ${objectState}`)} aria-hidden="true">
        <span>{objectLabel}</span>
      </div>
      <span className={uiClass("intro-stage-caption")}>{experience.stageCaptionL1}</span>
    </div>
  );
}

interface InteractiveExperienceRendererProps extends Omit<ExperienceRendererProps, 'experience'> {
  experience: PrototypeInteractionExperience;
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
    background: `linear-gradient(90deg, #e57a3f 0%, #e57a3f ${progress}%, rgba(55, 66, 70, .14) ${progress}%, rgba(55, 66, 70, .14) 100%)`,
  };
  const activeIndex = experience.states.findIndex((state) => state.value === currentState.value);
  const isReplay = mode === 'replay';
  const reopensReveal = isReplay && replayAction === 'reveal';

  return (
    <div className={uiClass(`intro-page intro-experience-page${isReplay ? ' is-replay' : ''}`)}>
      <div className={uiClass("intro-experience-heading")}>
        <span>{isReplay ? cardText('replayTheMeaningConnection') : cardText('buildANewMeaning')}</span>
        <h1>{isReplay ? cardText('revisitTheExperience') : cardText('experienceItFirst')}</h1>
        {!showTextFallback && <p>{experience.instructionL1}</p>}
      </div>

      {showTextFallback && experience.fallbackTextSceneL1 ? (
        <div className={uiClass("intro-text-fallback")} data-render-key={`${experience.renderKey}.text-scene-fallback`}>
          <span>{cardText('textScene')}</span>
          <p>{experience.fallbackTextSceneL1}</p>
        </div>
      ) : (
        <div className={uiClass("intro-interaction-card")} data-render-key={experience.renderKey}>
          <ExperienceStage experience={experience} activeIndex={activeIndex} />

          <div className={uiClass("intro-control-block")}>
            <div className={uiClass("intro-control-title")}>
              <span>{experience.controlLabelL1}</span>
              <strong>{currentState.labelL1}</strong>
            </div>
            <input
              className={uiClass("intro-range")}
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
            <div className={uiClass("intro-range-labels")} aria-hidden="true">
              <span>{experience.labelsL1[0]}</span>
              <span>{experience.labelsL1[experience.labelsL1.length - 1]}</span>
            </div>
          </div>

          <div className={uiClass("intro-state-feedback")} role="status" aria-live="polite">
            <i />
            <p>{currentState.feedbackL1}</p>
          </div>
        </div>
      )}

      <div className={uiClass("intro-experience-footer")}>
        <button
          type="button"
          className={uiClass("intro-primary-button")}
          onClick={onPrimaryAction}
        >
          {primaryActionLabel
            ?? (reopensReveal ? cardText('seeTheExpressionAgain') : isReplay ? cardText('returnToYourAnswer') : cardText('revealThisMeaning'))}
          <svg className={uiClass("icon")}>
            <use href={isReplay && !reopensReveal ? '#i-chev-r' : '#i-eye'} />
          </svg>
        </button>
        {experience.fallbackTextSceneL1 && (
          <button
            type="button"
            className={uiClass("intro-text-button")}
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
  experience: PrototypeTextExperience;
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
    <div className={uiClass(`intro-page intro-experience-page${isReplay ? ' is-replay' : ''}`)}>
      <div className={uiClass("intro-experience-heading")}>
        <span>{isReplay ? cardText('replayTheMeaningConnection') : cardText('buildANewMeaning')}</span>
        <h1>{isReplay ? cardText('revisitTheExperience') : cardText('experienceItFirst')}</h1>
      </div>

      <div className={uiClass("intro-text-fallback")} data-render-key={experience.renderKey}>
        <span>{cardText('textScene')}</span>
        <p>{experience.sceneL1}</p>
      </div>

      <div className={uiClass("intro-experience-footer")}>
        <button
          type="button"
          className={uiClass("intro-primary-button")}
          onClick={onPrimaryAction}
        >
          {primaryActionLabel
            ?? (reopensReveal ? cardText('seeTheExpressionAgain') : isReplay ? cardText('returnToYourAnswer') : cardText('revealThisMeaning'))}
          <svg className={uiClass("icon")}>
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

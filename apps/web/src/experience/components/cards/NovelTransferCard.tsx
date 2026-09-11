import {cardText} from '../../../i18n/originalCards';
import type { CardExecution } from './CardExecution';
import { uiClass } from '../../ui/classes';
import { useEffect, useMemo, useState } from 'react';
import type { NovelTransferAssessmentResource } from '../../content/assessmentResources';
import type { PrototypeIntroductionPackage } from '../../content/learningCatalog';
import type { NovelTransferOutcome } from '../../engine/types';
import type {
  DictionaryLookup,
  DictionaryLookupOptions,
  DictionaryLookupRequest,
  QuickDictEntry,
  SentenceToken,
} from '../../types';
import { ClickableSentence } from '../ClickableSentence';
import { PersonalConnectionActions } from '../PersonalConnectionActions';
import { QuickDictPopup } from '../QuickDictPopup';
import { useImmediateDictionaryLookup } from '../useImmediateDictionaryLookup';
import { ExperienceRenderer } from './ExperienceRenderer';

export interface NovelTransferCardProps {
  execution?: CardExecution;
  content: PrototypeIntroductionPackage;
  /** Exact Transfer Assessment Resource selected by the current Action. */
  assessment: NovelTransferAssessmentResource;
  purpose?: 'acquisition' | 'retention';
  onComplete: (outcome: NovelTransferOutcome, responseId?: string | null) => void;
  onOpenDictionary: (word: string | QuickDictEntry) => void;
  onOpenExample: () => void;
  onOpenNote: () => void;
  onOpenScene: (anchorId?: string) => void;
  lookupDictionary: DictionaryLookup;
  onViewChange: () => void;
  toast: (message: string) => void;
}

function visualFamilyForKind(visualKind: string): string {
  if (visualKind === 'living-material') return 'coral-growth';
  if (visualKind === 'thin-component' || visualKind === 'precision-equipment') return 'precision-sensor';
  if (visualKind === 'careful-handling' || visualKind === 'aged-material') return 'archaeology-bones';
  if (
    visualKind.includes('continuity')
    || visualKind === 'attention-continuity'
    || visualKind === 'interest-continuity'
    || visualKind === 'service-load'
  ) return 'continuity-flow';
  if (visualKind.includes('receiver') || visualKind.includes('provider')) return 'exchange';
  return 'generic';
}

function splitTransferSetup(text: string): string[] {
  const marker = '\u0000';
  const clauses = text
    .trim()
    .replace(/([,;:])\s+/g, `$1${marker}`)
    .replace(/\s+(because|so|while|when|but)\s+/gi, `${marker}$1 `)
    .split(marker)
    .map((clause) => clause.trim())
    .filter(Boolean);
  return clauses.length > 0 ? clauses : [text];
}

function TransferSceneVisual({
  visualKind,
  alt,
}: {
  visualKind: PrototypeIntroductionPackage['novelTransfer']['scenarios'][number]['visualKind'];
  alt: string;
}) {
  const normalizedKind = visualKind.replace(/_/g, '-');
  const visualFamily = visualFamilyForKind(normalizedKind);
  return (
    <div
      className={uiClass(`transfer-scene-visual visual-${normalizedKind} visual-${visualFamily}`)}
      role="img"
      aria-label={alt}
    >
      <span className={uiClass("transfer-scene-glow")} aria-hidden="true" />
      <span className={uiClass("transfer-scene-ground")} aria-hidden="true" />
      <span className={uiClass("transfer-scene-subject subject-a")} aria-hidden="true" />
      <span className={uiClass("transfer-scene-subject subject-b")} aria-hidden="true" />
      <span className={uiClass("transfer-scene-tool")} aria-hidden="true" />
      <i className={uiClass("transfer-scene-mark mark-a")} aria-hidden="true" />
      <i className={uiClass("transfer-scene-mark mark-b")} aria-hidden="true" />
      <i className={uiClass("transfer-scene-mark mark-c")} aria-hidden="true" />
    </div>
  );
}

export function NovelTransferCard({
  execution,
  content,
  assessment,
  purpose = 'acquisition',
  onComplete,
  onOpenDictionary,
  onOpenExample,
  onOpenNote,
  onOpenScene,
  lookupDictionary,
  onViewChange,
  toast,
}: NovelTransferCardProps) {
  if (
    assessment.packageKey !== content.packageKey
    || assessment.senseKey !== content.senseKey
  ) {
    throw new Error('Transfer card resource does not match the selected Package.');
  }
  const isRetention = purpose === 'retention';
  const scenario = assessment.scenario;
  const [selectedId, setSelectedId] = useState<string | null>(execution?.feedback?.answer || null);
  const [submitted, setSubmitted] = useState(!!execution?.feedback);
  const [uncertain, setUncertain] = useState(!!execution?.feedback && !execution.feedback.answer);
  const [replayingExperience, setReplayingExperience] = useState(false);
  const { activeLookup, openLookup, clearLookup } = useImmediateDictionaryLookup();

  useEffect(() => {
    if (execution) return;
    setSelectedId(null);
    setSubmitted(false);
    setUncertain(false);
    setReplayingExperience(false);
    clearLookup();
  }, [assessment.taskKey, clearLookup]);

  const selectedOption = useMemo(
    () => scenario.options.find((option) => option.id === selectedId) ?? null,
    [scenario.options, selectedId],
  );
  const correctOption = useMemo(
    () => scenario.options.find((option) => option.isCorrect) ?? null,
    [scenario.options],
  );
  const succeeded = selectedOption?.isCorrect === true && !uncertain;
  const outcome: NovelTransferOutcome = succeeded ? 'success' : 'repair';
  const feedbackTitle = succeeded
    ? scenario.successTitleL1
    : uncertain
    ? cardText('seeWhatThisNewSituationNeeds')
    : selectedOption?.feedbackTitleL1;
  const feedbackBody = succeeded
    ? scenario.successBodyL1
    : uncertain
    ? correctOption?.feedbackBodyL1
    : selectedOption?.feedbackBodyL1;

  if (!scenario || !correctOption) return null;

  const reveal = scenario.revealExample;
  const revealHtml = `${reveal.textL2.slice(0, reveal.targetStart)}<b>${reveal.targetSurface}</b>${reveal.textL2.slice(reveal.targetEnd)}`;
  const setupClauses = splitTransferSetup(scenario.setupL2);

  const lookupToken = async (
    token: SentenceToken,
    contextualExample?: { exampleKey: string; textL2: string },
    options?: DictionaryLookupOptions,
  ): Promise<QuickDictEntry | null> => {
    const input: string | DictionaryLookupRequest = contextualExample
      ? {
          rawClickedForm: token.text,
          exampleId: contextualExample.exampleKey,
          textL2: contextualExample.textL2,
          clickedStart: token.charStart,
          clickedEnd: token.charEnd,
          clickedSurface: token.text,
        }
      : token.cleanWord;
    const entry = await lookupDictionary(input, options);
    if (!entry) toast(cardText('thisWordIsNotInTheDictionary'));
    return entry;
  };

  const supportActions = (
    <div className={uiClass("transfer-support-actions")}>
      <button
        type="button"
        className={uiClass(succeeded ? '' : 'emphasized')}
        onClick={() => {
          clearLookup();
          onViewChange();
          setReplayingExperience(true);
        }}
      >
        <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-eye" /></svg>{cardText('compareWithTheOriginalExperience')}<svg className={uiClass("icon chevron")} aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
      <button
        type="button"
        onClick={() => {
          clearLookup();
          onOpenExample();
        }}
      >
        <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-bookopen" /></svg>{cardText('viewLearningExamples')}<svg className={uiClass("icon chevron")} aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
      <button
        type="button"
        onClick={() => {
          clearLookup();
          onOpenDictionary(content.lemma);
        }}
      >
        <svg className={uiClass("icon")} aria-hidden="true"><use href="#i-search" /></svg>{cardText('openTheFullDictionary')}<svg className={uiClass("icon chevron")} aria-hidden="true"><use href="#i-chev-r" /></svg>
      </button>
    </div>
  );

  if (replayingExperience) {
    return (
      <ExperienceRenderer
        experience={content.experience}
        mode="replay"
        onPrimaryAction={() => {
          onViewChange();
          setReplayingExperience(false);
        }}
      />
    );
  }

  return (
    <div
      className={uiClass("transfer-page is-sensa")}
      data-assessment-task-key={assessment.taskKey}
    >
      <header className={uiClass("transfer-heading")}>
        <span>
          {isRetention
              ? cardText('reviewTransferToANewContext')
              : submitted ? succeeded ? cardText('transferCheckEstablished') : cardText('transferCheckNeedsRepair') : cardText('transferCheckUnseenContext')}
        </span>
        <h1>
          {isRetention
              ? cardText('canYouRecognizeItInANewSituation')
              : submitted ? feedbackTitle : cardText('takeThisMeaningSomewhereNew')}
        </h1>
        <p>
          {isRetention
              ? cardText('theExpressionStaysHiddenUseTheSituationTo')
              : submitted ? feedbackBody : cardText('judgeTheRelationshipFirstTheExpressionAppearsAfter')}
        </p>
      </header>

      {!submitted && (
        <>
          <section className={uiClass("transfer-scene-card")} aria-label={scenario.sceneLabelL1}>
            <div className={uiClass("transfer-scene-label")}>
              <span>{scenario.sceneLabelL1}</span>
              <i aria-hidden="true" />
              <small>{cardText('expressionHidden')}</small>
            </div>
            <TransferSceneVisual visualKind={scenario.visualKind} alt={scenario.visualAltL1} />
            <div className={uiClass("transfer-scene-copy")}>
              <div className={uiClass("transfer-scene-l1")}>
                <span>{cardText('chineseContext')}</span>
                <p>{scenario.setupL1}</p>
              </div>
              <div className={uiClass("transfer-scene-l2")}>
                <span>{cardText('englishContext')}<small>{cardText('tapWordsForDefinitions')}</small></span>
                <div>
                  {setupClauses.map((clause, clauseIndex) => (
                    <span key={`${scenario.id}:clause:${clauseIndex}`}>
                      <ClickableSentence
                        sentenceHtml={clause}
                        activeTokenIdx={null}
                        onWordClick={(token, tokenIdx) => {
                          openLookup({
                            tokenIdx,
                            displayWord: token.cleanWord,
                            load: (signal) => lookupToken(
                              token,
                              {
                                exampleKey: `${scenario.id}:setup:${clauseIndex}`,
                                textL2: clause,
                              },
                              { signal },
                            ),
                          });
                        }}
                      />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className={uiClass("transfer-question-block")}>
            <span>{cardText('yourJudgement')}</span>
            <h2 className={uiClass("transfer-question")}>{scenario.questionL1}</h2>
          </div>

          <div className={uiClass("transfer-actions")} role="radiogroup" aria-label={scenario.questionL1}>
            {scenario.options.map((option, index) => {
              const selected = option.id === selectedId;
              const classes = ['transfer-action'];
              if (!submitted && selected) classes.push('selected');
              if (submitted && option.isCorrect) classes.push('right');
              if (submitted && selected && !option.isCorrect) classes.push('wrong');
              if (submitted && !option.isCorrect && !selected) classes.push('mute');

              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={submitted}
                  className={uiClass(classes.join(' '))}
                  key={option.id}
                  onClick={() => setSelectedId(option.id)}
                >
                  <span className={uiClass("transfer-action-index")} aria-hidden="true">
                    {String.fromCharCode(65 + index)}
                  </span>
                  <span className={uiClass("transfer-action-copy")}>
                    <strong>{option.labelL1}</strong>
                    {(submitted && (selected || option.isCorrect)) && (
                      <small>{option.detailL1}</small>
                    )}
                  </span>
                  {submitted && option.isCorrect && (
                    <span className={uiClass("transfer-action-status")} aria-label={cardText('fits')}>✓</span>
                  )}
                  {submitted && selected && !option.isCorrect && (
                    <span className={uiClass("transfer-action-status")} aria-label={cardText('doesNotFit')}>×</span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {submitted && (
        <section className={uiClass(`transfer-feedback ${succeeded ? 'success' : 'repair'}`)} aria-live="polite">
          <div className={uiClass("transfer-sensa-connection")} aria-label={cardText('meaningTransfer')}>
            <div>
              <small>{cardText('familiarObject')}</small>
              <strong>{scenario.sourceObjectL1}</strong>
            </div>
            <span aria-hidden="true"><i />→<i /></span>
            <div>
              <small>{cardText('newObject')}</small>
              <strong>{scenario.targetObjectL1}</strong>
            </div>
            <p>{cardText('theObjectChangedTheMeaningStructureStayedThe')}</p>
            <ol>
              {scenario.invariantLabelsL1.map((label) => <li key={label}>{label}</li>)}
            </ol>
          </div>

          <div className={uiClass("transfer-reveal-example")}>
            <span>{cardText('expressionRevealed')}</span>
            <div className={uiClass("transfer-reveal-sentence")}>
              <ClickableSentence
                sentenceHtml={revealHtml}
                activeTokenIdx={activeLookup?.tokenIdx ?? null}
                onWordClick={(token, tokenIdx) => {
                  openLookup({
                    tokenIdx,
                    displayWord: token.cleanWord,
                    load: (signal) => lookupToken(
                      token,
                      reveal,
                      { signal },
                    ),
                  });
                }}
              />
            </div>
            <p>{reveal.textL1}</p>
            <small>{cardText('tapAWordForItsMeaning')}</small>
          </div>

          <details className={uiClass("transfer-support-disclosure")} open={!succeeded}>
            <summary>{succeeded ? cardText('needToReplayOrLookUpAWord') : cardText('repairThisConnectionFirst')}</summary>
            {supportActions}
          </details>
        </section>
      )}

      {submitted && (
        <PersonalConnectionActions
          senseId={content.senseKey}
          onOpenNote={onOpenNote}
          onOpenScene={onOpenScene}
          variant="compact"
        />
      )}

      <div className={uiClass("lfoot transfer-footer", "#lFoot")} id="lFoot">
        {!submitted ? (
          <div className={uiClass("transfer-submit-stack")}>
            <button
              type="button"
              className={uiClass("transfer-submit-button")}
              disabled={!selectedOption}
              onClick={() => {
                clearLookup();
                onViewChange();
                if (execution) {
                  execution.submit(selectedOption?.id ?? null);
                } else if (isRetention) {
                  onComplete(outcome, selectedOption?.id ?? null);
                } else {
                  setSubmitted(true);
                }
              }}
            >
              {isRetention ? cardText('submitThisCheck') : cardText('submitYourJudgement')}
            </button>
            <button
              type="button"
              className={uiClass("transfer-uncertain-button")}
              onClick={() => {
                clearLookup();
                onViewChange();
                if (execution) {
                  execution.submit(null);
                } else if (isRetention) {
                  onComplete('repair', null);
                } else {
                  setUncertain(true);
                  setSelectedId(null);
                  setSubmitted(true);
                }
              }}
            >
              {isRetention ? cardText('iCannotJudgeYetBeginRepair') : cardText('iCannotJudgeYet')}
            </button>
          </div>
        ) : (
          <button type="button" className={uiClass("fbtn green")} onClick={() => execution ? execution.continue() : onComplete(outcome, selectedOption?.id ?? null)}>
            {succeeded ? cardText('finishThisCheck') : cardText('repairFirstAndTryAgainLater')}<i />
          </button>
        )}
      </div>

      {activeLookup && (
        <QuickDictPopup
          entry={activeLookup.entry}
          onClose={clearLookup}
          toast={toast}
          onViewDetail={(word, contextualEntry) => {
            clearLookup();
            onOpenDictionary(contextualEntry ?? word);
          }}
        />
      )}
    </div>
  );
}

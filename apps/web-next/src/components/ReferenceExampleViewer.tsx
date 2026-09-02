import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ReferenceExample,
  ReferenceSense,
} from '../reference/referenceDictionary';
import { resolveLookupLemma } from '../reference/resolveClickedLemma';
import { tokenizeSentence } from '../utils/sentenceTokenizer';
import { ClickableSentence } from './ClickableSentence';
import { ExampleCardCarousel } from './examples/ExampleCardCarousel';

export interface ReferenceExampleDeck {
  headword: string;
  forms: readonly string[];
  sense: ReferenceSense;
}

interface ReferenceExampleViewerProps {
  active: boolean;
  deck: ReferenceExampleDeck | null;
  onClose: () => void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Highlight only an occurrence that the contextual lemmatizer resolves. */
export function emphasizeReferenceExample(
  example: ReferenceExample,
  headword: string,
  forms: readonly string[],
): string {
  const normalizedHeadword = headword.toLocaleLowerCase('en-US');
  const knownForms = new Set(
    [headword, ...forms].map((form) => form.toLocaleLowerCase('en-US')),
  );
  const { tokens } = tokenizeSentence(example.textL2);
  const target = tokens.find((token) => {
    if (!token.isWord) return false;
    const surface = token.cleanWord.toLocaleLowerCase('en-US');
    if (knownForms.has(surface)) return true;
    return resolveLookupLemma({
      rawClickedForm: token.cleanWord,
      exampleId: example.exampleId,
      textL2: example.textL2,
      clickedStart: token.charStart,
      clickedEnd: token.charEnd,
      clickedSurface: example.textL2.slice(token.charStart, token.charEnd),
    }).lemma === normalizedHeadword;
  });
  if (!target) return escapeHtml(example.textL2);
  return [
    escapeHtml(example.textL2.slice(0, target.charStart)),
    '<b>',
    escapeHtml(example.textL2.slice(target.charStart, target.charEnd)),
    '</b>',
    escapeHtml(example.textL2.slice(target.charEnd)),
  ].join('');
}

export function ReferenceExampleViewer({
  active,
  deck,
  onClose,
}: ReferenceExampleViewerProps) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(true);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const examples = deck?.sense.examples ?? [];
  const example = examples[exampleIndex] ?? null;
  const sentenceHtml = useMemo(() => (
    example && deck
      ? emphasizeReferenceExample(example, deck.headword, deck.forms)
      : ''
  ), [deck, example]);

  useEffect(() => {
    setExampleIndex(0);
    setShowTranslation(true);
  }, [active, deck?.sense.referenceSenseId]);

  useEffect(() => {
    if (!active) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && exampleIndex > 0) {
        setExampleIndex((index) => index - 1);
      }
      if (event.key === 'ArrowRight' && exampleIndex < examples.length - 1) {
        setExampleIndex((index) => index + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [active, exampleIndex, examples.length, onClose]);

  if (!deck || examples.length === 0) return null;

  const definition = deck.sense.glossL1
    ?? deck.sense.definitionL2
    ?? 'Definition unavailable';

  return (
    <section
      className={`screen reference-example-screen${active ? ' active' : ''}`}
      id="s-reference-example"
      data-anim="slide"
      aria-hidden={!active}
    >
      <header className="reference-example-header">
        <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="返回词典">
          <svg className="icon" aria-hidden="true"><use href="#i-chev-l" /></svg>
        </button>
        <div>
          <strong>{deck.headword}</strong>
          <span>{deck.sense.partOfSpeech} · 词典例句</span>
        </div>
        <i aria-hidden="true" />
      </header>

      <main className="reference-example-body">
        <ExampleCardCarousel
          itemCount={examples.length}
          currentIndex={exampleIndex}
          onIndexChange={setExampleIndex}
          itemKeys={examples.map((item) => item.exampleId)}
          className="reference-example-carousel"
        >
          {example && (
            <article className="reference-example-card">
              <div className="reference-example-source">
                <span>词典例句</span>
                <strong>{example.sourceLabel}</strong>
              </div>

              <section className="reference-example-sentence" aria-label="当前词典例句">
                <ClickableSentence sentenceHtml={sentenceHtml} />
                {showTranslation && example.textL1 && <p>{example.textL1}</p>}
                {example.textL1 && (
                  <button
                    type="button"
                    onClick={() => setShowTranslation((visible) => !visible)}
                  >
                    {showTranslation ? '隐藏译文' : '显示译文'}
                  </button>
                )}
              </section>

              <section className="reference-example-sense">
                <span>对应义项</span>
                <strong>{deck.sense.partOfSpeech}</strong>
                <p lang={deck.sense.glossL1 ? undefined : 'en'}>{definition}</p>
              </section>
            </article>
          )}
        </ExampleCardCarousel>
      </main>

      <footer className="reference-example-footer">
        <button type="button" onClick={onClose}>返回词典</button>
        <p>例句来自当前在线词典，不会进入学习进度。</p>
      </footer>
    </section>
  );
}

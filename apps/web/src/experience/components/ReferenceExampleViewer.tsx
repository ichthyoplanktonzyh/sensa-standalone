import { ArrowLeft, BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setupButton, setupPrimary } from './learning/LearningSetupFrame';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ReferenceExample,
  ReferenceRelease,
  ReferenceSense,
} from '../reference/referenceDictionary';
import { resolveLookupLemma } from '../reference/resolveClickedLemma';
import { sensaLanguage, type SensaLanguage } from '@sensa/contracts/sensa';
import { ExampleCardCarousel } from './examples/ExampleCardCarousel';

export interface ReferenceExampleDeck {
  headword: string;
  forms: readonly string[];
  sense: ReferenceSense;
  /** The release the example came from. Its target language is what the
   * occurrence highlighting folds and lemmatizes against; a deck without it
   * would fall back to English rules over another language's text. */
  release: ReferenceRelease;
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

/** Highlight only an occurrence that the contextual lemmatizer resolves.
 *
 * Tokens keep every letter of every script, so a Spanish `niño` is one word
 * instead of `ni` and `o`, and case folding follows the example's own language.
 * `language` absent keeps the historical English behavior. */
export function emphasizeReferenceExample(
  example: ReferenceExample,
  headword: string,
  forms: readonly string[],
  language?: SensaLanguage,
): string {
  const locale = language?.speechLocale ?? 'en-US';
  const normalizedHeadword = headword.toLocaleLowerCase(locale);
  const knownForms = new Set(
    [headword, ...forms].map((form) => form.toLocaleLowerCase(locale)),
  );
  // Reference text is plain text, not the learning viewer's markup format.
  // Match against the original string so punctuation and literal tags keep exact offsets.
  const tokens = [...example.textL2.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)?/gu)].map(match => ({
    cleanWord: match[0].replace(/['’]/g, "'"),
    charStart: match.index,
    charEnd: match.index + match[0].length,
  }));
  const target = tokens.find((token) => {
    const surface = token.cleanWord.toLocaleLowerCase(locale);
    if (knownForms.has(surface)) return true;
    return resolveLookupLemma({
      rawClickedForm: token.cleanWord,
      exampleId: example.exampleId,
      textL2: example.textL2,
      clickedStart: token.charStart,
      clickedEnd: token.charEnd,
      clickedSurface: example.textL2.slice(token.charStart, token.charEnd),
    }, language).lemma === normalizedHeadword;
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

export function ReferenceExampleViewer({ active, deck, onClose }: ReferenceExampleViewerProps) {
  const { t } = useTranslation();
  const [exampleIndex, setExampleIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(true);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLElement>(null);
  const savedScroll = useRef(0);
  const lastIdentity = useRef('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const examples = deck?.sense.examples ?? [];
  // Keep position when closing and reopening the same immutable reference context.
  const identity = deck ? JSON.stringify([deck.headword, deck.sense.referenceSenseId, examples.map(item => item.exampleId)]) : '';
  const example = examples[Math.min(exampleIndex, Math.max(0, examples.length - 1))] ?? null;
  const sentenceHtml = useMemo(() => example && deck
    ? emphasizeReferenceExample(
        example,
        deck.headword,
        deck.forms,
        sensaLanguage(deck.release.targetLanguage),
      ) : '', [deck, example]);

  useEffect(() => {
    if (!identity || identity === lastIdentity.current) return;
    lastIdentity.current = identity;
    setExampleIndex(0);
    setShowTranslation(true);
    savedScroll.current = 0;
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [identity]);

  useEffect(() => {
    if (!active) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
      if (bodyRef.current) bodyRef.current.scrollTop = savedScroll.current;
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus();
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.target instanceof HTMLElement && event.target.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft' && exampleIndex > 0) {
        event.preventDefault(); setExampleIndex(index => index - 1);
      }
      if (event.key === 'ArrowRight' && exampleIndex < examples.length - 1) {
        event.preventDefault(); setExampleIndex(index => index + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, exampleIndex, examples.length]);

  const definition = deck?.sense.glossL1 || deck?.sense.definitionL2 || t('referenceExample.noDefinition');

  return <section
    className={`screen absolute inset-0 z-[40] flex flex-col overflow-hidden bg-surface-canvas font-product text-fg-primary ${active ? 'active' : 'invisible pointer-events-none'}`}
    id="s-reference-example" data-screen-layer="2" data-anim="slide" aria-hidden={!active} inert={!active}
  >
    <header className="flex shrink-0 items-center gap-4 border-b border-border-subtle px-6 py-4 sm:px-10">
      <button ref={closeButtonRef} type="button" onClick={onClose} aria-label={t('referenceExample.back')} className={setupButton + ' size-11 shrink-0 px-0 text-action-primary hover:bg-surface-selected'}><ArrowLeft size={20}/></button>
      <div className="min-w-0">
        <p className="text-xs text-fg-secondary">{t('referenceExample.title')}</p>
        <h1 className="mt-1 break-words text-xl font-medium">{deck?.headword || t('referenceExample.unavailable')}</h1>
      </div>
    </header>

    <main ref={bodyRef} onScroll={event => { if (active) savedScroll.current = event.currentTarget.scrollTop; }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-10 sm:py-10">
      <div className="mx-auto max-w-3xl [&_.sensa-example-pagination]:mt-6 [&_.sensa-example-pagination>div]:flex-wrap [&_.sensa-example-pagination>div>button]:size-11 [&_.sensa-example-pagination>div>button]:rounded-control [&_.sensa-example-pagination>div>button]:bg-border-subtle [&_.sensa-example-pagination>div>button.active]:bg-action-primary [&_.sensa-example-pagination>div>button.active]:transform-none motion-reduce:[&_.example-card-carousel]:transition-none!">
        {example && deck ? <ExampleCardCarousel itemCount={examples.length} currentIndex={exampleIndex} onIndexChange={setExampleIndex} itemKeys={examples.map(item => item.exampleId)}>
          <article className="overflow-hidden rounded-overlay border border-border-subtle bg-surface-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-6 py-5 text-xs text-fg-secondary">
              <span className="inline-flex items-center gap-2"><BookOpen size={16}/>{t('referenceExample.title')}</span>
              <span>{example.sourceLabel || t('referenceExample.noSource')}</span>
            </div>
            <section className="p-6 sm:p-8" aria-label={t('referenceExample.current')}>
              {/* emphasizeReferenceExample escapes every source-text segment; only its own b tags remain. */}
              <p lang="en" className="whitespace-pre-wrap break-words text-2xl leading-relaxed sm:text-3xl [&_b]:font-medium [&_b]:text-action-primary" dangerouslySetInnerHTML={{ __html: sentenceHtml }}/>
              {showTranslation && example.textL1 && <p className="mt-6 border-l-2 border-border-strong pl-4 text-base leading-7 text-fg-secondary">{example.textL1}</p>}
              {example.textL1 ? <button type="button" aria-expanded={showTranslation} className={setupButton + ' mt-3 px-0 text-action-primary'} onClick={() => setShowTranslation(visible => !visible)}>
                {t(showTranslation ? 'referenceExample.hideTranslation' : 'referenceExample.showTranslation')}
              </button> : <p className="mt-6 text-xs text-fg-secondary">{t('referenceExample.noTranslation')}</p>}
            </section>
            <section className="mx-6 mb-6 rounded-card bg-accent-soft p-6 text-action-primary">
              <h2 className="text-xs">{t('referenceExample.sense')}</h2>
              <p className="mt-3 text-base leading-7" lang={deck.sense.glossL1 ? undefined : 'en'}><span className="mr-2 text-sm text-fg-secondary">{deck.sense.partOfSpeech}</span>{definition}</p>
            </section>
          </article>
        </ExampleCardCarousel> : <section role="status" className="rounded-overlay border border-dashed border-border-strong bg-surface-panel p-8 text-center">
          <BookOpen size={28} className="mx-auto mb-4 text-fg-secondary"/>
          <h2 className="text-xl font-medium">{t('referenceExample.empty')}</h2>
          <p className="mt-3 text-sm leading-7 text-fg-secondary">{t('referenceExample.emptyHint')}</p>
        </section>}
        {examples.length > 0 && <p role="status" className="mt-4 text-center text-xs tabular-nums text-fg-secondary">{t('referenceExample.position', { current: exampleIndex + 1, total: examples.length })}</p>}
      </div>
    </main>

    <footer className="shrink-0 border-t border-border-subtle px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <button type="button" onClick={onClose} className={setupPrimary + ' w-full max-w-3xl'}>{t('referenceExample.back')}</button>
      <p className="mt-3 text-xs leading-5 text-fg-secondary">{t('referenceExample.boundary')}</p>
    </footer>
  </section>;
}

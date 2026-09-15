import { presentScreen, foregroundScreen } from './screenInteraction';
import { BookOpen, House, Layers3, Settings2, Compass } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useModalFocus } from './useModalFocus';
import { SensaApplicationShellLayout } from './SensaPageLayouts';

const sections = [
  { id: 's-home', label: 'nav.home', icon: House },
  { id: 's-content', label: 'nav.content', icon: BookOpen },
  { id: 's-study', label: 'nav.learning', icon: Layers3 },
  { id: 's-academy', label: 'nav.practice', icon: Compass },
] as const;

export function WebShell({ children, current, focused, onNavigate, availableSections }: {
  children: ReactNode; current: string; focused: boolean; onNavigate: (id: string) => void; availableSections?: readonly string[];
}) {
  const { t } = useTranslation();
  const visibleSections = sections.filter(section => !availableSections || availableSections.includes(section.id));
  const viewport = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useModalFocus(shell);
  // Keep the reference's mounted screen stack and scroll positions, while only
  // the foreground surface participates in keyboard navigation and accessibility.
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const original = new Map<HTMLElement, string>();
    const update = () => {
      const screens = [...node.querySelectorAll<HTMLElement>(':scope > .screen')];
      for (const s of screens) {
        if (!original.has(s)) original.set(s, s.style.cssText);
      }
      const front = foregroundScreen(screens,current,focused,s=>Number(getComputedStyle(s).zIndex));
      for (const s of screens) {
        presentScreen(s, s === front, focused);
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => { observer.disconnect(); original.forEach((style, screen) => { screen.style.cssText = style; }); };
  }, [current, focused]);
  const selectedSection = current.startsWith('s-learning') || current === 's-stats' ? 's-study'
    : ['s-semantic-world','s-personal-meaning','s-confirmed-sense','s-expression-binding'].includes(current) ? 's-content'
    : current.startsWith('s-content') ? 's-content' : current;
  const brand = (
    <button type="button" data-sensa-shell-brand-action onClick={() => onNavigate('s-home')} aria-label={t('nav.homeLabel')}>
      <span data-sensa-shell-brand-mark aria-hidden="true"><i/><i/></span>
      <span data-sensa-shell-brand-word>sensa</span>
    </button>
  );
  const navigation = (
    <nav
      data-sensa-shell-navigation
      aria-label={t('nav.label')}
      style={{ '--sensa-shell-navigation-count': visibleSections.length } as CSSProperties}
    >
      {visibleSections.map(({id,label,icon:Icon}) => (
        <button
          type="button"
          data-sensa-shell-navigation-item
          data-selected={selectedSection === id ? '' : undefined}
          key={id}
          onClick={() => onNavigate(id)}
          aria-current={selectedSection === id ? 'page' : undefined}
        >
          <span data-sensa-shell-item-icon><Icon aria-hidden="true" size={18} strokeWidth={1.5}/></span>
          <span data-sensa-shell-item-label>{t(label)}</span>
        </button>
      ))}
    </nav>
  );
  const utilities = (
    <div data-sensa-shell-utilities>
      <button
        type="button"
        data-sensa-shell-utility-action
        data-selected={current === 's-profile' ? '' : undefined}
        onClick={() => onNavigate('s-profile')}
        aria-current={current === 's-profile' ? 'page' : undefined}
        aria-label={t('nav.settings')}
      >
        <Settings2 aria-hidden="true" size={18} strokeWidth={1.5}/>
        <span data-sensa-shell-utility-label>{t('nav.settings')}</span>
      </button>
      <LanguageSwitch/>
    </div>
  );
  return (
    <SensaApplicationShellLayout
      ref={shell}
      className="font-product text-fg-primary antialiased selection:bg-selection"
      regions={{
        chrome: focused ? undefined : { brand, navigation, utilities },
        viewport: <div ref={viewport} className="absolute inset-0 isolate transform-gpu overflow-hidden">{children}</div>,
      }}
    />
  );
}

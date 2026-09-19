import { presentScreen, foregroundScreen } from './screenInteraction';
import type { CSSProperties, ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useModalFocus } from './useModalFocus';
import { SensaApplicationShellLayout } from './SensaPageLayouts';
import { SensaSkinIcon } from '../appearance/SensaSkinAssets';
import { SensaLogo } from '../brand/SensaLogo';

const sections = [
  { id: 's-home', label: 'nav.home', iconRole: 'navigation-home' },
  { id: 's-content', label: 'nav.content', iconRole: 'navigation-world' },
  { id: 's-study', label: 'nav.learning', iconRole: 'navigation-learning' },
  { id: 's-academy', label: 'nav.practice', iconRole: 'navigation-practice' },
] as const;

export function WebShell({ children, current, focused, onNavigate, availableSections }: {
  children: ReactNode; current: string; focused: boolean; onNavigate: (id: string) => void; availableSections?: readonly string[];
}) {
  const { t } = useTranslation();
  const visibleSections = sections.filter(section => !availableSections || availableSections.includes(section.id));
  const viewport = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useModalFocus(shell);
  // Only URL-stack screens are mounted. Keep those retained screens and their
  // scroll positions, while only the foreground surface participates in input.
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
    // Every relevant screen is a direct viewport child. Do not observe class
    // churn inside whole pages: only stack membership and root activity matter.
    observer.observe(node, { childList: true, attributes: true, attributeFilter: ['class'] });
    return () => { observer.disconnect(); original.forEach((style, screen) => { screen.style.cssText = style; }); };
  }, [current, focused]);
  const selectedSection = current.startsWith('s-learning') || current === 's-stats' ? 's-study'
    : ['s-semantic-world','s-personal-meaning','s-confirmed-sense','s-expression-binding'].includes(current) ? 's-content'
    : current.startsWith('s-content') ? 's-content' : current;
  const brand = (
    <button type="button" data-sensa-shell-brand-action onClick={() => onNavigate('s-home')} aria-label={t('nav.homeLabel')}>
      <SensaLogo data-sensa-shell-brand-mark />
    </button>
  );
  const navigation = (
    <nav
      data-sensa-shell-navigation
      aria-label={t('nav.label')}
      style={{ '--sensa-shell-navigation-count': visibleSections.length } as CSSProperties}
    >
      {visibleSections.map(({id,label,iconRole}) => (
        <button
          type="button"
          data-sensa-shell-navigation-item
          data-selected={selectedSection === id ? '' : undefined}
          key={id}
          onClick={() => onNavigate(id)}
          aria-current={selectedSection === id ? 'page' : undefined}
        >
          <span data-sensa-shell-item-icon><SensaSkinIcon role={iconRole} aria-hidden="true" size={18}/></span>
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
        <SensaSkinIcon role="navigation-settings" aria-hidden="true" size={18}/>
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

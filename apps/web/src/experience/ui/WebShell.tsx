import { presentScreen, foregroundScreen } from './screenInteraction';
import { BookOpen, House, Layers3, Settings2, Compass } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useModalFocus } from './useModalFocus';

const sections = [
  { id: 's-home', label: 'nav.home', icon: House },
  { id: 's-content', label: 'nav.content', icon: BookOpen },
  { id: 's-study', label: 'nav.learning', icon: Layers3 },
  { id: 's-academy', label: 'nav.practice', icon: Compass },
] as const;

export function WebShell({ children, current, focused, onNavigate }: {
  children: ReactNode; current: string; focused: boolean; onNavigate: (id: string) => void;
}) {
  const { t } = useTranslation();
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
  return <div ref={shell} className="fixed inset-0 bg-[#fbfbfa] font-sans text-[#222631] antialiased selection:bg-[#dfe4fb]">
    {!focused && <aside className="fixed inset-y-0 left-0 z-50 hidden w-56 flex-col border-r border-[#e4e6eb] bg-[#f4f5f7] px-4 py-8 lg:flex">
      <button onClick={() => onNavigate('s-home')} className="mb-12 flex min-h-11 items-center gap-3 px-4 text-left" aria-label={t('nav.homeLabel')}>
        <span aria-hidden="true" className="flex size-7 items-center justify-center gap-1"><i className="h-5 w-1.5 -rotate-[25deg] rounded-full bg-[#3b466c]"/><i className="h-7 w-1.5 -rotate-[25deg] rounded-full bg-[#7783a5]"/></span>
        <span className="text-2xl font-semibold tracking-[-0.06em]">sensa</span>
      </button>
      <nav className="flex flex-col gap-1.5" aria-label={t('nav.label')}>
        {sections.map(({id,label,icon:Icon}) => <button key={id} onClick={() => onNavigate(id)} aria-current={selectedSection === id ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-lg px-4 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[#3c51ad] ${selectedSection === id ? 'bg-[#e6e9f2] font-medium text-[#303e73]' : 'text-[#6d7380] hover:bg-[#e8ebf0] hover:text-[#222631]'}`}><Icon size={18} strokeWidth={1.5}/>{t(label)}</button>)}
      </nav>
      <div className="mt-auto border-t border-[#e0e3e9] pt-4">
        <button onClick={() => onNavigate('s-profile')} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-4 text-sm text-[#6d7380] hover:bg-[#e8ebf0]" aria-current={current==='s-profile'?'page':undefined}><Settings2 size={18} strokeWidth={1.5}/>{t('nav.settings')}</button>
        <div className="ml-2 mt-2 w-fit"><LanguageSwitch/></div>
      </div>
    </aside>}
    {!focused && <header className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-[#e4e6eb] bg-[#fbfbfa] px-5 lg:hidden">
      <button onClick={() => onNavigate('s-home')} aria-label={t('nav.homeLabel')} className="min-h-11 text-xl font-semibold tracking-[-0.05em]">sensa</button>
      <div className="flex items-center gap-2"><LanguageSwitch/><button onClick={() => onNavigate('s-profile')} aria-label={t('nav.settings')} className="grid size-11 place-items-center rounded-lg text-[#6d7380] hover:bg-[#e8ebf0]"><Settings2 size={18}/></button></div>
    </header>}
    <div ref={viewport} className={`absolute inset-0 isolate transform-gpu overflow-hidden ${focused ? '' : 'top-16 bottom-20 lg:top-0 lg:bottom-0 lg:left-56'}`}>
      {children}
    </div>
    {!focused && <nav aria-label={t('nav.mobile')} className="fixed inset-x-0 bottom-0 z-50 grid h-20 grid-cols-4 border-t border-[#e4e6eb] bg-[#fbfbfa] px-2 pb-[env(safe-area-inset-bottom)] lg:hidden">
      {sections.map(({id,label,icon:Icon}) => <button key={id} onClick={() => onNavigate(id)} aria-current={selectedSection===id?'page':undefined} className={`flex min-w-0 flex-col items-center justify-center gap-1.5 text-[10px] ${selectedSection===id?'text-[#303e73]':'text-[#6d7380]'}`}><span className={`grid h-7 w-12 place-items-center rounded-lg ${selectedSection===id?'bg-[#e6e9f2]':''}`}><Icon size={18} strokeWidth={1.5}/></span><span className="text-center leading-tight">{t(label)}</span></button>)}
    </nav>}
  </div>;
}

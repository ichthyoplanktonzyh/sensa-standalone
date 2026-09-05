import { BookOpen, House, Layers3, Settings2, Sprout, ArrowUpRight, Compass } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import { useModalFocus } from './useModalFocus';

const sections = [
  { id: 's-home', label: '今日学习', icon: House },
  { id: 's-content', label: '我的内容', icon: BookOpen },
  { id: 's-semantic-world', label: '我的词义世界', icon: Sprout },
  { id: 's-study', label: '我的学习', icon: Layers3 },
  { id: 's-academy', label: '自由练习', icon: Compass },
] as const;

export function WebShell({ children, current, focused, onNavigate }: {
  children: ReactNode; current: string; focused: boolean; onNavigate: (id: string) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  useModalFocus(shell);
  // Keep the reference's mounted screen stack and scroll positions, while only
  // the foreground surface participates in keyboard navigation and accessibility.
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () => {
      const screens = [...node.querySelectorAll<HTMLElement>(':scope > .screen')];
      const active = screens.filter(s => s.classList.contains('active'));
      let front = focused ? active.reduce<HTMLElement | undefined>((best, s) => !best || Number(getComputedStyle(s).zIndex) >= Number(getComputedStyle(best).zIndex) ? s : best, undefined) : screens.find(s => s.id === current);
      for (const s of screens) {
        s.inert = s !== front;
        s.setAttribute('aria-hidden', String(s !== front));
      }
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [current, focused]);
  return <div ref={shell} className="fixed inset-0 bg-paper font-sans text-ink antialiased selection:bg-accent/15">
    {!focused && <aside className="fixed inset-y-0 left-0 z-50 hidden w-60 flex-col border-r border-line bg-white px-5 py-8 lg:flex xl:w-64 xl:px-6">
      <button onClick={() => onNavigate('s-home')} className="mb-12 flex min-h-11 items-center gap-3 px-3 text-left" aria-label="Sensa 首页">
        <span className="grid size-10 place-items-center rounded-2xl bg-accent text-white"><Sprout size={23} strokeWidth={1.5} /></span>
        <span className="font-editorial text-3xl tracking-tight">sensa<span className="text-clay">.</span></span>
      </button>
      <span className="mb-4 px-4 text-xs tracking-widest text-muted">你的学习空间</span>
      <nav className="flex flex-col gap-2" aria-label="主要导航">
        {sections.map(({id,label,icon:Icon}) => <button key={id} onClick={() => onNavigate(id)} aria-current={current === id ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-4 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${current === id ? 'bg-sage text-accent' : 'text-muted hover:bg-paper hover:text-ink'}`}><Icon size={19} strokeWidth={1.6}/>{label}{current===id&&<span className="ml-auto size-1.5 rounded-full bg-accent"/>}</button>)}
      </nav>
      <div className="mt-auto">
        <div className="mb-7 rounded-2xl bg-paper p-5"><Sprout className="mb-3 text-accent" size={24} strokeWidth={1.3}/><p className="text-sm leading-7 text-muted">从一个真实的场景，<br/>生长出自己的表达。</p><button onClick={() => onNavigate('s-semantic-world')} className="mt-4 flex min-h-11 items-center gap-2 text-xs font-semibold text-accent">去我的词义世界 <ArrowUpRight size={15}/></button></div>
        <button onClick={() => onNavigate('s-profile')} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-4 text-sm text-muted hover:bg-sage" aria-current={current==='s-profile'?'page':undefined}><Settings2 size={18}/>账号与设置</button>
        <div className="mt-4 flex items-center gap-2 border-t border-line px-4 pt-5 text-xs text-muted"><span className="size-1.5 rounded-full bg-clay"/>界面预览 · 本机数据</div>
      </div>
    </aside>}
    <div ref={viewport} className={`absolute inset-0 isolate transform-gpu overflow-hidden ${focused ? '' : 'bottom-20 lg:bottom-0 lg:left-60 xl:left-64'}`}>
      {children}
    </div>
    {!focused && <nav aria-label="手机主要导航" className="fixed inset-x-0 bottom-0 z-50 grid h-20 grid-cols-5 border-t border-line bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {sections.map(({id,label,icon:Icon}) => <button key={id} onClick={() => onNavigate(id)} aria-current={current===id?'page':undefined} className={`flex min-w-0 flex-col items-center justify-center gap-1.5 text-[10px] ${current===id?'text-accent':'text-muted'}`}><span className={`grid h-7 w-12 place-items-center rounded-full ${current===id?'bg-sage':''}`}><Icon size={19} strokeWidth={1.6}/></span>{label==='我的词义世界'?'词义世界':label}</button>)}
    </nav>}
  </div>;
}

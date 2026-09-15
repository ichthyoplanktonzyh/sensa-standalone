import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const setupButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface-subtle px-4 text-sm font-medium transition-[color,background-color,box-shadow,transform] hover:shadow-sm hover:ring-1 hover:ring-border-strong active:scale-[0.98] motion-reduce:transform-none disabled:hover:shadow-none disabled:hover:ring-0 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-45 hover:brightness-95 active:brightness-90';
export const setupPrimary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-action-primary bg-action-primary px-4 text-sm font-medium text-action-on-primary transition-[color,background-color,box-shadow,transform] hover:bg-action-primary-hover hover:shadow-sm active:scale-[0.98] motion-reduce:transform-none disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-45';
export function LearningSetupFrame({id,active,title,onBack,children}:{id:string;active:boolean;title?:string;onBack:()=>void;children:ReactNode}) {
  const {t}=useTranslation();
  return <section id={id} className={`screen absolute inset-0 z-30 overflow-y-auto bg-surface-canvas font-product text-fg-primary ${active?'active':'invisible pointer-events-none'}`}>
    <main className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-10 sm:py-10">
      <header className="mb-8 flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label={t('learningSetup.back')} className={setupButton+' size-11 px-0 text-fg-secondary hover:bg-surface-selected'}><ArrowLeft size={20}/></button>
        {title&&<h1 className="text-sm font-medium text-fg-secondary">{title}</h1>}
      </header>
      {children}
    </main>
  </section>;
}

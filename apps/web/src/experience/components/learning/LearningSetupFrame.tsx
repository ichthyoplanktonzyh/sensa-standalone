import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const setupButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#5268a9] disabled:cursor-not-allowed disabled:opacity-45';
export const setupPrimary = setupButton + ' bg-[#303f76] text-white hover:bg-[#25315d]';
export function LearningSetupFrame({id,active,title,onBack,children}:{id:string;active:boolean;title:string;onBack:()=>void;children:ReactNode}) {
  const {t}=useTranslation();
  return <section id={id} className={`screen absolute inset-0 z-30 overflow-y-auto bg-[#fbfbfa] text-[#242a38] ${active?'active':'invisible pointer-events-none'}`}>
    <main className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-10 sm:py-10">
      <header className="mb-8 flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label={t('learningSetup.back')} className={setupButton+' size-11 px-0 text-[#68748d] hover:bg-[#edf0f7]'}><ArrowLeft size={20}/></button>
        <h1 className="text-sm font-medium text-[#68748d]">{title}</h1>
      </header>
      {children}
    </main>
  </section>;
}

import { ArrowRight } from 'lucide-react';
import type { ExperienceRecallCardPresentation } from '../../../learningRuntime/lightweightInitialPresentation';
interface ExperienceRecallCardProps { readonly presentation: ExperienceRecallCardPresentation; readonly onReveal: () => void; }
export function ExperienceRecallCard({presentation,onReveal}:ExperienceRecallCardProps){
 const {experienceSketch,auxiliaryCues}=presentation.slots;
 return <section className="flex flex-col" aria-labelledby="lightweight-experience-recall-title">
   <div className="relative rounded-3xl border border-line bg-white p-7 shadow-[0_12px_48px_-32px_#254f4040] sm:p-12">
     <span aria-hidden="true" className="absolute left-7 top-4 font-editorial text-7xl leading-none text-accent/15 sm:left-10">“</span>
     <blockquote className="relative pt-8 text-xl leading-[1.9] font-medium text-ink sm:text-2xl">{experienceSketch.scene}</blockquote>
     <p className="mt-7 border-t border-line pt-6 text-base leading-8 text-muted">{experienceSketch.senseFocus}</p>
   </div>
   {auxiliaryCues.length>0&&<div className="mt-6 flex flex-wrap justify-center gap-2" aria-label="意义线索">{auxiliaryCues.map(c=><span key={c} className="rounded-full border border-line px-4 py-2 text-xs text-muted">{c}</span>)}</div>}
   <div className="my-9 text-center"><h1 id="lightweight-experience-recall-title" className="text-lg font-medium">你会怎样用英语表达这个意思？</h1><p className="mt-3 text-sm leading-6 text-muted">先在心里说出来，再查看对应的表达。</p></div>
   <button type="button" onClick={onReveal} className="mx-auto flex min-h-14 w-full max-w-md items-center justify-between rounded-xl bg-accent px-6 font-medium text-white transition-colors hover:bg-[#1e503c] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">显示表达<ArrowRight size={18}/></button>
 </section>;
}

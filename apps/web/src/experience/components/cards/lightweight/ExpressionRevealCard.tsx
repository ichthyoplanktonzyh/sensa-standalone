import { Check, RotateCcw, TrendingUp } from 'lucide-react';
import type { ExpressionRevealCardPresentation } from '../../../learningRuntime/lightweightInitialPresentation';
import type { LightweightInitialRating } from '../../../learningRuntime/lightweightInitialProtocol';
interface ExpressionRevealCardProps {readonly presentation:ExpressionRevealCardPresentation;readonly onRate:(rating:LightweightInitialRating)=>void;}
export function ExpressionRevealCard({presentation,onRate}:ExpressionRevealCardProps){
 const {expressionPrimary,senseConfirmation,pronunciation,languageStructure,usageGuidance,sceneBridge}=presentation.slots;
 const structureLabel=languageStructure?[languageStructure.expressionTypeLabel,languageStructure.partOfSpeech].filter(Boolean).join(' · '):null;
 return <section className="flex flex-col" aria-live="polite" aria-labelledby="lightweight-expression-reveal-title">
   <div className="rounded-3xl border border-line bg-white p-7 sm:p-12">
     <h1 id="lightweight-expression-reveal-title" className="break-words font-editorial text-5xl leading-tight tracking-tight text-ink sm:text-6xl">{expressionPrimary.surface}</h1>
     {structureLabel&&<div className="mt-3 text-sm text-muted">{structureLabel}</div>}
     <p className="mt-6 text-lg leading-8 text-ink">{senseConfirmation.meaning}</p>
     {pronunciation&&<div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted">{pronunciation.audioUrl&&<audio className="max-w-full" controls src={pronunciation.audioUrl}/>}<span>{pronunciation.accentLabel}</span><span>{pronunciation.phoneticNotation}</span></div>}
     {usageGuidance&&<blockquote className="mt-8 border-l-2 border-accent/30 pl-5 font-editorial text-xl leading-8 text-ink">{usageGuidance.example}</blockquote>}
     {sceneBridge&&<p className="mt-6 rounded-xl bg-sage p-5 text-sm leading-7 text-muted">{sceneBridge.text}</p>}
   </div>
   <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-4" role="group" aria-label="评价刚才的回想">
     {([{rating:'again',label:'没想起',note:'再回想一次',icon:RotateCcw},{rating:'hard',label:'想起但费力',note:'完成本次学习',icon:TrendingUp},{rating:'good',label:'顺利想起',note:'完成本次学习',icon:Check}] as const).map(({rating,label,note,icon:Icon})=><button type="button" key={rating} onClick={()=>onRate(rating)} className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-4 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${rating==='good'?'border-accent bg-accent text-white hover:bg-[#1e503c]':rating==='again'?'border-[#eadcd1] bg-[#f8f0e9] text-[#8c543b] hover:bg-[#f1e4d9]':'border-line bg-white text-ink hover:bg-sage'}`}><Icon size={18} strokeWidth={1.5}/><strong className="text-sm font-medium">{label}</strong><small className={`text-xs ${rating==='good'?'text-white/75':'text-muted'}`}>{note}</small></button>)}
   </div>
 </section>;
}

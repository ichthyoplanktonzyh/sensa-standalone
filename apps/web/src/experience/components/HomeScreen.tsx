import { ArrowRight, ArrowUpRight, BookOpen, Check, Compass, Layers3, Plus, RotateCcw, Sprout, UserRound } from 'lucide-react';
interface HomeScreenProps {
  active: boolean; onGo: (id: string) => void; onStartMixed: () => void;
  onStartReview?: () => void; signed: boolean; onSign: () => void;
  mixedReadyN: number; reviewDueN?: number;
}
export function HomeScreen({active,onGo,onStartMixed,onStartReview,signed,onSign,mixedReadyN,reviewDueN=0}: HomeScreenProps){
  const newCount=Math.max(0,mixedReadyN-reviewDueN);
  const today=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(new Date());
  const description=reviewDueN>0&&newCount>0?`先处理 ${reviewDueN} 个到期复习，再开始 ${newCount} 个新意思。`:reviewDueN>0?`今天有 ${reviewDueN} 个意思需要复习。`:newCount>0?`今天可以开始 ${newCount} 个新意思。`:'今天的学习流暂时安静，可以添加内容，或稍后再回来。';
  return <section id="s-home" className={`screen absolute inset-0 z-5 overflow-y-auto bg-paper ${active?'active':'invisible pointer-events-none'}`}>
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 lg:px-12 lg:py-8">
      <span className="flex items-center gap-2 text-sm text-muted"><span className="size-1.5 rounded-full bg-accent"/>{today}</span>
      <button onClick={()=>onGo('s-profile')} aria-label="打开个人中心" className="grid size-11 place-items-center rounded-full border border-line bg-white text-muted transition-colors hover:bg-sage"><UserRound size={19} strokeWidth={1.5}/></button>
    </header>
    <main className="mx-auto max-w-6xl px-6 pb-10 lg:px-12 lg:pb-16">
      <div className="mb-8 mt-3 flex flex-wrap items-end justify-between gap-4 lg:mb-10 lg:mt-6">
        <div><p className="mb-3 text-sm text-muted">一点一滴，让语言成为自己的一部分。</p><h1 className="text-[28px] font-semibold tracking-tight lg:text-4xl">继续今天的学习<span className="text-accent">。</span></h1></div>
        <button onClick={onSign} aria-pressed={signed} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-xs transition-colors ${signed?'border-accent/20 bg-sage text-accent':'border-line bg-white text-muted hover:border-accent/40'}`}>{signed?<Check size={15}/>:<Plus size={15}/>}<span>{signed?'今天已记录':'记录今天'}</span></button>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <section className="relative flex min-h-96 flex-col overflow-hidden rounded-3xl bg-[#254f40] p-7 text-white sm:p-9 lg:min-h-[410px]" aria-labelledby="today-flow">
          <div className="pointer-events-none absolute -right-20 -top-32 size-96 rounded-full border border-white/10" aria-hidden="true"/><div className="pointer-events-none absolute -right-28 -top-12 size-96 rounded-full border border-white/10" aria-hidden="true"/><div className="pointer-events-none absolute -right-36 top-8 size-96 rounded-full border border-white/10" aria-hidden="true"/>
          <div className="relative"><span className="mb-7 inline-flex items-center gap-2 text-xs tracking-wider text-[#c6d9c2]"><Sprout size={16}/>今日学习流</span><h2 id="today-flow" className="max-w-xs text-2xl font-medium leading-relaxed sm:text-3xl">把意思记在心里，<br/>把表达用在生活里。</h2><p className="mt-4 max-w-sm text-sm leading-7 text-[#c6d9c2]">{description}</p></div>
          <div className="relative mt-8 flex items-center gap-8" aria-label="今日学习摘要"><div><strong className="font-editorial text-5xl">{newCount}</strong><span className="ml-3 text-xs text-[#c6d9c2]">个新意思</span></div><span className="h-9 w-px bg-white/20"/><div><strong className="font-editorial text-5xl">{reviewDueN}</strong><span className="ml-3 text-xs text-[#c6d9c2]">个待复习</span></div></div>
          <button onClick={onStartMixed} disabled={mixedReadyN===0} className="relative mt-8 flex min-h-14 w-full items-center justify-between rounded-xl bg-[#e0eccd] px-5 text-sm font-semibold text-[#254f40] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50"><span>{mixedReadyN>0?'开始今天的学习':'今日已完成'}</span><ArrowRight size={19}/></button>
        </section>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <section className="flex flex-col rounded-3xl border border-line bg-white p-7">
            <div className="mb-5 flex items-start justify-between"><span className="grid size-11 place-items-center rounded-2xl bg-sage text-accent"><RotateCcw size={20} strokeWidth={1.5}/></span><span className="text-xs text-muted">保持连接</span></div>
            <h2 className="text-lg font-semibold">只复习</h2><p className="mt-2 text-sm leading-6 text-muted">回到熟悉的意思，给记忆一点时间。</p>
            <button onClick={onStartReview} disabled={!reviewDueN||!onStartReview} aria-label={reviewDueN?`只复习 ${reviewDueN} 个意思`:'今天无需复习'} className="mt-5 flex min-h-11 items-center justify-between border-t border-line pt-4 text-sm text-accent disabled:text-muted disabled:opacity-60"><span>{reviewDueN?`${reviewDueN} 个意思待复习`:'今天无需复习'}</span><ArrowRight size={17}/></button>
          </section>
          <button onClick={()=>onGo('s-semantic-world')} className="group flex items-center gap-4 rounded-3xl border border-[#e6e4d7] bg-[#f0efe4] p-7 text-left transition-colors hover:bg-[#e8eadc]"><span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/70 text-clay"><Sprout size={24} strokeWidth={1.4}/></span><span className="flex-1"><strong className="block text-base font-semibold">留下一个真实的场景</strong><span className="mt-2 block text-xs leading-6 text-muted">从自己的经历，找到想说的表达。</span></span><ArrowUpRight size={18} className="shrink-0 text-muted"/></button>
        </div>
      </div>
      <section className="mt-10" aria-labelledby="explore-title"><div className="mb-5 flex items-center justify-between"><h2 id="explore-title" className="text-lg font-semibold">以你的方式，继续探索</h2><span className="hidden text-xs text-muted sm:block">每一个意思，都有一个开始</span></div>
        <div className="grid gap-3 sm:grid-cols-3">{[{id:'s-content',title:'我的内容',description:'浏览词书、意思与例句',icon:BookOpen},{id:'s-study',title:'我的学习',description:'查看目标、记录与学习计划',icon:Layers3},{id:'s-academy',title:'自由练习',description:'在听说读写中使用语言',icon:Compass}].map(({id,title,description,icon:Icon})=><button key={id} onClick={()=>onGo(id)} className="group flex items-center gap-4 rounded-2xl border border-line bg-white p-5 text-left transition-colors hover:border-accent/40 hover:bg-sage/40"><Icon size={21} strokeWidth={1.5} className="shrink-0 text-accent"/><span className="flex-1"><strong className="block text-sm font-medium">{title}</strong><span className="mt-1.5 block text-xs leading-5 text-muted">{description}</span></span><ArrowUpRight size={16} className="text-muted opacity-50 group-hover:opacity-100"/></button>)}</div>
      </section>
      <footer className="mt-10 flex items-center justify-center gap-3 border-t border-line pt-6 text-xs text-muted"><span className="font-editorial text-lg text-accent">sensa.</span><span>理解一个意思，连接一个世界。</span></footer>
    </main>
  </section>;
}

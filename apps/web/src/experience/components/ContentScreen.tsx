import {ContentDrawer,ContentHeader} from './ContentWorkspace';
import { MeaningGraphView } from "./MeaningGraphView";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Inbox,
  List,
  MessageSquareText,
  Network,
  Plus,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContentSectionId, LearnerSemanticProjectionSnapshot } from "../../learnerSemanticProjection/system";
import {learnerSemanticProjectionSystem} from '../../learnerSemanticProjection/system';
import { useLearnerSemanticProjection } from "../../learnerSemanticProjection/useLearnerSemanticProjection";
import {
  useJourneyGateway,
  useJourneyWorld,
  type JourneyWorldItemView,
} from "../personalMeaningJourney";
import { PersonalMeaningComposer } from "./PersonalMeaningComposer";
import {ManualMeaningComposer} from './ManualMeaningComposer';
import { IntakeInboxDrawer } from "./IntakeInboxDrawer";
import { SensaCollectionBrowserLayout } from "../ui/SensaPageLayouts";
import { useScreenState } from "../ui/ScreenHost";
import {SensaVirtualList,SensaPagedVirtualList} from '../ui/SensaVirtualList';
import {localFlowText} from '../../i18n/localFlowText';
import {normalizeMeaningQuery} from '../personalMeaningJourney/meaningLookupFacts';
import {useWorldWindow,useWorldInbox} from '../personalMeaningJourney/useWorldRead';
import {summarizeWorldItem,matchesWorldLanguages,type WorldBrowseItem,type WorldBrowseQuery} from '../personalMeaningJourney/worldRead';
import type {ShellParams} from '../router/shellLocation';
import {personalContentSystem} from '../../personalContent/system';

export interface ContentScreenSource {
  items: JourneyWorldItemView[];
  status: import("../personalMeaningJourney/gateway").JourneyGatewayStatus;
  inbox: import("@sensa/contracts/sensa").SensaIntakeItem[];
  projection: LearnerSemanticProjectionSnapshot;
  reload:()=>void;
  composer: import("./PersonalMeaningComposer").MaterialComposerPort;
}
interface ContentScreenProps {
  bulkLearning?:(items:JourneyWorldItemView[],list:import('react').ReactNode,query?:Pick<WorldBrowseQuery,'query'|'filter'|'expressionLanguages'|'referenceFilter'>)=>import('react').ReactNode;
  browse?:{params:ShellParams;change:(params:ShellParams)=>void};
  graphLearningState?:(bindingVersionId:string)=>import('react').ReactNode;
  source?:ContentScreenSource;
  notice?:import("react").ReactNode;
  active: boolean;
  screenId?: string;
  initialAction?: "create" | "inbox" | "add";
  onInitialActionConsumed?:()=>void;
  onStartConversation?:()=>void;
  onBrowseExisting: () => void;
  onOpenPersonalMeaning: (id: string, focusId?: string) => void;
  onOpenConfirmedSense: (id: string, focusId: string) => void;
  onOpenSense: (id: string) => void;
  onOpenLearningContent: (targetId: string) => void;
  onOpenSection: (section: ContentSectionId) => void;
  toast: (message: string) => void;
}
type Category = "personal" | "learning" | "markers";
type Filter = "all" | "continue" | "binding" | "complete" | "deleted";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50";
const alignmentBranches = (item: JourneyWorldItemView) => [
  ...item.detail.focuses.map((focus) => ({
    id: focus.meaningFocusId,
    focusId: focus.meaningFocusId,
    label: focus.statement,
    alignment: focus.alignment,
  })),
  ...item.detail.directAlignments.map((alignment) => ({
    id: alignment.personalMeaningAlignmentId,
    focusId: alignment.personalMeaningAlignmentId,
    label: alignment.coreMeaningFocus || alignment.senseShortId,
    alignment,
  })),
];
const confirmedExpressionFor = (item: JourneyWorldItemView) =>
  alignmentBranches(item)
    .flatMap((branch) => branch.alignment?.confirmedBindings ?? [])
    .at(0)?.surfaceForm ?? null;
const labelFor = (item: JourneyWorldItemView) =>
  confirmedExpressionFor(item) ||
  item.experienceAnchors[0]?.surfaceForm ||
  item.familiarAnchors[0]?.surfaceForm ||
  item.primaryLabel;
const searchText = (item: JourneyWorldItemView) =>
  [
    labelFor(item),
    ...item.familiarAnchors.map((a) => a.surfaceForm),
    ...item.experienceAnchors.map((a)=>a.surfaceForm),
    ...item.detail.materialBlocks.flatMap(block=>[block.bodyText??'',block.capturedSource?.text??'']),
    ...(item.detail.capturedSources??[]).map(source=>source.text??''),
    ...alignmentBranches(item).flatMap((b) => [
      b.label,
      ...(b.alignment?.confirmedBindings.map((e) => e.surfaceForm) ?? []),
    ]),
  ]
    .join(" ");

export function ContentScreen(props:ContentScreenProps){
 return <ContentScreenView {...props}/>;
}
function ContentScreenView({
  active,
  screenId = "s-content",
  initialAction,
  onInitialActionConsumed,
  onBrowseExisting,onStartConversation,
  onOpenPersonalMeaning,
  onOpenConfirmedSense,
  onOpenSense,
  onOpenLearningContent,
  onOpenSection,
  toast,source:providedSource,notice,bulkLearning,browse,graphLearningState,
}: ContentScreenProps) {
  const { t, i18n } = useTranslation();
  const [category, setCategory] = useScreenState<Category>(`${screenId}:category`, "personal");
  const [rememberedView, rememberView] = useScreenState<"list" | "world">(`${screenId}:view`, "list");
  const [rememberedFilter, rememberFilter] = useScreenState<Filter>(`${screenId}:filter`, "all");
  const [rememberedQuery, rememberQuery] = useScreenState(`${screenId}:query`, "");
  const [rememberedLanguages,rememberLanguages]=useScreenState<string[]>(`${screenId}:languages`,[]);
  const view=browse?(browse.params.worldView==='world'?'world':'list'):rememberedView;
  const filter=browse?(['all','continue','binding','complete','deleted'].includes(browse.params.worldFilter??'')?browse.params.worldFilter as Filter:'all'):rememberedFilter;
  const query=browse?(browse.params.worldQuery??'').slice(0,200):rememberedQuery;
  const languages=browse?(browse.params.worldLanguages??'').split(',').filter(tag=>tag.length>0&&tag.length<=100).slice(0,32):rememberedLanguages;
  const setView=(value:typeof view)=>browse?browse.change({worldView:value}):rememberView(value);
  const setFilter=(value:Filter)=>browse?browse.change({worldFilter:value}):rememberFilter(value);
  const setQuery=(value:string)=>browse?browse.change({worldQuery:value||undefined}):rememberQuery(value);
  const setLanguages=(value:string[])=>browse?browse.change({worldLanguages:value.sort().join(',')||undefined}):rememberLanguages(value);
  const [rememberedReferences,rememberReferences]=useScreenState<'all'|'saved'|'notes'>(`${screenId}:references`,'all');
  const referenceFilter=browse?(browse.params.worldReferences==='saved'||browse.params.worldReferences==='notes'?browse.params.worldReferences:'all'):rememberedReferences;
  const setReferences=(value:typeof referenceFilter)=>browse?browse.change({worldReferences:value==='all'?undefined:value}):rememberReferences(value);
  const [rememberedExpression,rememberExpression]=useScreenState<string|null>(`${screenId}:expression`,null);
  const selectedExpression=browse?browse.params.worldExpression??null:rememberedExpression;
  const setExpression=(value:string|null)=>browse?browse.change({worldExpression:value??undefined}):rememberExpression(value);
  const [adding, setAdding] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [manualOpen,setManualOpen]=useState(false);
  const [manualIntake,setManualIntake]=useState<import('@sensa/contracts/sensa').SensaIntakeItem|null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const page=useWorldWindow({query,filter,expressionLanguages:languages,referenceFilter},!providedSource&&active);
  const fullRead=!providedSource&&active&&category==='personal'&&view==='world'&&filter!=='deleted';
  const [references,setReferencesSnapshot]=useState(()=>personalContentSystem.read({kind:'snapshot'}));
  const readingReferences=fullRead&&referenceFilter!=='all';
  useEffect(()=>{if(!readingReferences)return;const read=()=>setReferencesSnapshot(personalContentSystem.read({kind:'snapshot'}));const stop=personalContentSystem.subscribe({kind:'snapshot'},read);read();return stop;},[readingReferences]);
  const world=useJourneyWorld(fullRead),gateway=useJourneyGateway();
  const inboxRead=useWorldInbox(!providedSource&&active&&inboxOpen);
  const projectionRead=useLearnerSemanticProjection(!providedSource&&active&&category!=='personal');
  const source=providedSource??{items:world.items,status:fullRead?world.status:page.status,inbox:inboxRead.value?.items??[],projection:projectionRead,reload:()=>{page.reload();if(fullRead)void gateway.reload();}};
  const {items,inbox,projection}=source;
  const status=readingReferences&&references.status!=='ready'?{ok:references.status!=='error',loading:references.status==='loading',error:null,errorKind:null}:source.status;
  const showExamples=projection.annotationStatus!=='ready'||projection.savedExampleCount>0;
  const paged=!providedSource&&category==='personal'&&(view==='list'||filter==='deleted');
  const fmt = (n: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage).format(n);
  useEffect(() => {
    if (active && initialAction === "inbox") setInboxOpen(true);
    if (active && initialAction === "create") {if(onStartConversation)onStartConversation();else setComposerOpen(true);}
    if (active && initialAction === "add") {setAdding(true);onInitialActionConsumed?.();}
  }, [active, initialAction]);
  useEffect(() => {
    if (!adding) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAdding(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [adding]);
  const matchesFilter = (item: JourneyWorldItemView) =>
    filter==='deleted'?item.detail.status==='deleted':item.detail.status==='active'&&(filter === "all" ||
    (filter === "continue" &&
      item.senseFormation.phase !== "sense_confirmed") ||
    (filter === "binding" &&
      ["pending", "partial"].includes(item.expressionBinding.phase)) ||
    (filter === "complete" && item.expressionBinding.phase === "bound"));
  const searchable=useMemo(()=>new Map(items.map(item=>[item.personalMeaningId,normalizeMeaningQuery(searchText(item))])),[items]);
  const normalizedQuery=normalizeMeaningQuery(query);
  const visible = useMemo(
    () =>
      items
        .filter((item) =>
          searchable.get(item.personalMeaningId)!.includes(normalizedQuery),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [items, searchable,normalizedQuery],
  ).filter(matchesFilter).filter(item=>matchesWorldLanguages(summarizeWorldItem(item),languages)).filter(item=>referenceFilter==='all'||summarizeWorldItem(item).senseIds?.some(id=>referenceFilter==='saved'?references.savedSenseIds.has(id):!!references.senseNotes[id]));
  const availableLanguages=[...new Set([...(page.expressionLanguages??[]),...items.flatMap(item=>summarizeWorldItem(item).expressions?.map(expression=>expression.languageTag)??[]),...languages])].sort();
  const expressionCount=paged?page.expressionCount:new Set(visible.flatMap(item=>summarizeWorldItem(item).expressions?.filter(expression=>!languages.length||languages.includes(expression.languageTag)).map(expression=>expression.expressionId)??[])).size;
  const learning = projection.semanticSenses.filter((item) =>
    `${item.expression.formL2} ${item.ground.labelL1} ${item.ground.experienceL1}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const drafts = items
    .filter(
      (item) =>
        item.senseFormation.phase !== "sense_confirmed" ||
        item.expressionBinding.phase !== "bound",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const next = paged?page.next:drafts[0];
  const open = (id: string, focusId?: string) => {
    setSelected(id);
    const item = items.find((item) => item.personalMeaningId === id);
    if (
      !focusId &&
      item &&
      !confirmedExpressionFor(item) &&
      !item.detail.focuses.length &&
      item.detail.directAlignments[0]
    )
      onOpenConfirmedSense(
        id,
        item.detail.directAlignments[0].personalMeaningAlignmentId,
      );
    else onOpenPersonalMeaning(id, focusId);
  };
  const empty = (
    <div className="py-20 text-center" role="status">
      <MessageSquareText
        className="mx-auto mb-5 text-fg-tertiary"
        size={28}
        strokeWidth={1.3}
      />
      <p className="text-sm text-fg-secondary">
        {t(filter==='deleted'&&!query?'meaningGovernance.emptyTrash':query ? "content.noResults" : "content.empty")}
      </p>
      {!query && category === "personal" && filter!=='deleted'&& (
        <button
          className={`${button} mt-5 text-action-primary`}
          onClick={() => onStartConversation?onStartConversation():setComposerOpen(true)}
        >
          <Plus size={16} />
          {t(onStartConversation?"content.findExpression":"content.record")}
        </button>
      )}
    </div>
  );
  const row=(item:JourneyWorldItemView|WorldBrowseItem)=>{
   const summary='label'in item?item:summarizeWorldItem(item);
   const matches=(summary.expressions??[]).filter(expression=>!languages.length||languages.includes(expression.languageTag)),others=(summary.expressions??[]).filter(expression=>languages.length&&!languages.includes(expression.languageTag));
   const label=matches.length?matches.map(expression=>expression.surfaceForm).join(' / '):summary.label;
   return (
     <div data-world-meaning={item.personalMeaningId}>
                <button
                  key={item.personalMeaningId}
                  onClick={() => open(item.personalMeaningId)}
                  className={`sensa-world-row flex w-full items-center gap-5 rounded-control px-2 py-6 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus ${selected === item.personalMeaningId ? "bg-surface-selected" : ""}`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-control border border-border-subtle bg-surface-panel text-fg-secondary">
                    <MessageSquareText size={18} strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium">
                      {label}
                    </strong>
                    {!!matches.length&&<span className="mt-1 block text-xs text-fg-secondary" data-matching-expressions>{matches.map(expression=>`${expression.surfaceForm} · ${expression.languageTag}`).join(' / ')}</span>}
                    {item.primaryLabel !== label && <span className="sensa-world-context mt-2 block line-clamp-2 text-sm leading-6 text-fg-secondary">{item.primaryLabel}</span>}
                    <span className="mt-2 block text-xs text-fg-tertiary">
                      {('status'in item?item.status:item.detail.status)==='deleted'?t('meaningGovernance.deleted'):t(`content.phase.${item.senseFormation.phase}`)} ·{" "}
                      {t(`content.expression.${item.expressionBinding.phase}`)}
                    </span>
                  </span>
                  <ArrowUpRight size={16} className="shrink-0 text-fg-tertiary" />
                </button>
      {!!others.length&&<details className="mb-4 px-3 text-sm"><summary className="min-h-11 cursor-pointer">{t('content.worldOther')}</summary>{others.map(expression=><p className="py-1" key={expression.expressionId}>{expression.surfaceForm} · {expression.languageTag}</p>)}</details>}
     </div>
              );
  };
  const personalList=paged?<SensaPagedVirtualList count={page.total} itemAt={index=>page.items.get(index)} indexForKey={key=>{for(const [index,item] of page.items)if(item.personalMeaningId===key)return index;return -1;}} itemKey={item=>item.personalMeaningId} label={t('content.personal')} renderItem={row} request={page.request}/>
   :<SensaVirtualList items={visible} itemKey={item=>item.personalMeaningId} label={t('content.personal')} renderItem={row}/>;
  const personalCollection=status.loading&&(readingReferences|| (paged?!page.total:!items.length))?<div role="status" aria-busy="true" className="py-20 text-center text-sm text-fg-secondary">{localFlowText('loadingSensa')}</div>:!status.ok?<div role="alert" className="rounded-card border border-feedback-danger p-6 text-feedback-danger"><p>{t('content.loadError')}</p><button className={button} onClick={()=>{source.reload();if(readingReferences)void personalContentSystem.refresh().catch(()=>undefined);}}>{t('content.retry')}</button></div>:!(paged?page.total:visible.length)?empty:view==='list'?personalList:<MeaningGraphView items={visible} languages={languages} screenId={screenId} selectedExpressionId={selectedExpression} onSelectExpression={setExpression} onOpenMeaning={open} learningState={graphLearningState} searching={!!normalizedQuery}/>;
  return (
    <>
      <SensaCollectionBrowserLayout
        id={screenId}
        measure="wide"
        className={`screen sensa-world z-10 ${view==='world'&&category==='personal'?'sensa-world-graph-mode':''} ${active ? "active" : "invisible pointer-events-none"}`}
        regions={{
          header: <>{notice}<ContentHeader inboxCount={providedSource?inbox.length+drafts.length:page.inboxCount+page.pending} onInbox={()=>setInboxOpen(true)} onAdd={()=>setAdding(true)}/>{category==='personal'&&<button className={button+' mt-3 text-fg-secondary'} aria-pressed={filter==='deleted'} onClick={()=>{setFilter(filter==='deleted'?'all':'deleted');setView('list');}}>{t(filter==='deleted'?'meaningGovernance.all':'meaningGovernance.trash')}</button>}</>,
          navigation: <div
          aria-label={t("content.categories")}
          className="grid grid-cols-3 gap-2 border-b border-border-subtle sm:flex sm:gap-6"
        >
          {(["personal", "learning", "markers"] as const).map((id) => (
            <button
              key={id}
              aria-current={category === id ? "page" : undefined}
              onClick={() => setCategory(id)}
              className={`min-h-12 min-w-0 border-b-2 px-1 py-2 text-balance text-sm break-words focus-visible:outline-2 focus-visible:outline-focus ${category === id ? "border-action-primary font-medium text-action-primary" : "border-transparent text-fg-secondary"}`}
            >
              {t(`content.${id}`)}
            </button>
          ))}
        </div>,
          controls: <>
        {category === "personal" && view==='list'&&filter!=='deleted'&&next && (
          <button
            onClick={() => open(next.personalMeaningId)}
            className="mb-6 flex w-full items-center gap-4 rounded-card bg-surface-subtle px-5 py-4 text-left text-sm focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="shrink-0 text-fg-secondary">
              {t("content.continue")}
            </span>
            <span className="min-w-0 flex-1 truncate">{'label'in next?next.label:labelFor(next)}</span>
            <ArrowRight size={16} />
          </button>
        )}
         {category==='personal'&&<div className="sensa-world-languages mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t('content.worldLanguage')}>
         <span className="mr-1 text-xs text-fg-secondary">{t('content.worldLanguage')}</span>
         <button className={button+' border '+(!languages.length?'border-border-strong bg-surface-selected font-semibold':'border-border-subtle')} aria-pressed={!languages.length} onClick={()=>setLanguages([])}>{t('content.worldAllLanguages')}</button>
         {availableLanguages.map(tag=><button className={button+' border '+(languages.includes(tag)?'border-border-strong bg-surface-selected font-semibold':'border-border-subtle')} key={tag} aria-pressed={languages.includes(tag)} onClick={()=>setLanguages(languages.includes(tag)?languages.filter(value=>value!==tag):[...languages,tag])}>{tag}</button>)}
        </div>}
        {category==='personal'&&<label className="mt-2 inline-flex items-center gap-2 text-xs">{t('content.markers')}<select className="min-h-11 rounded-control border border-border-subtle bg-surface-panel px-3" value={referenceFilter} onChange={event=>setReferences(event.target.value as typeof referenceFilter)}>
         {(['all','saved','notes'] as const).map(value=><option key={value} value={value}>{t(value==='all'?'content.all':value==='saved'?'content.savedSenses':'content.notes')}</option>)}
        </select></label>}
        {category !== "markers" && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex min-h-11 w-full items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-3 focus-within:outline-2 focus-within:outline-focus sm:max-w-sm">
              <Search size={17} className="shrink-0 text-fg-tertiary" />
              <input
                aria-label={t("content.search")}
                placeholder={t("content.search")}
                value={query}
                maxLength={200}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
              />
              {query && (
                <button
                  className="grid size-11 shrink-0 place-items-center rounded-control focus-visible:outline-2 focus-visible:outline-focus"
                  aria-label={t("content.clear")}
                  onClick={() => setQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>
            {category === "personal" && filter!=='deleted'&& (
              <div
                className="flex rounded-control border border-border-subtle bg-surface-panel p-1"
                role="group"
                aria-label={t("content.view")}
              >
                {(["list", "world"] as const).map((id) => (
                  <button
                    className={`${button} min-h-9 ${view === id ? "bg-surface-selected text-action-primary" : "text-fg-secondary"}`}
                    aria-pressed={view === id}
                    key={id}
                    onClick={() => setView(id)}
                  >
                    {id === "list" ? <List size={16} /> : <Network size={16} />}{" "}
                    {t(`content.${id}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {category==='personal'&&!status.loading&&status.ok&&expressionCount!==undefined&&<p role="status" className="mt-3 text-xs text-fg-secondary" data-world-counts>{t('content.worldCounts',{expressions:expressionCount,meanings:paged?page.total:visible.length})}</p>}
        {category === "personal" && filter!=='deleted'&& (
          <div
            className="mt-6 flex flex-wrap gap-2"
            role="group"
            aria-label={t("content.filter")}
          >
            {(["all", "continue", "binding", "complete"] as const).map((id) => (
              <button
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`min-h-11 rounded-pill px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-focus ${filter === id ? "bg-surface-selected text-action-primary" : "text-fg-secondary hover:bg-surface-subtle"}`}
              >
                {t(`content.${id}`)}
              </button>
            ))}
          </div>
        )}
          </>,
          collection: <>
        {category === 'personal' && (view==='list'&&bulkLearning&&filter!=='deleted'?bulkLearning(visible,personalCollection,paged?{query,filter,expressionLanguages:languages,referenceFilter}:undefined):personalCollection)}
        {category === "learning" &&
          (projection.learningStatus!=='ready'?<div role={projection.learningStatus==='error'?'alert':'status'} className="p-5">{localFlowText(projection.learningStatus==='error'?'progressReadFailed':'loadingSensa')}{projection.learningStatus==='error'&&<button className={button} onClick={()=>learnerSemanticProjectionSystem.retryReferences()}>{t('contentUi.retry')}</button>}</div>:learning.length ? (
            <SensaVirtualList items={learning} label={t('content.learning')} itemKey={item=>item.targetId??item.senseId} estimateSize={112} renderItem={item=>(
                <button
                  key={item.targetId??item.senseId}
                  onClick={() => item.targetId?onOpenLearningContent(item.targetId):onOpenSense(item.senseId)}
                  className="flex w-full items-center gap-5 rounded-control py-6 text-left hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <BookOpen size={20} className="text-fg-secondary" />
                  <span className="flex-1">
                    <strong className="text-lg font-medium">
                      {item.expression.formL2}
                    </strong>
                    <span className="mt-1 block text-sm text-fg-secondary">
                      {item.ground.labelL1}
                    </span>
                  </span>
                  <span className="text-xs text-fg-secondary">
                    {t(`content.learningStatus.${item.status}`)}
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              )}/>
          ) : (
            empty
          ))}
        {category === "markers" && (
          <div className={`grid gap-4 ${showExamples?'sm:grid-cols-3':'sm:grid-cols-2'}`}>
            {(
              [
                {
                  id: "saved-senses",
                  label: "savedSenses",
                  count: projection.savedSenses.length,
                  icon: Bookmark,
                },
                {
                  id: "saved-examples",
                  label: "savedExamples",
                  count: projection.savedExampleCount,
                  icon: MessageSquareText,
                },
                {
                  id: "notes",
                  label: "notes",
                  count: projection.notes.length,
                  icon: StickyNote,
                },
              ] as const
            ).filter(({id})=>id!=='saved-examples'||showExamples).map(({ id, label, count, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onOpenSection(id)}
                className="rounded-card border border-border-subtle bg-surface-panel p-6 text-left transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
              >
                <Icon
                  size={22}
                  strokeWidth={1.5}
                  className="mb-6 text-fg-secondary"
                />
                <span className="block text-sm">{t(`content.${label}`)}</span>
                <strong className="mt-3 block text-3xl font-normal text-action-primary">
                  {(id==='saved-examples'?projection.annotationStatus:projection.personalReferenceStatus)!=='ready'?'—':fmt(count)}
                </strong>
              </button>
            ))}
          </div>
        )}
          </>,
        }}
      />
      {adding && (
        <ContentDrawer title={t("content.add")} onClose={() => setAdding(false)}>
            {[
              ...(!providedSource?[{title:'manual',hint:null,icon:StickyNote,action:()=>setManualOpen(true)}]:[]),
              {
                title: onStartConversation?"findExpression":"record",
                hint: onStartConversation?"findExpressionHint":"recordHint",
                icon: MessageSquareText,
                action: () => onStartConversation?onStartConversation():setComposerOpen(true),
              },
              ...(onStartConversation?[{title:"record",hint:"recordHint",icon:StickyNote,action:()=>setComposerOpen(true)}]:[]),
              {
                title: "existing",
                hint: "existingHint",
                icon: BookOpen,
                action: onBrowseExisting,
              },
            ].map(({ title, hint, icon: Icon, action }) => (
              <button
                key={title}
                onClick={() => {
                  setAdding(false);
                  action();
                }}
                className="mb-4 flex w-full items-center gap-5 rounded-card border border-border-subtle bg-surface-panel p-6 text-left transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
              >
                <Icon
                  size={23}
                  strokeWidth={1.4}
                  className="shrink-0 text-fg-secondary"
                />
                <span className="flex-1">
                  <strong className="text-sm font-medium">
                    {t(`content.${title}`)}
                  </strong>
                  {hint&&<span className="mt-2 block text-xs leading-5 text-fg-tertiary">
                    {t(`content.${hint}`)}
                  </span>}
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
        </ContentDrawer>
      )}
      <PersonalMeaningComposer
        persistence={providedSource?.composer}
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSaved={toast}
        onCreated={(id) => {
          setComposerOpen(false);
          open(id);
        }}
      />
      {manualOpen&&<ManualMeaningComposer onClose={()=>setManualOpen(false)} onCreated={id=>{setManualOpen(false);source.reload();onOpenPersonalMeaning(id);}}/>}
      {manualIntake&&<ManualMeaningComposer key={manualIntake.intakeId} original={manualIntake} onClose={()=>{setManualIntake(null);setInboxOpen(true);}} onCreated={id=>{setManualIntake(null);source.reload();onOpenPersonalMeaning(id);}}/>}
      <IntakeInboxDrawer
        onManual={item=>{setInboxOpen(false);setManualIntake(item);}}
        onResolved={id=>{setInboxOpen(false);open(id);}}
        drafts={providedSource?drafts.map(item=>({personalMeaningId:item.personalMeaningId,label:item.experienceAnchors[0]?.surfaceForm||item.familiarAnchors[0]?.surfaceForm||item.primaryLabel})):inboxRead.value?.drafts??[]}
        onOpenDraft={(id) => {
          setInboxOpen(false);
          open(id);
        }}
        open={inboxOpen}
        status={providedSource?status:inboxRead.status}
        onRetry={providedSource?source.reload:inboxRead.reload}
        items={inbox}
        onClose={() => setInboxOpen(false)}
        onSummoned={(id) => {
          setInboxOpen(false);
          open(id);
        }}
        toast={toast}
      />
    </>
  );
}

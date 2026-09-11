import {ContentHeader} from './ContentWorkspace';
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
import type { ContentSectionId } from "../contentProjection";
import { useContentProjection } from "../useContentProjection";
import {
  useJourneyGateway,
  useJourneyInbox,
  useJourneyWorld,
  type JourneyWorldItemView,
} from "../personalMeaningJourney";
import { PersonalMeaningComposer } from "./PersonalMeaningComposer";
import { IntakeInboxDrawer } from "./IntakeInboxDrawer";

export interface ContentScreenSource {
  items: JourneyWorldItemView[];
  status: import("../personalMeaningJourney/gateway").JourneyGatewayStatus;
  inbox: import("@sensa/contracts/sensa").SensaIntakeItem[];
  projection: import("../contentProjection").ContentProjectionSnapshot;
  reload:()=>void;
  composer: import("./PersonalMeaningComposer").MaterialComposerPort;
}
interface ContentScreenProps {
  bulkLearning?:(items:JourneyWorldItemView[],list:import('react').ReactNode)=>import('react').ReactNode;
  source?:ContentScreenSource;
  localLibrary?:Pick<ContentScreenSource,'items'|'status'|'reload'|'composer'>;
  notice?:import("react").ReactNode;
  active: boolean;
  screenId?: string;
  initialAction?: "create";
  onStartConversation?:()=>void;
  onBrowseExisting: () => void;
  onOpenPersonalMeaning: (id: string, focusId?: string) => void;
  onOpenConfirmedSense: (id: string, focusId: string) => void;
  onOpenSense: (id: string) => void;
  onOpenSection: (section: ContentSectionId) => void;
  toast: (message: string) => void;
}
type Category = "personal" | "learning" | "markers";
type Filter = "all" | "continue" | "binding" | "complete";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3c51ad] disabled:opacity-50";
const labelFor = (item: JourneyWorldItemView) =>
  item.detail.directAlignments[0]?.confirmedBindings[0]?.surfaceForm ||
  item.experienceAnchors[0]?.surfaceForm ||
  item.familiarAnchors[0]?.surfaceForm ||
  item.primaryLabel;
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
const searchText = (item: JourneyWorldItemView) =>
  [
    labelFor(item),
    ...item.familiarAnchors.map((a) => a.surfaceForm),
    ...alignmentBranches(item).flatMap((b) => [
      b.label,
      ...(b.alignment?.confirmedBindings.map((e) => e.surfaceForm) ?? []),
    ]),
  ]
    .join(" ")
    .toLocaleLowerCase();

export function ContentScreen(props:ContentScreenProps){
 return props.source?<ContentScreenView {...props} source={props.source}/>:<ConnectedContentScreen {...props}/>;
}
function ConnectedContentScreen(props:ContentScreenProps){
 const {items,status}=useJourneyWorld();const gateway=useJourneyGateway();const inbox=useJourneyInbox();const projection=useContentProjection();
 return <ContentScreenView {...props} source={{items:[...(props.localLibrary?.items??[]),...items],status:props.localLibrary&&!props.localLibrary.status.ok?props.localLibrary.status:status,inbox,projection,composer:props.localLibrary?.composer,reload:()=>{gateway.reload();props.localLibrary?.reload();}}}/>;
}
function ContentScreenView({
  active,
  screenId = "s-content",
  initialAction,
  onBrowseExisting,onStartConversation,
  onOpenPersonalMeaning,
  onOpenConfirmedSense,
  onOpenSense,
  onOpenSection,
  toast,source,notice,bulkLearning,
}: Omit<ContentScreenProps,"source"> & {source:Omit<ContentScreenSource,"composer"> & {composer?:ContentScreenSource["composer"]}}) {
  const { t, i18n } = useTranslation();
  const {items,status,inbox,projection}=source;
  const [category, setCategory] = useState<Category>("personal");
  const [view, setView] = useState<"list" | "world">("list");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const fmt = (n: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage).format(n);
  useEffect(() => {
    if (active && initialAction === "create") {if(onStartConversation)onStartConversation();else setComposerOpen(true);}
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
    filter === "all" ||
    (filter === "continue" &&
      item.senseFormation.phase !== "sense_confirmed") ||
    (filter === "binding" &&
      ["pending", "partial"].includes(item.expressionBinding.phase)) ||
    (filter === "complete" && item.expressionBinding.phase === "bound");
  const visible = useMemo(
    () =>
      items
        .filter((item) =>
          searchText(item).includes(query.trim().toLocaleLowerCase()),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [items, query],
  ).filter(matchesFilter);
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
  const next = drafts[0];
  const open = (id: string, focusId?: string) => {
    setSelected(id);
    const item = items.find((item) => item.personalMeaningId === id);
    if (
      !focusId &&
      item &&
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
        className="mx-auto mb-5 text-[#9299ac]"
        size={28}
        strokeWidth={1.3}
      />
      <p className="text-sm text-[#6d7380]">
        {t(query ? "content.noResults" : "content.empty")}
      </p>
      {!query && category === "personal" && (
        <button
          className={`${button} mt-5 text-[#34477d]`}
          onClick={() => onStartConversation?onStartConversation():setComposerOpen(true)}
        >
          <Plus size={16} />
          {t(onStartConversation?"content.findExpression":"content.record")}
        </button>
      )}
    </div>
  );
  const personalList=(
            <div className="divide-y divide-[#e7e9ef] border-y border-[#e7e9ef]">
              {visible.map((item) => (
                <button
                  key={item.personalMeaningId}
                  onClick={() => open(item.personalMeaningId)}
                  className={`flex w-full items-center gap-5 px-2 py-6 text-left hover:bg-[#f3f4f7] ${selected === item.personalMeaningId ? "bg-[#f0f2f8]" : ""}`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[#e1e4eb] bg-white text-[#697494]">
                    <MessageSquareText size={18} strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm font-medium">
                      {labelFor(item)}
                    </strong>
                    <span className="mt-2 block text-xs text-[#798191]">
                      {t(`content.phase.${item.senseFormation.phase}`)} ·{" "}
                      {t(`content.expression.${item.expressionBinding.phase}`)}
                    </span>
                  </span>
                  <ArrowUpRight size={16} className="shrink-0 text-[#7c8597]" />
                </button>
              ))}
            </div>
  );
  return (
    <section
      id={screenId}
      className={`screen absolute inset-0 z-10 overflow-y-auto bg-[#fbfbfa] text-[#222631] ${active ? "active" : "invisible pointer-events-none"}`}
    >
      <main className="mx-auto max-w-[1280px] px-6 py-8 sm:px-10 lg:px-14 lg:py-14">
        {notice}<ContentHeader inboxCount={inbox.length+drafts.length} onInbox={()=>setInboxOpen(true)} onAdd={()=>setAdding(true)}/>
        <nav
          aria-label={t("content.categories")}
          className="mb-7 flex gap-6 overflow-x-auto border-b border-[#e1e4eb]"
        >
          {(["personal", "learning", "markers"] as const).map((id) => (
            <button
              key={id}
              aria-current={category === id ? "page" : undefined}
              onClick={() => setCategory(id)}
              className={`min-h-12 shrink-0 border-b-2 px-1 text-sm ${category === id ? "border-[#3d4f89] font-medium text-[#303e73]" : "border-transparent text-[#757b88]"}`}
            >
              {t(`content.${id}`)}
            </button>
          ))}
        </nav>
        {category === "personal" && next && (
          <button
            onClick={() => open(next.personalMeaningId)}
            className="mb-6 flex w-full items-center gap-4 rounded-xl bg-[#eef0f6] px-5 py-4 text-left text-sm"
          >
            <span className="shrink-0 text-[#59678f]">
              {t("content.continue")}
            </span>
            <span className="min-w-0 flex-1 truncate">{labelFor(next)}</span>
            <ArrowRight size={16} />
          </button>
        )}
        {category !== "markers" && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <label className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-[#e1e4eb] bg-white px-3 sm:max-w-sm">
              <Search size={17} className="shrink-0 text-[#8a91a0]" />
              <input
                aria-label={t("content.search")}
                placeholder={t("content.search")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none"
              />
              {query && (
                <button
                  aria-label={t("content.clear")}
                  onClick={() => setQuery("")}
                >
                  <X size={15} />
                </button>
              )}
            </label>
            {category === "personal" && (
              <div
                className="flex rounded-lg border border-[#e1e4eb] bg-white p-1"
                role="group"
                aria-label={t("content.view")}
              >
                {(["list", "world"] as const).map((id) => (
                  <button
                    className={`${button} min-h-9 ${view === id ? "bg-[#edf0f7] text-[#34477d]" : "text-[#757b88]"}`}
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
        {category === "personal" && (
          <div
            className="mb-6 flex flex-wrap gap-2"
            role="group"
            aria-label={t("content.filter")}
          >
            {(["all", "continue", "binding", "complete"] as const).map((id) => (
              <button
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={`rounded-full px-3 py-2 text-xs ${filter === id ? "bg-[#e7ebf5] text-[#34477d]" : "text-[#737b8b] hover:bg-[#f0f1f4]"}`}
              >
                {t(`content.${id}`)}
              </button>
            ))}
          </div>
        )}
        {category === "personal" &&
          (!status.ok ? (
            <div role="alert" className="rounded-xl border border-red-200 p-6">
              <p>{t("content.loadError")}</p>
              <button className={button} onClick={source.reload}>
                {t("content.retry")}
              </button>
            </div>
          ) : !visible.length ? (
            empty
          ) : view === "list" ? (
            bulkLearning?bulkLearning(visible,personalList):personalList
          ) : (
            <MeaningGraphView
              items={visible}
              selectedMeaningId={selected}
              onSelectMeaning={setSelected}
              onOpenMeaning={open}
              onOpenConfirmedSense={onOpenConfirmedSense}
            />
          ))}
        {category === "learning" &&
          (learning.length ? (
            <div className="divide-y divide-[#e7e9ef] border-y border-[#e7e9ef]">
              {learning.map((item) => (
                <button
                  key={item.senseId}
                  onClick={() => onOpenSense(item.senseId)}
                  className="flex w-full items-center gap-5 py-6 text-left hover:bg-[#f3f4f7]"
                >
                  <BookOpen size={20} className="text-[#74809d]" />
                  <span className="flex-1">
                    <strong className="text-lg font-medium">
                      {item.expression.formL2}
                    </strong>
                    <span className="mt-1 block text-sm text-[#7b8291]">
                      {item.ground.labelL1}
                    </span>
                  </span>
                  <span className="text-xs text-[#65718d]">
                    {t(`content.learningStatus.${item.status}`)}
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            empty
          ))}
        {category === "markers" && (
          <div className="grid gap-4 sm:grid-cols-3">
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
                  count: projection.savedExamples.length,
                  icon: MessageSquareText,
                },
                {
                  id: "notes",
                  label: "notes",
                  count: projection.notes.length,
                  icon: StickyNote,
                },
              ] as const
            ).map(({ id, label, count, icon: Icon }) => (
              <button
                key={id}
                onClick={() => onOpenSection(id)}
                className="rounded-xl border border-[#e1e5ed] bg-white p-6 text-left hover:border-[#aeb9d2]"
              >
                <Icon
                  size={22}
                  strokeWidth={1.5}
                  className="mb-6 text-[#637294]"
                />
                <span className="block text-sm">{t(`content.${label}`)}</span>
                <strong className="mt-3 block text-3xl font-normal text-[#68748e]">
                  {fmt(count)}
                </strong>
              </button>
            ))}
          </div>
        )}
      </main>
      {adding && (
        <div
          className="fixed inset-0 z-[100] flex justify-end bg-[#1f2937]/20"
          onMouseDown={() => setAdding(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-content-title"
            onMouseDown={(e) => e.stopPropagation()}
            className="h-full w-full bg-[#fbfbfa] p-6 shadow-xl sm:max-w-lg sm:p-9"
          >
            <header className="mb-10 flex items-center justify-between">
              <h2 id="add-content-title" className="text-xl font-medium">
                {t("content.add")}
              </h2>
              <button
                className={button}
                aria-label={t("content.close")}
                onClick={() => setAdding(false)}
              >
                <X size={20} />
              </button>
            </header>
            {[
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
                className="mb-4 flex w-full items-center gap-5 rounded-xl border border-[#e1e5ed] bg-white p-6 text-left hover:border-[#aab5d1]"
              >
                <Icon
                  size={23}
                  strokeWidth={1.4}
                  className="shrink-0 text-[#5c6b92]"
                />
                <span className="flex-1">
                  <strong className="text-sm font-medium">
                    {t(`content.${title}`)}
                  </strong>
                  <span className="mt-2 block text-xs leading-5 text-[#788194]">
                    {t(`content.${hint}`)}
                  </span>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </section>
        </div>
      )}
      <PersonalMeaningComposer
        persistence={source.composer}
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onSaved={toast}
        onCreated={(id) => {
          setComposerOpen(false);
          open(id);
        }}
      />
      <IntakeInboxDrawer
        drafts={drafts}
        onOpenDraft={(id) => {
          setInboxOpen(false);
          open(id);
        }}
        open={inboxOpen}
        items={inbox}
        onClose={() => setInboxOpen(false)}
        onSummoned={(id) => {
          setInboxOpen(false);
          open(id);
        }}
        toast={toast}
      />
    </section>
  );
}

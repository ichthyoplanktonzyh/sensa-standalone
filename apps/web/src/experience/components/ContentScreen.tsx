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
import { useLearnerSemanticProjection } from "../../learnerSemanticProjection/useLearnerSemanticProjection";
import {
  useJourneyGateway,
  useJourneyWorld,
  type JourneyWorldItemView,
} from "../personalMeaningJourney";
import { useIntakeInbox } from "../intake";
import { PersonalMeaningComposer } from "./PersonalMeaningComposer";
import { IntakeInboxDrawer } from "./IntakeInboxDrawer";
import { SensaCollectionBrowserLayout } from "../ui/SensaPageLayouts";
import { useScreenState } from "../ui/ScreenHost";

export interface ContentScreenSource {
  items: JourneyWorldItemView[];
  status: import("../personalMeaningJourney/gateway").JourneyGatewayStatus;
  inbox: import("@sensa/contracts/sensa").SensaIntakeItem[];
  projection: LearnerSemanticProjectionSnapshot;
  reload:()=>void;
  composer: import("./PersonalMeaningComposer").MaterialComposerPort;
}
interface ContentScreenProps {
  bulkLearning?:(items:JourneyWorldItemView[],list:import('react').ReactNode)=>import('react').ReactNode;
  source?:ContentScreenSource;
  notice?:import("react").ReactNode;
  active: boolean;
  screenId?: string;
  initialAction?: "create" | "inbox";
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
 const {items,status}=useJourneyWorld();const gateway=useJourneyGateway();const inbox=useIntakeInbox();const projection=useLearnerSemanticProjection();
 return <ContentScreenView {...props} source={{items,status,inbox,projection,reload:()=>gateway.reload()}}/>;
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
  const [category, setCategory] = useScreenState<Category>(`${screenId}:category`, "personal");
  const [view, setView] = useScreenState<"list" | "world">(`${screenId}:view`, "list");
  const [filter, setFilter] = useScreenState<Filter>(`${screenId}:filter`, "all");
  const [query, setQuery] = useScreenState(`${screenId}:query`, "");
  const [adding, setAdding] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const fmt = (n: number) =>
    new Intl.NumberFormat(i18n.resolvedLanguage).format(n);
  useEffect(() => {
    if (active && initialAction === "inbox") setInboxOpen(true);
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
        {t(query ? "content.noResults" : "content.empty")}
      </p>
      {!query && category === "personal" && (
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
  const personalList=(
            <div className="divide-y divide-border-subtle border-y border-border-subtle">
              {visible.map((item) => (
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
                      {labelFor(item)}
                    </strong>
                    {item.primaryLabel !== labelFor(item) && <span className="sensa-world-context mt-2 block line-clamp-2 text-sm leading-6 text-fg-secondary">{item.primaryLabel}</span>}
                    <span className="mt-2 block text-xs text-fg-tertiary">
                      {t(`content.phase.${item.senseFormation.phase}`)} ·{" "}
                      {t(`content.expression.${item.expressionBinding.phase}`)}
                    </span>
                  </span>
                  <ArrowUpRight size={16} className="shrink-0 text-fg-tertiary" />
                </button>
              ))}
            </div>
  );
  return (
    <>
      <SensaCollectionBrowserLayout
        id={screenId}
        measure="wide"
        className={`screen sensa-world z-10 ${active ? "active" : "invisible pointer-events-none"}`}
        regions={{
          header: <>{notice}<ContentHeader inboxCount={inbox.length+drafts.length} onInbox={()=>setInboxOpen(true)} onAdd={()=>setAdding(true)}/></>,
          navigation: <div
          aria-label={t("content.categories")}
          className="flex gap-6 overflow-x-auto border-b border-border-subtle"
        >
          {(["personal", "learning", "markers"] as const).map((id) => (
            <button
              key={id}
              aria-current={category === id ? "page" : undefined}
              onClick={() => setCategory(id)}
              className={`min-h-12 shrink-0 border-b-2 px-1 text-sm focus-visible:outline-2 focus-visible:outline-focus ${category === id ? "border-action-primary font-medium text-action-primary" : "border-transparent text-fg-secondary"}`}
            >
              {t(`content.${id}`)}
            </button>
          ))}
        </div>,
          controls: <>
        {category === "personal" && next && (
          <button
            onClick={() => open(next.personalMeaningId)}
            className="mb-6 flex w-full items-center gap-4 rounded-card bg-surface-subtle px-5 py-4 text-left text-sm focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="shrink-0 text-fg-secondary">
              {t("content.continue")}
            </span>
            <span className="min-w-0 flex-1 truncate">{labelFor(next)}</span>
            <ArrowRight size={16} />
          </button>
        )}
        {category !== "markers" && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex min-h-11 w-full items-center gap-3 rounded-control border border-border-subtle bg-surface-panel px-3 focus-within:outline-2 focus-within:outline-focus sm:max-w-sm">
              <Search size={17} className="shrink-0 text-fg-tertiary" />
              <input
                aria-label={t("content.search")}
                placeholder={t("content.search")}
                value={query}
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
            {category === "personal" && (
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
        {category === "personal" && (
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
        {category === "personal" &&
          (!status.ok ? (
            <div role="alert" className="rounded-card border border-feedback-danger p-6 text-feedback-danger">
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
            <div className="divide-y divide-border-subtle border-y border-border-subtle">
              {learning.map((item) => (
                <button
                  key={item.senseId}
                  onClick={() => onOpenSense(item.senseId)}
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
                className="rounded-card border border-border-subtle bg-surface-panel p-6 text-left transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
              >
                <Icon
                  size={22}
                  strokeWidth={1.5}
                  className="mb-6 text-fg-secondary"
                />
                <span className="block text-sm">{t(`content.${label}`)}</span>
                <strong className="mt-3 block text-3xl font-normal text-action-primary">
                  {fmt(count)}
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
                  <span className="mt-2 block text-xs leading-5 text-fg-tertiary">
                    {t(`content.${hint}`)}
                  </span>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
        </ContentDrawer>
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
    </>
  );
}

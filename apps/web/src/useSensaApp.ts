import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SensaPinnedSenseLearningPackageSnapshot } from "@sensa/contracts/sensa";
import type { MemoryOutcomeKind } from "@sensa/learning-kernel";
import { SensaApiError, SensaContractError, sensaApi, type SensaMe, type SensaScope } from "./api";
import { sensaContent, type SensaContentMember } from "./content";
import { activePlan, encounterOf, latestAttemptVerdict, leaveEncounter, outcomeOf, planNextStep, resumeStep, submitAttempt, type SensaActiveEncounter, type SensaStudyStep, type SensaStudyTarget } from "./session";
import {
  createDeclaredMasteryOperation,
  effectiveMastery,
  masteryMutationIdentity,
  MasterySyncConflictError,
} from "./features/mastery/declaredMastery";
import { outboxRecord, sensaStore, type SensaLearningPreferences, type SensaLocalSnapshot } from "./store";
import { studyPlanPacingOperation, synchronize } from "./sync";
import { sensaWebEnv } from "./env";
import { stopSensaAudio } from "./ui/audio";
import type { SensaExampleCard } from "./ui/assets";
import type { SensaAttemptVerdict } from "./ui/actions/shared";

const fallbackReplicaId = "b6c1ae55-968a-4d8a-9e92-04a7e95fb9b2";

export type SensaSurface =
  | "home"
  | "books"
  | "content"
  | "learning"
  | "profile"
  | "study"
  | "example"
  | "sense"
  | "finish";

export type SensaStudyView = Readonly<
  | { kind: "loading" }
  | { kind: "action"; target: SensaStudyTarget }
  | { kind: "rejected"; encounter: SensaActiveEncounter; senseId: string; reason: string }
  | {
      kind: "closed";
      encounterId: string;
      senseId: string;
      item: SensaPinnedSenseLearningPackageSnapshot | null;
      outcomeKind: MemoryOutcomeKind | null;
    }
>;

export type SensaExampleView = Readonly<{
  origin: "study" | "sense";
  cards: readonly SensaExampleCard[];
  index: number;
  translationVisible: boolean;
  contextVisible: boolean;
}>;

export type SensaSenseView = Readonly<{
  senseId: string;
  member: SensaContentMember | null;
  item: SensaPinnedSenseLearningPackageSnapshot | null;
  error: string | null;
}>;

export type SensaFinishView = Readonly<{
  reason: "exhausted" | "left" | "no_plan";
  detail: string;
  completed: number;
}>;

export type SensaSheet = Readonly<{
  kind: "declare_mastery";
  senseId: string;
  lemma: string;
  guide: string;
  encounter: SensaActiveEncounter | null;
}>;

type SensaAppState = Readonly<{
  phase: "loading" | "failed" | "ready";
  fatal: string | null;
  me: SensaMe | null;
  scope: SensaScope | null;
  snapshot: SensaLocalSnapshot | null;
  members: readonly SensaContentMember[];
  bookTitle: string;
  bookSenseCount: number;
  bookLexemeCount: number;
  surface: SensaSurface;
  previousSurface: SensaSurface;
  busy: boolean;
  toast: string | null;
  sheet: SensaSheet | null;
  menuOpen: boolean;
  study: SensaStudyView | null;
  verdict: SensaAttemptVerdict | null;
  example: SensaExampleView | null;
  detail: SensaSenseView | null;
  finish: SensaFinishView | null;
  completedThisRun: number;
  bookQuery: string;
  learningTab: "plan" | "preferences";
}>;

const initialState: SensaAppState = {
  phase: "loading",
  fatal: null,
  me: null,
  scope: null,
  snapshot: null,
  members: [],
  bookTitle: "",
  bookSenseCount: 0,
  bookLexemeCount: 0,
  surface: "home",
  previousSurface: "home",
  busy: false,
  toast: null,
  sheet: null,
  menuOpen: false,
  study: null,
  verdict: null,
  example: null,
  detail: null,
  finish: null,
  completedThisRun: 0,
  bookQuery: "",
  learningTab: "plan",
};

function message(error: unknown): string {
  if (error instanceof SensaApiError) {
    return error.requestId === null ? error.message : `${error.message}（request ID: ${error.requestId}）`;
  }
  if (error instanceof SensaContractError) return error.message;
  return error instanceof Error ? error.message : "出现了未知问题。";
}

export function useSensaApp() {
  const [state, setState] = useState<SensaAppState>(initialState);
  const latest = useRef(state);
  latest.current = state;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loading = useRef<Promise<void> | null>(null);

  const patch = useCallback((next: Partial<SensaAppState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const notify = useCallback((text: string | null) => {
    if (text === null) return;
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
    setState((current) => ({ ...current, toast: text }));
    toastTimer.current = setTimeout(() => {
      setState((current) => ({ ...current, toast: null }));
    }, 3_200);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current);
  }, []);

  // ---- bootstrap -----------------------------------------------------------

  const load = useCallback(async () => {
    // StrictMode mounts effects twice in development, and a second concurrent
    // bootstrap would race the first one's writes through the same IndexedDB
    // stores. One in-flight run is enough; the second caller joins it.
    if (loading.current !== null) return loading.current;
    const run = (async () => {
    setState((current) => ({ ...current, phase: "loading", fatal: null }));
    try {
      const me = await sensaApi.me();
      if (me.selectedWorkspaceId === null) throw new Error("这个账号没有可用的学习范围。");
      const scope: SensaScope = {
        workspaceId: me.selectedWorkspaceId,
        learnerUserId: me.learnerUserId,
        replicaId: sensaWebEnv.VITE_SENSA_REPLICA_ID ?? fallbackReplicaId,
      };
      const synchronized = await synchronize(scope);
      const plan = activePlan(synchronized.snapshot);
      // The manifest is the whole membership without assets. Packages stay
      // unfetched until a Sense is actually about to be shown.
      const manifest = plan === null
        ? null
        : await sensaContent.manifest(scope, plan.studyPlanId);
      setState((current) => ({
        ...current,
        phase: "ready",
        fatal: null,
        me,
        scope,
        snapshot: synchronized.snapshot,
        members: manifest?.members ?? [],
        bookTitle: manifest?.book.title ?? "",
        bookSenseCount: manifest?.book.senseCount ?? 0,
        bookLexemeCount: manifest?.book.lexemeCount ?? 0,
      }));
      notify(synchronized.notice);
    } catch (caught) {
      setState((current) => ({ ...current, phase: "failed", fatal: message(caught) }));
    }
    })().finally(() => { loading.current = null; });
    loading.current = run;
    return run;
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- navigation ----------------------------------------------------------

  const go = useCallback((surface: SensaSurface) => {
    stopSensaAudio();
    setState((current) => ({
      ...current,
      previousSurface: current.surface,
      surface,
      menuOpen: false,
      sheet: null,
    }));
  }, []);

  const back = useCallback(() => {
    stopSensaAudio();
    setState((current) => ({
      ...current,
      surface: current.previousSurface,
      previousSurface: "home",
      menuOpen: false,
      sheet: null,
      example: null,
    }));
  }, []);

  // ---- study ---------------------------------------------------------------

  const applyStep = useCallback((step: SensaStudyStep) => {
    switch (step.kind) {
      case "action":
        setState((current) => ({
          ...current,
          surface: "study",
          previousSurface: current.surface === "study" ? current.previousSurface : current.surface,
          study: { kind: "action", target: step.target },
          verdict: null,
          example: null,
          finish: null,
        }));
        return;
      case "rejected":
        setState((current) => ({
          ...current,
          surface: "study",
          verdict: null,
          study: { kind: "rejected", encounter: step.encounter, senseId: step.senseId, reason: step.reason },
        }));
        return;
      case "exhausted":
        setState((current) => ({
          ...current,
          surface: "finish",
          study: null,
          verdict: null,
          finish: {
            reason: "exhausted",
            detail: step.reason === "daily_new_target_reached"
              ? "今天的新意思已经排满了。到期复习会按记忆状态自己回来。"
              : step.reason === "no_eligible_sense"
                ? "现在没有可以安排的意思。到期复习会按记忆状态自己回来。"
                : "当前没有可用的学习计划。",
            completed: current.completedThisRun,
          },
        }));
        return;
      case "no_plan":
        setState((current) => ({
          ...current,
          surface: "finish",
          study: null,
          verdict: null,
          finish: { reason: "no_plan", detail: "还没有进行中的学习计划。", completed: 0 },
        }));
    }
  }, []);

  const advance = useCallback(async (scope: SensaScope, snapshot: SensaLocalSnapshot) => {
    const step = await planNextStep(scope, snapshot);
    applyStep(step);
    if (step.kind === "action") {
      // Warm the neighbouring member so the next Sense does not wait on a fetch.
      const plan = activePlan(snapshot);
      const members = latest.current.members;
      const at = members.findIndex((member) => member.senseId === step.target.encounter.senseId);
      if (plan !== null && at >= 0) {
        sensaContent.prefetch(scope, plan.studyPlanId, members[at + 1]?.senseId ?? null);
      }
    }
  }, [applyStep]);

  const startLearning = useCallback(async () => {
    const { scope, snapshot, busy } = latest.current;
    if (scope === null || snapshot === null || busy) return;
    patch({ busy: true, surface: "study", study: { kind: "loading" }, completedThisRun: 0, finish: null });
    try {
      await advance(scope, snapshot);
    } catch (caught) {
      notify(message(caught));
      patch({ surface: "home", study: null });
    } finally {
      patch({ busy: false });
    }
  }, [advance, notify, patch]);

  const resumeLearning = useCallback(async () => {
    const { scope, snapshot, busy } = latest.current;
    if (scope === null || snapshot === null || busy) return;
    patch({ busy: true, surface: "study", study: { kind: "loading" }, finish: null });
    try {
      const step = await resumeStep(scope, snapshot);
      if (step === null) await advance(scope, snapshot);
      else applyStep(step);
    } catch (caught) {
      notify(message(caught));
      patch({ surface: "home", study: null });
    } finally {
      patch({ busy: false });
    }
  }, [advance, applyStep, notify, patch]);

  const respond = useCallback(async (
    response: Readonly<Record<string, unknown>>,
    durationMs: number | null = null,
  ) => {
    const { scope, snapshot, study, busy } = latest.current;
    if (scope === null || snapshot === null || busy) return;
    if (study === null || study.kind !== "action") return;
    const target = study.target;
    patch({ busy: true });
    try {
      const result = await submitAttempt({ scope, snapshot, target, response, durationMs });
      if (result.kind === "blocked") {
        patch({ snapshot: result.snapshot });
        notify("上一条作答还没同步完成，请稍候。");
        return;
      }
      if (result.kind === "step") {
        // The verdict is an accepted fact, not a local guess. Holding it for a
        // beat is the only reason the next Action is not shown immediately.
        const verdict = latestAttemptVerdict(result.snapshot, target.action.learningActionId);
        if (verdict !== null && verdict.isCorrect !== null) {
          patch({ snapshot: result.snapshot, verdict });
          await new Promise((resolve) => setTimeout(resolve, 1_500));
        } else {
          patch({ snapshot: result.snapshot });
        }
        applyStep(result.step);
        notify(result.notice);
        return;
      }
      stopSensaAudio();
      setState((current) => ({
        ...current,
        snapshot: result.snapshot,
        completedThisRun: current.completedThisRun + (result.status === "completed" ? 1 : 0),
        verdict: null,
        example: null,
        study: {
          kind: "closed",
          encounterId: result.encounterId,
          senseId: target.encounter.senseId,
          item: target.item,
          outcomeKind: outcomeOf(result.snapshot, result.encounterId)?.outcomeKind ?? null,
        },
      }));
      notify(result.notice);
    } catch (caught) {
      notify(message(caught));
    } finally {
      patch({ busy: false });
    }
  }, [applyStep, notify, patch]);

  const continueAfterEncounter = useCallback(async () => {
    const { scope, snapshot, busy } = latest.current;
    if (scope === null || snapshot === null || busy) return;
    patch({ busy: true, study: { kind: "loading" } });
    try {
      await advance(scope, snapshot);
    } catch (caught) {
      notify(message(caught));
    } finally {
      patch({ busy: false });
    }
  }, [advance, notify, patch]);

  const exitStudy = useCallback(async () => {
    const { scope, study } = latest.current;
    stopSensaAudio();
    const encounter = study === null
      ? null
      : study.kind === "action"
        ? study.target.encounter
        : study.kind === "rejected" ? study.encounter : null;
    setState((current) => ({
      ...current,
      surface: "home",
      previousSurface: "home",
      study: null,
      example: null,
      menuOpen: false,
      sheet: null,
    }));
    if (scope === null || encounter === null) return;
    try {
      await leaveEncounter(scope, encounter, "interrupted");
      const synchronized = await synchronize(scope);
      patch({ snapshot: synchronized.snapshot });
      notify(synchronized.notice);
    } catch (caught) {
      notify(message(caught));
    }
  }, [notify, patch]);

  // ---- declared mastery ----------------------------------------------------

  const openMasterySheet = useCallback((senseId: string) => {
    const { members, study } = latest.current;
    const member = members.find((item) => item.senseId === senseId) ?? null;
    const encounter = study !== null && study.kind === "action" ? study.target.encounter : null;
    setState((current) => ({
      ...current,
      menuOpen: false,
      sheet: {
        kind: "declare_mastery",
        senseId,
        lemma: member?.lemma ?? "这个词",
        guide: member?.guideLabelL1 ?? "这个意思",
        encounter,
      },
    }));
  }, []);

  const closeSheet = useCallback(() => patch({ sheet: null }), [patch]);

  const setMastery = useCallback(async (
    senseId: string,
    isMastered: boolean,
    encounter: SensaActiveEncounter | null,
  ) => {
    const { scope, snapshot } = latest.current;
    if (scope === null || snapshot === null) return;
    patch({ busy: true, sheet: null });
    try {
      const identity = masteryMutationIdentity(snapshot, senseId);
      // Declaring mastery inside an Encounter cancels that Encounter in the same
      // operation: no Attempt, no Evidence, no Memory Outcome is produced.
      const live = encounter === null ? null : encounterOf(snapshot, encounter.encounterId);
      await sensaStore.addOutbox(outboxRecord(scope, createDeclaredMasteryOperation({
        scope,
        senseId,
        isMastered,
        entityId: identity.entityId,
        expectedRevision: identity.expectedRevision,
        encounter: live === null || live.status === "completed" || live.status === "cancelled"
          ? null
          : { senseEncounterId: live.senseEncounterId, expectedRevision: live.revision },
      })));
      const synchronized = await synchronize(scope);
      patch({ snapshot: synchronized.snapshot });
      notify(synchronized.notice ?? (isMastered ? "已标记为已会，不再安排这个意思。" : "已恢复安排这个意思。"));
      if (encounter !== null && latest.current.surface === "study") {
        stopSensaAudio();
        patch({ study: { kind: "loading" } });
        await advance(scope, synchronized.snapshot);
      }
    } catch (caught) {
      notify(caught instanceof MasterySyncConflictError ? caught.message : message(caught));
    } finally {
      patch({ busy: false });
    }
  }, [advance, notify, patch]);

  // ---- sense detail & examples ---------------------------------------------

  const openSense = useCallback(async (senseId: string) => {
    const { scope, snapshot, members } = latest.current;
    const member = members.find((item) => item.senseId === senseId) ?? null;
    setState((current) => ({
      ...current,
      previousSurface: current.surface,
      surface: "sense",
      detail: { senseId, member, item: null, error: null },
    }));
    if (scope === null || snapshot === null) return;
    const plan = activePlan(snapshot);
    if (plan === null) {
      patch({ detail: { senseId, member, item: null, error: "当前没有进行中的学习计划。" } });
      return;
    }
    try {
      const item = await sensaContent.package(scope, plan.studyPlanId, senseId);
      setState((current) => current.detail?.senseId === senseId
        ? { ...current, detail: { senseId, member, item, error: null } }
        : current);
    } catch (caught) {
      setState((current) => current.detail?.senseId === senseId
        ? { ...current, detail: { senseId, member, item: null, error: message(caught) } }
        : current);
    }
  }, [patch]);

  const openExamples = useCallback((
    origin: "study" | "sense",
    cards: readonly SensaExampleCard[],
    index = 0,
  ) => {
    if (cards.length === 0) return;
    stopSensaAudio();
    setState((current) => ({
      ...current,
      previousSurface: current.surface,
      surface: "example",
      example: {
        origin,
        cards,
        index: Math.min(Math.max(0, index), cards.length - 1),
        translationVisible: current.snapshot?.meta.preferences.translationDefault ?? false,
        contextVisible: false,
      },
    }));
  }, []);

  const moveExample = useCallback((step: number) => {
    stopSensaAudio();
    setState((current) => {
      if (current.example === null) return current;
      const next = current.example.index + step;
      if (next < 0 || next >= current.example.cards.length) return current;
      return {
        ...current,
        example: {
          ...current.example,
          index: next,
          translationVisible: current.snapshot?.meta.preferences.translationDefault ?? false,
          contextVisible: false,
        },
      };
    });
  }, []);

  const toggleExampleDetail = useCallback((field: "translationVisible" | "contextVisible") => {
    setState((current) => current.example === null
      ? current
      : { ...current, example: { ...current.example, [field]: !current.example[field] } });
  }, []);

  const closeExamples = useCallback(() => {
    stopSensaAudio();
    setState((current) => ({
      ...current,
      surface: current.example?.origin === "study" ? "study" : "sense",
      example: null,
    }));
  }, []);

  // ---- settings ------------------------------------------------------------

  const savePreferences = useCallback(async (next: SensaLearningPreferences) => {
    const meta = await sensaStore.savePreferences(next);
    setState((current) => current.snapshot === null
      ? current
      : { ...current, snapshot: { ...current.snapshot, meta } });
  }, []);

  const setDailyTarget = useCallback(async (dailyNewSenseTarget: number) => {
    const { scope, snapshot } = latest.current;
    if (scope === null || snapshot === null) return;
    const plan = activePlan(snapshot);
    if (plan === null) return;
    patch({ busy: true });
    try {
      await sensaStore.addOutbox(outboxRecord(scope, studyPlanPacingOperation({
        studyPlanId: plan.studyPlanId,
        expectedRevision: plan.revision,
        dailyNewSenseTarget,
      })));
      const synchronized = await synchronize(scope);
      patch({ snapshot: synchronized.snapshot });
      notify(synchronized.notice ?? `每日新学已调整为 ${dailyNewSenseTarget} 个意思。`);
    } catch (caught) {
      notify(message(caught));
    } finally {
      patch({ busy: false });
    }
  }, [notify, patch]);

  const runSync = useCallback(async () => {
    const { scope, busy } = latest.current;
    if (scope === null || busy) return;
    patch({ busy: true });
    try {
      const synchronized = await synchronize(scope);
      patch({ snapshot: synchronized.snapshot });
      notify(synchronized.notice ?? "已同步。");
    } catch (caught) {
      notify(message(caught));
    } finally {
      patch({ busy: false });
    }
  }, [notify, patch]);

  /**
   * A refused intent is a response the learner actually made, so it stays in
   * the queue until they choose. Retry re-offers the original operation
   * unchanged; discard is the only way it ever leaves without becoming a fact.
   */
  const retryBlocked = useCallback(async (operationId: string) => {
    const { scope, busy } = latest.current;
    if (scope === null || busy) return;
    patch({ busy: true });
    try {
      await sensaStore.retryOutbox(operationId);
      const synchronized = await synchronize(scope);
      patch({ snapshot: synchronized.snapshot });
      notify(synchronized.notice ?? "已重新提交这条记录。");
    } catch (caught) {
      notify(message(caught));
    } finally {
      patch({ busy: false });
    }
  }, [notify, patch]);

  const discardBlocked = useCallback(async (operationId: string) => {
    const { busy } = latest.current;
    if (busy) return;
    patch({ busy: true });
    try {
      await sensaStore.discardOutbox(operationId);
      patch({ snapshot: await sensaStore.loadSnapshot() });
      notify("已丢弃这条本机记录。");
    } catch (caught) {
      notify(message(caught));
    } finally {
      patch({ busy: false });
    }
  }, [notify, patch]);

  const resetLocalData = useCallback(async () => {
    await sensaStore.reset();
    sensaContent.forget();
    await load();
    notify("本机数据已清空并重新同步。");
  }, [load, notify]);

  const setBookQuery = useCallback((bookQuery: string) => patch({ bookQuery }), [patch]);
  const setLearningTab = useCallback(
    (learningTab: "plan" | "preferences") => patch({ learningTab }),
    [patch],
  );
  const toggleMenu = useCallback(() => {
    setState((current) => ({ ...current, menuOpen: !current.menuOpen }));
  }, []);

  const isMastered = useCallback(
    (senseId: string) => state.snapshot !== null && effectiveMastery(state.snapshot, senseId),
    [state.snapshot],
  );

  const actions = useMemo(() => ({
    go,
    back,
    reload: load,
    startLearning,
    resumeLearning,
    respond,
    continueAfterEncounter,
    exitStudy,
    openMasterySheet,
    closeSheet,
    setMastery,
    openSense,
    openExamples,
    moveExample,
    toggleExampleDetail,
    closeExamples,
    savePreferences,
    setDailyTarget,
    runSync,
    retryBlocked,
    discardBlocked,
    resetLocalData,
    setBookQuery,
    setLearningTab,
    toggleMenu,
    notify,
  }), [
    go, back, load, startLearning, resumeLearning, respond, continueAfterEncounter, exitStudy,
    openMasterySheet, closeSheet, setMastery, openSense, openExamples, moveExample,
    toggleExampleDetail, closeExamples, savePreferences, setDailyTarget, runSync,
    retryBlocked, discardBlocked, resetLocalData, setBookQuery, setLearningTab,
    toggleMenu, notify,
  ]);

  return { state, actions, isMastered };
}

export type SensaAppActions = ReturnType<typeof useSensaApp>["actions"];
export type { SensaAppState };

import { useCallback, useMemo } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  buildPathname,
  parseMainStack,
  parseShellParams,
  parseViewMode,
  retainParamsForStack,
  type ShellFlow,
  type ShellParams,
  type ViewMode,
} from './shellLocation';

/**
 * The shell's navigation state, read from and written to the URL.
 *
 * This deliberately keeps the exact shape App used when `viewMode` and
 * `mainStack` were `useState` -- same names, same call signatures -- so the
 * ~100 existing call sites are untouched by the move to routing. What changes
 * is only where the state lives: the URL is now the single source of truth,
 * which is what buys deep links, browser back/forward and shareable state.
 *
 * `goMain` keeps the original push semantics: re-pushing a sheet already on
 * the stack is a no-op rather than a duplicate entry. Its optional second
 * argument sets the drill-down params the opened sheet reads, so opening a
 * sheet and saying what it shows stay one atomic navigation.
 */
export interface ShellNavigation {
  readonly viewMode: ViewMode;
  readonly mainStack: readonly string[];
  readonly params: ShellParams;
  setViewMode: (mode: ViewMode) => void;
  goMain: (sheetId: string, params?: ShellParams) => void;
  backMain: () => void;
  resetMain: () => void;
  returnHome: () => void;
  leaveRuntime: (screenId:string) => void;
  setMainStack: (stack: readonly string[], params?: ShellParams) => void;
}

export function useShellNavigation(): ShellNavigation {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({
    select: (state) => state.location.search as Record<string, unknown>,
  });

  const mainStack = useMemo(() => parseMainStack(pathname), [pathname]);
  const viewMode = parseViewMode(search.flow);
  const params = useMemo(() => parseShellParams(search), [search]);

  /**
   * Move the sheet stack while leaving the learning flow untouched, and vice
   * versa. The two dimensions are independent, so neither writer may clobber
   * the other's half of the URL. Params are pruned to the new stack here, in
   * the one place every stack change goes through.
   */
  const goToStack = useCallback(
    (stack: readonly string[], nextParams?: ShellParams) => {
      const path = buildPathname(stack);
      const toSearch = (previous: Record<string, unknown>): Record<string, unknown> => {
        const merged = { ...parseShellParams(previous), ...(nextParams ?? {}) };
        const kept = retainParamsForStack(merged, stack);
        const flow = parseViewMode(previous.flow);
        return flow === 'main' ? { ...kept } : { ...kept, flow };
      };
      if (path === '/') {
        navigate({ to: '/', search: toSearch });
        return;
      }
      navigate({ to: '/$', params: { _splat: path.slice(1) }, search: toSearch });
    },
    [navigate],
  );

  const setViewMode = useCallback(
    (mode: ViewMode) => {
      navigate({
        to: '.',
        search: (previous: Record<string, unknown>) => {
          const { flow: _dropped, ...rest } = previous;
          return mode === 'main' ? rest : { ...rest, flow: mode satisfies ShellFlow };
        },
      });
    },
    [navigate],
  );

  const goMain = useCallback(
    (sheetId: string, nextParams?: ShellParams) => {
      const stack = mainStack.includes(sheetId) ? mainStack : [...mainStack, sheetId];
      goToStack(stack, nextParams);
    },
    [mainStack, goToStack],
  );

  const backMain = useCallback(() => {
    goToStack(mainStack.slice(0, -1));
  }, [mainStack, goToStack]);

  // Exit a runtime in one navigation; separate flow/stack writes can race.
  const returnHome = useCallback(() => {
    navigate({ to: '/', search: {} });
  }, [navigate]);

  const leaveRuntime = useCallback((screenId:string) => {
    navigate({to:'/$',params:{_splat:buildPathname([screenId]).slice(1)},search:{}});
  },[navigate]);

  const resetMain = useCallback(() => {
    goToStack([]);
  }, [goToStack]);

  const setMainStack = useCallback(
    (stack: readonly string[], nextParams?: ShellParams) => {
      goToStack(stack, nextParams);
    },
    [goToStack],
  );

  return {
    viewMode,
    mainStack,
    params,
    setViewMode,
    goMain,
    backMain,
    resetMain,
    returnHome,
    leaveRuntime,
    setMainStack,
  };
}
